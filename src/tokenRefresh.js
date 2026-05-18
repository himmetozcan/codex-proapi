/**
 * tokenRefresh.js — 自动刷新过期 access_token
 *
 * 流程：
 *   1. 检测到 401/403 → 用 refresh_token 换新 token
 *   2. 更新 accounts.json 中的 token
 *   3. 返回新 token 给调用方重试
 *
 * OpenAI OAuth token endpoint:
 *   POST https://auth.openai.com/oauth/token
 *   Body: grant_type=refresh_token&refresh_token=xxx&client_id=xxx
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(new URL('.', import.meta.url)));
const DATA_DIR = process.env.CODEX_DATA_DIR || join(__dirname, '..', 'data');

const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

function getAccountsPath() {
  return process.env.CODEX_ACCOUNTS_FILE || join(DATA_DIR, 'accounts.json');
}

async function loadAccounts() {
  const path = getAccountsPath();
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(data) ? data : (data.accounts || []);
  } catch {
    return [];
  }
}

async function saveAccounts(list) {
  const path = getAccountsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify({ accounts: list }, null, 2), 'utf8');
}

/**
 * 用 refresh_token 换取新的 access_token
 * @returns {{ access_token, refresh_token?, expires_in? }}
 */
async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token || refreshToken, // 有些 provider 不返回新的
    expires_in: json.expires_in || null,
  };
}

/**
 * 刷新指定账号的 token 并更新 accounts.json
 * @param {number} accountIndex — 账号在列表中的索引
 * @returns {string|null} — 新的 access_token，失败返回 null
 */
export async function refreshTokenForAccount(accountIndex) {
  const list = await loadAccounts();
  const account = list[accountIndex];
  if (!account) return null;

  const refreshToken = account.refresh_token ||
    account.tokens?.refresh_token ||
    null;

  if (!refreshToken) {
    console.warn(`[TokenRefresh] 账号 ${accountIndex} 无 refresh_token，无法刷新`);
    return null;
  }

  try {
    const result = await refreshAccessToken(refreshToken);

    // 更新 accounts.json
    if (account.access_token !== undefined) {
      account.access_token = result.access_token;
    }
    if (account.tokens?.access_token !== undefined) {
      account.tokens.access_token = result.access_token;
    }
    // 保存新的 refresh_token（如果 provider 返回了）
    if (result.refresh_token && result.refresh_token !== refreshToken) {
      if (account.refresh_token !== undefined) {
        account.refresh_token = result.refresh_token;
      }
      if (account.tokens?.refresh_token !== undefined) {
        account.tokens.refresh_token = result.refresh_token;
      }
    }

    list[accountIndex] = account;
    await saveAccounts(list);

    const mask = account.account_id
      ? account.account_id.slice(0, 8) + '…'
      : `账号${accountIndex + 1}`;
    console.log(`[TokenRefresh] ${mask} token 已刷新`);

    return result.access_token;
  } catch (e) {
    console.error(`[TokenRefresh] 账号 ${accountIndex} 刷新失败:`, e.message);
    return null;
  }
}

/**
 * 根据 accountId 查找并刷新 token
 * @param {string} accountId
 * @returns {{ accessToken: string, accountId: string } | null}
 */
export async function refreshTokenByAccountId(accountId) {
  const list = await loadAccounts();
  const index = list.findIndex(a => {
    const id = a.account_id || a.tokens?.account_id;
    return id === accountId;
  });

  if (index === -1) return null;

  const newToken = await refreshTokenForAccount(index);
  if (!newToken) return null;

  // 重新读取以获取刷新后的完整账号数据
  const updatedList = await loadAccounts();
  const updated = updatedList[index];

  return {
    accessToken: newToken,
    accountId: updated?.account_id || updated?.tokens?.account_id || accountId,
  };
}

/**
 * 检查 access_token 是否可能过期（基于 JWT exp）
 * @param {string} accessToken
 * @returns {boolean} — true 表示已过期或即将过期（5 分钟内）
 */
export function isTokenExpiringSoon(accessToken) {
  if (!accessToken) return true;
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return false; // 非 JWT，无法判断
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.exp) return false;
    // 提前 5 分钟判定为即将过期
    const margin = 5 * 60 * 1000;
    return Date.now() >= (payload.exp * 1000 - margin);
  } catch {
    return false; // 解析失败，不假设过期
  }
}
