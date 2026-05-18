/**
 * Proxy Pool Manager (ESM)
 * 每个代理 IP 固定绑定 3 个账号，绑定关系持久化到 proxyPool.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'https';
import http from 'http';
import { PassThrough } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_FILE = path.join(__dirname, 'proxyPool.json');
let proxyPool = { proxies: [], accountBindings: {} };

export function loadProxyPool() {
  try {
    if (fs.existsSync(PROXY_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROXY_FILE, 'utf8'));
      proxyPool.proxies = data.proxies || [];
      proxyPool.accountBindings = data.accountBindings || {};
      console.log(`[ProxyPool] Loaded ${proxyPool.proxies.length} proxies, ${Object.keys(proxyPool.accountBindings).length} account bindings`);
    }
  } catch (e) {
    console.error('[ProxyPool] Load error:', e.message);
  }
}

function saveProxyPool() {
  try {
    fs.writeFileSync(PROXY_FILE, JSON.stringify(proxyPool, null, 2));
  } catch (e) {
    console.error('[ProxyPool] Save error:', e.message);
  }
}

export function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  try {
    const proto = new URL(proxyUrl).protocol.replace(':', '');
    if (proto === 'socks5' || proto === 'socks4') {
      return new SocksProxyAgent(proxyUrl);
    } else if (proto === 'https' || proto === 'http') {
      return new HttpsProxyAgent(proxyUrl);
    }
  } catch (e) {
    console.error('[ProxyPool] Agent error:', e.message);
  }
  return undefined;
}

/**
 * 根据 accountId 获取绑定的代理 URL
 * 1. 已有绑定 → 直接返回
 * 2. 未绑定 → 自动分配到负载最轻的代理（3 个账号/代理上限）
 */
export function getProxyForAccount(accountId) {
  if (!proxyPool.proxies.length) return null;
  if (!accountId) return getProxyRoundRobin();

  // 已绑定的账号 → 直接返回对应代理
  if (proxyPool.accountBindings[accountId] !== undefined) {
    const idx = proxyPool.accountBindings[accountId];
    return proxyPool.proxies[idx]?.url || null;
  }

  // 未绑定 → 找当前负载最轻的代理
  const counts = proxyPool.proxies.map(p => {
    let count = 0;
    for (const [aid, pidx] of Object.entries(proxyPool.accountBindings)) {
      if (pidx === proxyPool.proxies.indexOf(p)) count++;
    }
    return count;
  });

  let bestIdx = 0;
  let minCount = Infinity;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < minCount) {
      minCount = counts[i];
      bestIdx = i;
    }
  }

  // 如果最佳代理已满（>=3），不绑定，走直连
  if (minCount >= 3) {
    console.log(`[ProxyPool] All proxies full, account ${accountId.slice(0, 8)}… will use direct connection`);
    return null;
  }

  // 绑定账号到代理
  proxyPool.accountBindings[accountId] = bestIdx;
  saveProxyPool();
  console.log(`[ProxyPool] Bound account ${accountId.slice(0, 8)}… → proxy ${bestIdx} (${minCount + 1}/3)`);
  return proxyPool.proxies[bestIdx]?.url || null;
}

/** 无 accountId 时的轮询（备用） */
let proxyIndex = 0;
function getProxyRoundRobin() {
  const proxy = proxyPool.proxies[proxyIndex % proxyPool.proxies.length];
  proxyIndex = (proxyIndex + 1) % proxyPool.proxies.length;
  return proxy?.url || null;
}

/**
 * Fetch through proxy using https/socks agent
 * Returns a Response-like object
 */
export function fetchWithProxy(url, options = {}, proxyUrl = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const agent = proxyUrl ? createProxyAgent(proxyUrl) : undefined;
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      agent: agent,
      timeout: options.timeout || 30000,
    };

    const req = lib.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');

        const passThrough = new PassThrough();
        passThrough.end(Buffer.concat(chunks));
        const webStream = new ReadableStream({
          start(controller) {
            passThrough.on('data', chunk => controller.enqueue(new Uint8Array(chunk)));
            passThrough.on('end', () => controller.close());
            passThrough.on('error', err => controller.error(err));
          }
        });

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: Object.fromEntries(Object.entries(res.headers)),
          text: () => Promise.resolve(bodyStr),
          json: () => Promise.resolve(JSON.parse(bodyStr)),
          body: webStream,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

    if (options.body) req.write(options.body);
    req.end();
  });
}

export function addProxies(urls) {
  const added = [];
  for (const url of urls) {
    if (!proxyPool.proxies.find(p => p.url === url)) {
      proxyPool.proxies.push({ url });
      added.push(url);
    }
  }
  if (added.length) saveProxyPool();
  return added;
}

export function listProxies() {
  return proxyPool.proxies.map((p, idx) => {
    // 统计该代理绑定的账号数
    let boundCount = 0;
    for (const [, pidx] of Object.entries(proxyPool.accountBindings)) {
      if (pidx === idx) boundCount++;
    }
    return {
      url: p.url.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'),
      boundAccounts: boundCount,
      maxAccounts: 3,
    };
  });
}

export function getProxyCount() {
  return proxyPool.proxies.length;
}

/** 重新分配账号到代理（严格每个代理 3 个账号） */
export function reassignAllAccounts(accountIds) {
  proxyPool.accountBindings = {};
  const proxyCount = proxyPool.proxies.length;
  const MAX_PER_PROXY = 3;
  if (proxyCount === 0 || !accountIds.length) {
    saveProxyPool();
    return;
  }
  let assigned = 0;
  for (let i = 0; i < accountIds.length; i++) {
    const proxyIdx = i % proxyCount;
    // 检查该代理是否已满
    let count = 0;
    for (const [, pidx] of Object.entries(proxyPool.accountBindings)) {
      if (pidx === proxyIdx) count++;
    }
    if (count >= MAX_PER_PROXY) continue; // 跳过已满的代理
    proxyPool.accountBindings[accountIds[i]] = proxyIdx;
    assigned++;
  }
  saveProxyPool();
  console.log(`[ProxyPool] Assigned ${assigned}/${accountIds.length} accounts across ${proxyCount} proxies (${MAX_PER_PROXY} each)`);
}

loadProxyPool();
