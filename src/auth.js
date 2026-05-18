import { readFileSync } from 'fs';
import { isAccountUnavailable, isImageQuotaExhausted } from './accountStatus.js';
import { getUsedTokens } from './usageTracker.js';
import { homedir } from 'os';
import { resolve } from 'path';

const DEFAULT_AUTH_PATH = resolve(homedir(), '.codex', 'auth.json');

/**
 * 解析 auth 路径：支持 ~/.codex/auth.json 与绝对路径
 */
function resolveAuthPath(given) {
  if (!given) return DEFAULT_AUTH_PATH;
  if (given.startsWith('~/')) return resolve(homedir(), given.slice(2));
  return resolve(given);
}

/**
 * 从 Codex auth.json 加载认证信息
 * 支持格式：
 * - { access_token, account_id } 或 { tokens: { access_token, account_id } }（ChatGPT/Codex）
 * - { api_key } 或 { OPENAI_API_KEY }（OpenAI API Key）
 */
export function loadAuth(authPath = null) {
  const path = resolveAuthPath(authPath || process.env.CODEX_AUTH_PATH);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`无法读取认证文件: ${path} (${e.message})`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`auth.json 格式错误: ${e.message}`);
  }
  const tokens = data.tokens || (data.access_token ? { access_token: data.access_token, account_id: data.account_id } : null);
  const apiKey = data.api_key || data.OPENAI_API_KEY;
  if (tokens) {
    return { type: 'codex', accessToken: tokens.access_token, accountId: tokens.account_id };
  }
  if (apiKey) {
    return { type: 'api_key', apiKey };
  }
  throw new Error('auth.json 中未找到 access_token+account_id 或 api_key/OPENAI_API_KEY');
}

/**
 * 从已解析的 auth 对象（如 auth.json 内容）提取 Codex 认证，供账号列表使用
 */
export function parseAuthFromJson(data) {
  const tokens = data.tokens || (data.access_token ? { access_token: data.access_token, account_id: data.account_id } : null);
  const apiKey = data.api_key || data.OPENAI_API_KEY;
  if (tokens) {
    return { type: 'codex', accessToken: tokens.access_token, accountId: tokens.account_id };
  }
  if (apiKey) {
    return { type: 'api_key', apiKey };
  }
  throw new Error('未找到 access_token+account_id 或 api_key');
}

/**
 * 创建负载均衡 getter：
 * 1. 跳过不可用账号（401/403 标记的）和生图额度耗尽账号（24h 自动重置）
 * 2. 在可用账号中选择使用量最少的
 * 3. 全部不可用时回退到简单轮询
 */
export function createRoundRobinProvider(auths) {
  if (!auths || auths.length === 0) return () => null;

  // 单账号直接返回
  if (auths.length === 1) return () => auths[0];

  return () => {
    // 过滤不可用账号 + 生图额度耗尽账号
    const available = auths.filter(a =>
      !isAccountUnavailable(a.accountId) && !isImageQuotaExhausted(a.accountId));

    // 全部不可用时回退到全部账号
    const pool = available.length > 0 ? available : auths;

    // 选使用量最少的
    let best = pool[0];
    let minUsed = Infinity;
    for (const a of pool) {
      const used = getUsedTokens(a.accountId);
      if (used < minUsed) {
        minUsed = used;
        best = a;
      }
    }
    return best;
  };
}

export { resolveAuthPath, DEFAULT_AUTH_PATH };
