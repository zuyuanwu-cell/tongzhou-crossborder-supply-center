"use strict";

// 本地配置与运行记录（JSON 文件，原子写入）。位置：%APPDATA%\同舟智数\ 下。

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  zhongtai: { baseUrl: "https://gyl.tongzhoukuajing.com", tokenEnc: "", token: "" },
  ziniao: { cliPath: "", headless: false, closeAfter: true, retryPerStore: 1, storeTimeoutSec: 240 },
  schedule: { enabled: false, times: ["09:30"], lookbackDays: 3, includeToday: false, autoUpload: true },
  templates: {},
  stores: {},
  storeCache: [],
  storeCacheAt: "",
  zhongtaiShops: [],
  zhongtaiUser: null,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(input) {
  const base = clone(DEFAULT_CONFIG);
  if (!input || typeof input !== "object") return base;
  return {
    ...base,
    ...input,
    zhongtai: { ...base.zhongtai, ...(input.zhongtai || {}) },
    ziniao: { ...base.ziniao, ...(input.ziniao || {}) },
    schedule: { ...base.schedule, ...(input.schedule || {}) },
    templates: input.templates && typeof input.templates === "object" ? input.templates : {},
    stores: input.stores && typeof input.stores === "object" ? input.stores : {},
    storeCache: Array.isArray(input.storeCache) ? input.storeCache : [],
    zhongtaiShops: Array.isArray(input.zhongtaiShops) ? input.zhongtaiShops : [],
  };
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

class ConfigStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "config.json");
    this.historyFile = path.join(dir, "history.json");
    this.resultsDir = path.join(dir, "results");
    this.data = this.load();
  }

  load() {
    try {
      return mergeDefaults(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch {
      return mergeDefaults(null);
    }
  }

  save() {
    writeAtomic(this.file, JSON.stringify(this.data, null, 2));
  }

  get() {
    return this.data;
  }

  update(mutator) {
    const next = clone(this.data);
    mutator(next);
    this.data = mergeDefaults(next);
    this.save();
    return this.data;
  }

  upsertTemplate(template) {
    const id = template.id || newId("tpl");
    this.update((config) => {
      config.templates[id] = { ...template, id, updatedAt: new Date().toISOString() };
    });
    return this.data.templates[id];
  }

  deleteTemplate(id) {
    this.update((config) => {
      delete config.templates[id];
      for (const store of Object.values(config.stores)) if (store.templateId === id) store.templateId = "";
    });
  }

  upsertStore(store) {
    this.update((config) => {
      const current = config.stores[store.storeId] || {};
      const targets = (store.targets || current.targets || []).map((target) => ({ ...target, id: target.id || newId("tg") }));
      config.stores[store.storeId] = { ...current, ...store, targets };
    });
    return this.data.stores[store.storeId];
  }

  history() {
    try {
      return JSON.parse(fs.readFileSync(this.historyFile, "utf8"));
    } catch {
      return [];
    }
  }

  appendHistory(entry) {
    const { rows, ...meta } = entry;
    if (rows) writeAtomic(path.join(this.resultsDir, `${entry.id}.json`), JSON.stringify(rows));
    const list = [meta, ...this.history()].slice(0, 200);
    writeAtomic(this.historyFile, JSON.stringify(list, null, 2));
    return list;
  }

  updateHistory(id, patch) {
    const list = this.history().map((item) => (item.id === id ? { ...item, ...patch } : item));
    writeAtomic(this.historyFile, JSON.stringify(list, null, 2));
  }

  resultRows(id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.resultsDir, `${id}.json`), "utf8"));
    } catch {
      return [];
    }
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG, mergeDefaults, newId };
