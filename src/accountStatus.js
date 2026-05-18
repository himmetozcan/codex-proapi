/**
 * 记录因 401/403 被判为不可用的账号，模型页将显示其额度为 0%
 * 生图额度耗尽标记持久化到 data/image_exhausted.json（重启不丢失，24h 自动重置）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CODEX_DATA_DIR || join(__dirname, '..', 'data');
const EXHAUSTED_FILE = join(dataDir, 'image_exhausted.json');

const unavailableIds = new Set();

export function markAccountUnavailable(accountId) {
  if (accountId) unavailableIds.add(String(accountId));
}

export function isAccountUnavailable(accountId) {
  return accountId ? unavailableIds.has(String(accountId)) : false;
}

// ── 生图额度耗尽标记（持久化，24h 自动重置）──

function loadExhausted() {
  try {
    if (existsSync(EXHAUSTED_FILE)) {
      return new Map(Object.entries(JSON.parse(readFileSync(EXHAUSTED_FILE, 'utf8'))));
    }
  } catch (_) {}
  return new Map();
}

function saveExhausted(map) {
  try {
    const dir = dirname(EXHAUSTED_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const obj = Object.fromEntries(map);
    writeFileSync(EXHAUSTED_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
  }
}

const imageExhausted = loadExhausted(); // accountId → resetTime (ms)

export function markImageQuotaExhausted(accountId) {
  if (!accountId) return;
  const resetAt = Date.now() + 24 * 60 * 60 * 1000;
  imageExhausted.set(String(accountId), resetAt);
  saveExhausted(imageExhausted);
}

export function isImageQuotaExhausted(accountId) {
  if (!accountId) return false;
  const resetAt = imageExhausted.get(String(accountId));
  if (!resetAt) return false;
  if (Date.now() > resetAt) {
    imageExhausted.delete(String(accountId));
    saveExhausted(imageExhausted);
    return false;
  }
  return true;
}

export function getImageExhaustedResetTime(accountId) {
  if (!accountId) return null;
  return imageExhausted.get(String(accountId)) || null;
}
