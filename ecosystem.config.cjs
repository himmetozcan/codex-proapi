module.exports = {
  apps: [{
    name: 'codex',
    script: 'src/index.js',
    cwd: '/root/codexProapi',
    env: {
      NODE_ENV: 'production',
      PORT: 1455,
      PUBLIC_URL: 'https://27c.site',
      REMOTE_URL: '',  // 本地用户设置: https://27c.site
    },
  }],
};
