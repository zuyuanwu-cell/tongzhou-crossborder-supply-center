"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = [
  "state", "settings:save", "zhongtai:test", "zhongtai:shops", "zhongtai:pair", "zhongtai:unpair",
  "cli:diagnose", "cli:install", "cli:pick",
  "stores:refresh", "stores:save", "stores:remove",
  "calibrate:discover", "calibrate:build", "calibrate:test",
  "templates:save", "templates:delete", "templates:export", "templates:import",
  "collect:start", "collect:cancel",
  "miaoshou:login", "miaoshou:check", "miaoshou:disable",
  "history:list", "history:rows", "history:reupload",
  "open:logs", "open:data", "open:url", "debug:cli", "debug:page", "app:relaunch",
];

contextBridge.exposeInMainWorld("tz", {
  call(channel, payload) {
    if (!CHANNELS.includes(channel)) return Promise.resolve({ ok: false, message: `未知操作 ${channel}` });
    return ipcRenderer.invoke(channel, payload);
  },
  on(event, handler) {
    if (!["log", "progress", "run-state", "miaoshou"].includes(event)) return () => {};
    const listener = (_event, data) => handler(data);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
