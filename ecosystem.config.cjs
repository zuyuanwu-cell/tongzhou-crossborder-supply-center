module.exports = {
  apps: [
    {
      name: "tongzhou-supply-api",
      script: "server/server.js",
      cwd: __dirname,
      // 退出前要把合并写盘的数据库写完（大库需要数秒），默认 1.6 秒会被强杀。
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "tongzhou-system-restore",
      script: "server/system-restore-agent.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
