module.exports = {
  apps: [
    {
      name: "tongzhou-supply-api",
      script: "server/server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
