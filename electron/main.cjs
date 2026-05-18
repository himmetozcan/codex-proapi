const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const net = require('net');

const PORT = 1455;
let mainWindow = null;
let server = null;

function getAppPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  }
  return path.join(__dirname, '..');
}

function getDataDir() {
  const base = app.getPath('userData');
  const dataDir = path.join(base, 'codex-proapi-data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

async function startServer() {
  const appPath = getAppPath();
  process.chdir(appPath);
  process.env.CODEX_ACCOUNTS_FILE = path.join(getDataDir(), 'accounts.json');
  process.env.CODEX_DATA_DIR = getDataDir();
  process.env.PORT = String(PORT);

  const indexPath = path.join(appPath, 'src', 'index.js');
  const m = await import(pathToFileURL(indexPath).href);
  server = m.startServer();
  return server;
}

function waitForPort(port, maxWait = 10000) {
  const start = Date.now();
  return new Promise((resolve) => {
    function tryConnect() {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        if (Date.now() - start > maxWait) return resolve(false);
        setTimeout(tryConnect, 200);
      });
    }
    tryConnect();
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'public', 'favicon.svg');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Codex Pro API',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
  });
  mainWindow.loadURL(`http://localhost:${PORT}/`);
  mainWindow.on('closed', () => { mainWindow = null; });
  // 外部链接（如 GitHub、帮助页）用系统浏览器打开；本地页面均在窗口内显示，不唤起浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await startServer();
  const ok = await waitForPort(PORT);
  if (!ok) {
    console.error('Server did not start in time');
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (server && typeof server.close === 'function') server.close();
  app.quit();
});

app.on('before-quit', () => {
  if (server && typeof server.close === 'function') server.close();
});
