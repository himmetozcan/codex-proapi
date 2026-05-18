#!/usr/bin/env node
/**
 * Push Codex CLI token to 27c.site
 * Usage: node push-token.js [server_url] [auth_json_path]
 * Works on: Windows, Linux, macOS
 */
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');

const SERVER = process.argv[2] || 'https://27c.site';

// Cross-platform auth.json path detection
function findAuthFile() {
  // Allow manual override
  if (process.argv[3]) return process.argv[3];

  const home = os.homedir();
  const platform = os.platform();

  // Primary: ~/.codex/auth.json (works on all platforms)
  const primary = path.join(home, '.codex', 'auth.json');
  if (fs.existsSync(primary)) return primary;

  // Windows fallback: %APPDATA%\codex\auth.json
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const winPath = path.join(appData, 'codex', 'auth.json');
    if (fs.existsSync(winPath)) return winPath;
  }

  // Linux/macOS fallback: XDG config
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const xdgPath = path.join(xdg, 'codex', 'auth.json');
  if (fs.existsSync(xdgPath)) return xdgPath;

  return primary; // Return default for better error message
}

const AUTH_FILE = findAuthFile();

try {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error('');
    console.error('  Error: auth.json not found at ' + AUTH_FILE);
    console.error('');
    console.error('  Please run "codex login" first to authenticate.');
    console.error('');
    process.exit(1);
  }

  const raw = fs.readFileSync(AUTH_FILE, 'utf8');
  const auth = JSON.parse(raw);
  const t = auth.tokens || {};

  if (!t.access_token || !t.account_id) {
    console.error('Error: access_token or account_id not found in auth.json');
    console.error('File: ' + AUTH_FILE);
    process.exit(1);
  }

  console.log('Reading auth.json from: ' + AUTH_FILE);
  console.log('Account: ' + (auth.email || t.account_id.slice(0, 8) + '...'));

  const body = JSON.stringify({
    access_token: t.access_token,
    account_id: t.account_id,
    refresh_token: t.refresh_token || '',
    name: auth.email || undefined
  });

  const url = new URL(SERVER + '/api/accounts/add');
  const req = https.request({
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('');
        console.log('  ✅ Token pushed to ' + SERVER);
        console.log('  Account ID: ' + t.account_id.slice(0, 8) + '...');
        console.log('');
        console.log('  🎉 感谢您的贡献！');
        console.log('');
      } else {
        console.error('  Server returned ' + res.statusCode + ': ' + data);
      }
    });
  });
  req.on('error', e => {
    console.error('');
    console.error('  Connection failed: ' + e.message);
    console.error('  Make sure you have internet access and ' + SERVER + ' is reachable.');
    console.error('');
  });
  req.write(body);
  req.end();
} catch (e) {
  if (e instanceof SyntaxError) {
    console.error('Error: auth.json is corrupted or invalid JSON');
    console.error('File: ' + AUTH_FILE);
  } else {
    console.error('Error: ' + e.message);
  }
  process.exit(1);
}
