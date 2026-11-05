#!/usr/bin/env node
"use strict";

// 测试用紫鸟 CLI：把参数转发给 mock-browser 服务，原样输出 stdout/stderr 与退出码。
const http = require("node:http");

const target = new URL(process.env.MOCK_ZINIAO_URL);
const body = JSON.stringify(process.argv.slice(2));
const req = http.request({ hostname: target.hostname, port: target.port, method: "POST", path: "/" }, (res) => {
  let raw = "";
  res.on("data", (chunk) => {
    raw += chunk;
  });
  res.on("end", () => {
    const { code, stdout, stderr } = JSON.parse(raw);
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exit(code);
  });
});
req.end(body);
