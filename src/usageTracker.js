/**
 * 按官方标准（token 计量）统计用量，持久化到 data/usage.json；账号不可用时清零该账号用量。
 * Token 估算：与 OpenAI 一致，约 4 字符 = 1 token。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CODEX_DATA_DIR || join(__dirname, '..', 'data');
const USAGE_FILE = join(dataDir, 'usage.json');

const DEFAULT_QUOTA_TOKENS = 1_000_000;
const QUOTA = Number(process.env.USAGE_QUOTA_TOKENS) || DEFAULT_QUOTA_TOKENS;

function load() {
  if (!existsSync(USAGE_FILE)) return { byAccount: {} };
  try {
    const raw = readFileSync(USAGE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null && Array.isArray(data.byAccount) === false
      ? { byAccount: data.byAccount || {} }
      : { byAccount: {} };
  } catch {
    return { byAccount: {} };
  }
}

function save(state) {
  try {
    const dir = dirname(USAGE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(USAGE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
  }
}

function ensureAccount(state, accountId) {
  const id = String(accountId);
  if (!state.byAccount[id]) {
    state.byAccount[id] = { prompt_tokens: 0, completion_tokens: 0 };
  }
  return state.byAccount[id];
}

/**
 * 记录本次请求的 token 用量（与 OpenAI 标准一致：prompt_tokens + completion_tokens）
 */
export function recordUsage(accountId, { prompt_tokens = 0, completion_tokens = 0 }) {
  if (!accountId) return;
  const state = load();
  const acc = ensureAccount(state, accountId);
  acc.prompt_tokens += Number(prompt_tokens) || 0;
  acc.completion_tokens += Number(completion_tokens) || 0;
  save(state);
}

/**
 * 账号不可用时清零该账号的用量
 */
export function clearUsage(accountId) {
  if (!accountId) return;
  const state = load();
  state.byAccount[String(accountId)] = { prompt_tokens: 0, completion_tokens: 0 };
  save(state);
}

/**
 * 返回该账号已用 token 数（prompt + completion）
 */
export function getUsedTokens(accountId) {
  const state = load();
  const acc = state.byAccount[String(accountId)];
  return acc ? (acc.prompt_tokens + acc.completion_tokens) : 0;
}

/**
 * 返回该账号剩余额度百分比 0–100（基于已用 token 与配额计算）
 */
export function getRemainingPct(accountId) {
  const used = getUsedTokens(accountId);
  if (used >= QUOTA) return 0;
  return Math.min(100, Math.round(((QUOTA - used) / QUOTA) * 100));
}

export { QUOTA };


// ── 生图额度追踪（从 chatRequirements limits_progress 获取）──

const imageQuotaMap = new Map(); // accountId → { remaining, limit, resetAfter }

/**
 * 更新指定账号的真实生图额度（由 imagegen.js 在 chatRequirements 后调用）
 */
export function updateImageQuota(accountId, remaining, limit, resetAfter) {
  if (!accountId) return;
  imageQuotaMap.set(String(accountId), {
    remaining: Number(remaining) || 0,
    limit: Number(limit) || 0,
    resetAfter: resetAfter || null,
    updatedAt: Date.now(),
  });
}

/**
 * 获取指定账号的真实生图额度
 */
export function getImageQuota(accountId) {
  const q = imageQuotaMap.get(String(accountId));
  if (!q) return null;
  return { ...q };
}

/**
 * 获取所有账号的生图额度汇总
 */
export function getAllImageQuotas() {
  const result = {};
  for (const [id, q] of imageQuotaMap) {
    result[id] = { ...q };
  }
  return result;
}

// ── 本地生图额度追踪（因 chatRequirements 不返回 limits_progress）──

const DEFAULT_IMAGE_DAILY_QUOTA = Number(process.env.IMAGE_DAILY_QUOTA) || 5;
const IMAGE_USAGE_FILE = join(dataDir, 'image_usage.json');
let dailyImageCount = {}; // { accountId: { date: 'YYYY-MM-DD', count: N } }

function loadImageUsage() {
  try {
    if (existsSync(IMAGE_USAGE_FILE)) {
      return JSON.parse(readFileSync(IMAGE_USAGE_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveImageUsage(data) {
  try {
    const dir = dirname(IMAGE_USAGE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(IMAGE_USAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

/**
 * 记录一次生图成功，返回剩余次数
 */
export function recordImageUsage(accountId) {
  if (!accountId) return { remaining: null, limit: DEFAULT_IMAGE_DAILY_QUOTA };
  const id = String(accountId);
  const today = new Date().toISOString().slice(0, 10);
  dailyImageCount = loadImageUsage();
  const entry = dailyImageCount[id];
  if (!entry || entry.date !== today) {
    dailyImageCount[id] = { date: today, count: 1 };
  } else {
    entry.count++;
  }
  saveImageUsage(dailyImageCount);
  const used = dailyImageCount[id].count;
  return { remaining: Math.max(0, DEFAULT_IMAGE_DAILY_QUOTA - used), limit: DEFAULT_IMAGE_DAILY_QUOTA, used };
}

/**
 * 获取指定账号的本地生图剩余次数
 */
export function getLocalImageQuota(accountId) {
  if (!accountId) return null;
  const id = String(accountId);
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyImageCount[id];
  if (!entry || entry.date !== today) {
    return { remaining: DEFAULT_IMAGE_DAILY_QUOTA, limit: DEFAULT_IMAGE_DAILY_QUOTA, used: 0 };
  }
  return { remaining: Math.max(0, DEFAULT_IMAGE_DAILY_QUOTA - entry.count), limit: DEFAULT_IMAGE_DAILY_QUOTA, used: entry.count };
}
