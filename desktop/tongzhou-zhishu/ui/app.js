"use strict";

// 同舟智数 · 界面（无构建步骤的原生 JS）。所有数据操作经 window.tz.call 交给主进程。

const S = {
  tab: "home",
  state: null,
  progress: [],
  progressCount: { index: 0, total: 0 },
  zhongtaiShops: [],
  editingStore: null,
  storeDraft: null,
  storeFilter: "",
  onlyShopee: true,
  cal: null,
  historyDetail: null,
  historyRows: null,
  diag: null,
  run: { range: "auto", from: "", to: "", mode: "upload" },
  busy: {},
};

const $ = (selector) => document.querySelector(selector);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function toast(message, kind = "") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  $("#toasts").appendChild(node);
  setTimeout(() => node.remove(), kind === "err" ? 8000 : 4000);
}

async function api(channel, payload, { quiet = false } = {}) {
  const result = await window.tz.call(channel, payload);
  if (!result.ok) {
    if (!quiet) toast(`${result.message}${result.hint ? `\n${result.hint}` : ""}`, "err");
    const error = new Error(result.message);
    error.detail = result.detail;
    error.code = result.code;
    throw error;
  }
  return result.data;
}

async function withBusy(key, fn) {
  if (S.busy[key]) return undefined;
  S.busy[key] = true;
  render();
  try {
    return await fn();
  } catch (error) {
    return undefined;
  } finally {
    S.busy[key] = false;
    render();
  }
}

async function reload() {
  S.state = await api("state");
  render();
}

function fmtTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function yesterday() {
  const date = new Date(Date.now() - 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const STATUS = {
  ok: ["成功", "ok"], partial: ["部分成功", "warn"], failed: ["失败", "err"], skipped: ["已跳过", ""],
  cancelled: ["已取消", ""], running: ["进行中", "info"], upload_failed: ["写入中台失败", "err"],
};
const statusTag = (status) => {
  const [label, kind] = STATUS[status] || [status, ""];
  return `<span class="tag ${kind}">${esc(label)}</span>`;
};

function siteOptions(selected) {
  return S.state.sites.map((site) => `<option value="${site.code}" ${site.code === selected ? "selected" : ""}>${esc(site.name)} ${site.code}</option>`).join("");
}

function guessSite(name) {
  const text = String(name || "");
  const table = [["马来", "MY"], ["印尼", "ID"], ["印度尼西亚", "ID"], ["越南", "VN"], ["泰国", "TH"], ["菲律宾", "PH"], ["新加坡", "SG"], ["台湾", "TW"], ["巴西", "BR"], ["墨西哥", "MX"], ["哥伦比亚", "CO"], ["智利", "CL"]];
  for (const [word, code] of table) if (text.includes(word)) return code;
  const match = text.match(/(?:^|[^A-Za-z])(MY|ID|VN|TH|PH|SG|TW|BR|MX|CO|CL)(?:$|[^A-Za-z])/i);
  return match ? match[1].toUpperCase() : "MY";
}

// ---------------------------------------------------------------------------
// 页面：总览
// ---------------------------------------------------------------------------

function connectCard() {
  const { config } = S.state;
  return `<section class="panel connect">
    <div class="panel-head"><div><h2>第一步：连接同舟供应链中台</h2><p>用你登录中台的账号密码登录一次即可（账号需要有「店铺日报」权限）。密码不会保存在这台电脑上。</p></div></div>
    <div class="grid cols-4">
      <label class="field"><span>中台地址</span><input id="pair-base" value="${esc(config.zhongtai.baseUrl)}"></label>
      <label class="field"><span>账号</span><input id="pair-user" autocomplete="username" placeholder="中台登录账号"></label>
      <label class="field"><span>密码</span><input id="pair-pass" type="password" autocomplete="current-password" placeholder="中台登录密码"></label>
      <div style="align-self:end"><button class="btn primary" data-action="pair" ${S.busy.pair ? "disabled" : ""}>${S.busy.pair ? "连接中…" : "登录并连接"}</button></div>
    </div>
  </section>`;
}

function viewHome() {
  const { config, history, cliPath, running, storeOverview } = S.state;
  const connected = config.zhongtai.hasToken;
  const stores = storeOverview || [];
  const enabled = stores.filter((store) => store.enabled);
  const unmatched = enabled.filter((store) => store.targets.some((target) => target.auto && !target.matched));
  const last = history[0];
  const pct = S.progressCount.total ? Math.round((S.progressCount.index / S.progressCount.total) * 100) : 0;
  const ready = connected && cliPath && enabled.length;
  return `
    <h1>总览</h1>
    <p class="subtitle">自动从紫鸟里已登录的 Shopee 店铺读取访客、曝光、加购、支付金额、订单和广告花费，写入中台「店铺日报」。</p>
    ${connected ? "" : connectCard()}
    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="check-card ${connected ? "ok" : "todo"}"><b>${connected ? "✓ " : ""}同舟中台</b><span>${connected ? `已连接${config.zhongtaiUser ? `（${esc(config.zhongtaiUser.displayName || config.zhongtaiUser.username)}）` : ""}` : "请先登录"}</span></div>
      <div class="check-card ${cliPath ? "ok" : "todo"}"><b>${cliPath ? "✓ " : ""}紫鸟</b><span>${cliPath ? "已连接紫鸟客户端" : "没有找到紫鸟 CLI"}</span>${cliPath ? "" : `<button class="btn small" data-action="cli-install">一键安装</button>`}</div>
      <div class="check-card ${enabled.length ? "ok" : "todo"}"><b>${enabled.length ? "✓ " : ""}店铺</b><span>${stores.length ? `${enabled.length} 个 Shopee 店铺参与采集${unmatched.length ? `，${unmatched.length} 个未对上中台店铺` : ""}` : "正在读取紫鸟店铺…"}</span>${stores.length ? `<button class="btn small" data-go="stores">查看</button>` : ""}</div>
    </div>
    <section class="panel">
      <div class="panel-head">
        <div><h2>采集</h2><p>${config.schedule.enabled ? `每天 ${esc(config.schedule.times.join("、"))} 自动采集最近 ${config.schedule.lookbackDays} 天` : "还没开启每天自动采集"} · <button class="btn link" data-action="toggle-schedule">${config.schedule.enabled ? "关闭自动采集" : "开启每天 09:30 自动采集"}</button></p></div>
        <div class="toolbar" style="margin:0">
          <select data-bind="run.range" style="min-width:150px">
            <option value="auto" ${S.run.range === "auto" ? "selected" : ""}>最近 ${config.schedule.lookbackDays} 天</option>
            <option value="yesterday" ${S.run.range === "yesterday" ? "selected" : ""}>仅昨天</option>
            <option value="custom" ${S.run.range === "custom" ? "selected" : ""}>自定义日期…</option>
          </select>
          ${S.run.range === "custom" ? `<input type="date" data-bind="run.from" value="${esc(S.run.from)}"><input type="date" data-bind="run.to" value="${esc(S.run.to)}">` : ""}
          ${running ? `<button class="btn danger" data-action="cancel">停止</button>` : ""}
          <button class="btn primary" data-action="collect" ${running || !ready ? "disabled" : ""}>${running ? "采集中…" : "开始采集并写入中台"}</button>
        </div>
      </div>
      ${running || S.progress.length ? `
        <div class="bar"><div style="width:${running ? pct : 100}%"></div></div>
        <ul class="progress-list">${S.progress.slice(-80).reverse().map((item) => `<li><span class="muted">${esc(item.time)}</span> ${esc(item.message)}</li>`).join("")}</ul>` : ""}
    </section>
    ${last ? `<section class="panel">${runSummary(last)}</section>` : ""}
  `;
}

function runSummary(run, { detail = false } = {}) {
  const upload = run.upload;
  return `
    <div class="panel-head">
      <div><h2>${detail ? "采集详情" : "最近一次采集"} ${statusTag(run.status)}</h2><p>${fmtTime(run.startedAt)} 开始${run.finishedAt ? ` · ${fmtTime(run.finishedAt)} 结束` : ""} · ${run.trigger === "schedule" ? "定时" : "手动"} · ${run.rowCount} 行</p></div>
      ${detail ? "" : `<button class="btn small" data-action="history-open" data-id="${esc(run.id)}">查看详情</button>`}
    </div>
    ${upload ? `<div class="notice ${upload.ok ? "" : "err"}" style="margin-bottom:10px">${upload.ok ? `中台${upload.dryRun ? "试匹配" : "写入"}：${upload.rowCount} 行 / ${upload.shopCount} 个店铺${upload.dryRun ? "" : `，已写入 ${upload.written} 行`}${upload.errors.length ? `；${upload.errors.length} 条错误` : ""}${upload.warnings.length ? `；${upload.warnings.length} 条提醒` : ""}` : `写入中台失败：${esc(upload.message)}（可在「采集记录」里重新上传）`}</div>` : ""}
    <div class="table-wrap" style="max-height:260px"><table class="data">
      <thead><tr><th>紫鸟店铺</th><th>状态</th><th class="num">行数</th><th>说明</th></tr></thead>
      <tbody>${run.stores.map((store) => `<tr><td>${esc(store.storeName)}</td><td>${statusTag(store.status)}</td><td class="num">${store.rowCount}</td><td class="muted">${esc(store.message)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">没有店铺</td></tr>`}</tbody>
    </table></div>
  `;
}

// ---------------------------------------------------------------------------
// 页面：店铺映射
// ---------------------------------------------------------------------------

function viewStores() {
  const { storeOverview, config, sites } = S.state;
  const list = (storeOverview || []).filter((store) => !S.storeFilter.trim() || `${store.storeName} ${store.storeId}`.toLowerCase().includes(S.storeFilter.trim().toLowerCase()));
  const shops = config.zhongtaiShops || [];
  return `
    <h1>店铺</h1>
    <p class="subtitle">紫鸟里的 Shopee 店铺会自动参与采集，并按店铺名自动对应中台店铺。对不上的店铺在右侧选一下即可。</p>
    <div class="toolbar">
      <button class="btn" data-action="stores-refresh" ${S.busy.stores ? "disabled" : ""}>${S.busy.stores ? "读取中…" : "重新读取紫鸟店铺"}</button>
      <input placeholder="搜索店铺" data-bind="storeFilter" value="${esc(S.storeFilter)}" style="width:200px">
      <span class="grow"></span>
      <span class="muted small">${list.length} 个店铺${config.storeCacheAt ? ` · 读取于 ${fmtTime(config.storeCacheAt)}` : ""}${shops.length ? ` · 中台店铺 ${shops.length} 个` : " · 连接中台后可自动对应店铺"}</span>
    </div>
    <div class="table-wrap" style="max-height:none"><table class="data">
      <thead><tr><th style="width:56px">采集</th><th>紫鸟店铺</th><th style="width:110px">站点</th><th>对应的中台店铺</th><th style="width:220px">上次结果</th><th style="width:70px"></th></tr></thead>
      <tbody>${list.map((store) => {
        const target = store.targets[0] || {};
        const multi = store.targets.length > 1;
        const options = shops.filter((shop) => !store.site || !shop.countryCode || shop.countryCode === store.site);
        const selected = target.shopKey || "";
        return `<tr>
          <td><input type="checkbox" data-action="store-toggle" data-id="${esc(store.storeId)}" ${store.enabled ? "checked" : ""}></td>
          <td><b>${esc(store.storeName)}</b><div class="muted small">${esc(store.platformName)}</div></td>
          <td>${store.site ? esc((sites.find((site) => site.code === store.site) || {}).name || store.site) : `<span class="tag warn">未识别</span>`}</td>
          <td>${multi ? store.targets.map((item) => `<span class="tag info">${esc(item.shopName)}</span>`).join(" ") : `
            <select data-action="store-shop" data-id="${esc(store.storeId)}" style="max-width:320px">
              <option value="">${target.auto && !target.matched ? `（未对上）按「${esc(store.storeName)}」新建` : `按「${esc(target.shopName)}」`}</option>
              ${options.map((shop) => `<option value="${esc(shop.shopKey)}" ${shop.shopKey === selected ? "selected" : ""}>${esc(shop.shopName)}${shop.country ? ` · ${esc(shop.country)}` : ""}</option>`).join("")}
            </select>
            ${target.auto && target.matched ? `<span class="tag ok">自动对应</span>` : ""}${target.auto && !target.matched && shops.length ? `<span class="tag warn">请选择</span>` : ""}`}
          </td>
          <td>${store.last ? `${statusTag(store.last.status)} <span class="muted small">${esc(store.last.message || `${store.last.rowCount} 行`)}</span>` : `<span class="muted">—</span>`}</td>
          <td><button class="btn small" data-action="store-trial" data-id="${esc(store.storeId)}" ${S.state.running || !config.zhongtai.hasToken ? "disabled" : ""} title="只采集昨天，并在中台试匹配，不写入">试采</button></td>
        </tr>`;
      }).join("") || `<tr><td colspan="6" class="empty">没有读取到 Shopee 店铺。确认紫鸟客户端已登录，然后点「重新读取紫鸟店铺」。</td></tr>`}</tbody>
    </table></div>
  `;
}

// ---------------------------------------------------------------------------
// 页面：采集模板 / 校准
// ---------------------------------------------------------------------------

function newCal(template = null) {
  const platform = S.state.platforms[0];
  return {
    template: template ? JSON.parse(JSON.stringify(template)) : null,
    platformId: template?.platform || platform.id,
    sellerCenter: template?.sellerCenter || "cnsc",
    page: platform.discoveryPages[0].id,
    customUrl: "",
    storeId: "",
    discovery: null,
    selected: new Set(),
    shopIds: "",
    notes: [],
    samples: {},
    trial: null,
    trialDate: yesterday(),
    trialSite: "MY",
    trialShopId: "",
    name: template?.name || "",
  };
}

function calPageUrl() {
  const platform = S.state.platforms.find((item) => item.id === S.cal.platformId);
  if (S.cal.page === "custom") return S.cal.customUrl.trim();
  const origin = platform.sellerCenters.find((item) => item.id === S.cal.sellerCenter)?.origin;
  const page = platform.discoveryPages.find((item) => item.id === S.cal.page);
  return `${origin}${page.path}`;
}

function viewTemplates() {
  const { config, templateProblems } = S.state;
  const templates = [...(S.state.builtinTemplates || []), ...Object.values(config.templates)];
  if (S.cal) return viewCalibrate();
  return `
    <h1>采集模板（高级）</h1>
    <p class="subtitle">程序已内置 Shopee 本土店模板，正常情况下不需要动这里。只有 Shopee 卖家中心改版、数据取不到时，才需要用一个店铺重新校准。</p>
    <div class="toolbar">
      <button class="btn primary" data-action="cal-new">新建模板（校准）</button>
      <button class="btn" data-action="tpl-import">导入模板文件</button>
    </div>
    <div class="table-wrap" style="max-height:none"><table class="data">
      <thead><tr><th>模板</th><th>卖家中心</th><th class="num">接口</th><th>已映射字段</th><th>检查</th><th>更新</th><th style="width:220px"></th></tr></thead>
      <tbody>${templates.map((template) => {
        const problems = templateProblems[template.id] || [];
        const fields = Object.entries(template.metrics || {}).filter(([, mapping]) => mapping?.path).map(([key]) => S.state.metricFields.find((field) => field.key === key)?.label.replace(/（.*）/, "") || key);
        const used = Object.values(config.stores).filter((store) => store.templateId === template.id).length;
        return `<tr>
          <td><b>${esc(template.name)}</b><div class="muted small">${used} 个店铺在用</div></td>
          <td>${esc(template.sellerCenter)}</td>
          <td class="num">${template.endpoints.length}</td>
          <td><div class="chips">${fields.map((field) => `<span class="tag">${esc(field)}</span>`).join("")}</div></td>
          <td>${problems.length ? `<span class="tag warn" title="${esc(problems.join("\n"))}">${problems.length} 个提醒</span>` : `<span class="tag ok">完整</span>`}</td>
          <td class="muted">${fmtTime(template.updatedAt)}</td>
          <td style="text-align:right">${template.builtin ? `<span class="tag ok">内置 · 默认使用</span>` : `<button class="btn small" data-action="cal-edit" data-id="${esc(template.id)}">编辑 / 校准</button> <button class="btn small" data-action="tpl-export" data-id="${esc(template.id)}">导出</button> <button class="btn small danger" data-action="tpl-delete" data-id="${esc(template.id)}">删除</button>`}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="7" class="empty">还没有模板。点「新建模板（校准）」，用一个已登录 Shopee 的紫鸟店铺跑一遍校准。</td></tr>`}</tbody>
    </table></div>
  `;
}

function viewCalibrate() {
  const cal = S.cal;
  const platform = S.state.platforms.find((item) => item.id === cal.platformId);
  const stores = S.state.config.storeCache || [];
  const template = cal.template;
  const step1Done = Boolean(cal.discovery);
  const step2Done = Boolean(template && template.endpoints.length);
  return `
    <div class="toolbar"><button class="btn small" data-action="cal-close">← 返回模板列表</button></div>
    <h1>${template?.id ? `校准模板：${esc(template.name)}` : "新建采集模板"}</h1>
    <p class="subtitle">整个过程只读取数据，不会修改店铺里的任何设置。</p>
    <div class="steps">
      <section class="panel step ${step1Done ? "done" : ""}"><div class="step-no">1</div><div>
        <h3>打开卖家中心并抓取数据接口</h3>
        <div class="grid cols-4">
          <label class="field"><span>用哪个紫鸟店铺校准</span><select data-bind="cal.storeId"><option value="">— 选择店铺 —</option>${stores.map((store) => `<option value="${esc(store.storeId)}" ${cal.storeId === store.storeId ? "selected" : ""}>${esc(store.storeName)}</option>`).join("")}</select></label>
          <label class="field"><span>卖家中心</span><select data-bind="cal.sellerCenter">${platform.sellerCenters.map((item) => `<option value="${item.id}" ${cal.sellerCenter === item.id ? "selected" : ""}>${esc(item.label)}</option>`).join("")}</select></label>
          <label class="field"><span>页面</span><select data-bind="cal.page">${platform.discoveryPages.map((item) => `<option value="${item.id}" ${cal.page === item.id ? "selected" : ""}>${esc(item.label)}</option>`).join("")}<option value="custom" ${cal.page === "custom" ? "selected" : ""}>自定义地址…</option></select></label>
          ${cal.page === "custom" ? `<label class="field"><span>页面地址</span><input class="mono" data-bind="cal.customUrl" value="${esc(cal.customUrl)}" placeholder="https://seller.shopee.cn/..."></label>` : `<div class="url-preview muted small mono">${esc(calPageUrl())}</div>`}
        </div>
        ${!stores.length ? `<p class="notice warn">先到「店铺映射」点「从紫鸟读取店铺」。</p>` : ""}
        <div class="toolbar" style="margin-top:12px">
          <button class="btn primary" data-action="cal-discover" ${cal.storeId && !S.busy.discover ? "" : "disabled"}>${S.busy.discover ? "正在打开并抓取…" : "打开并抓取接口"}</button>
          <button class="btn" data-action="cal-rediscover" ${cal.discovery && !S.busy.discover ? "" : "disabled"}>我已在窗口里操作，再抓一次</button>
        </div>
        <div class="notice small">
          抓取后，可以在紫鸟弹出的店铺窗口里：把日期切到<b>「昨天」</b>、打开<b>广告报表</b>等你需要的数据，然后点「再抓一次」，新出现的接口（包括广告的 POST 接口）都会被记下来。三个页面（概览 / 流量 / 广告）可以依次抓取，接口会累积到同一个模板里。
        </div>
      </div></section>

      ${cal.discovery ? `<section class="panel step ${step2Done ? "done" : ""}"><div class="step-no">2</div><div>
        <div class="panel-head"><div><h3>选择数据接口</h3><p>当前页面：<span class="mono">${esc(cal.discovery.href)}</span> · 找到 ${cal.discovery.requests.length} 个带数字的接口</p></div></div>
        <div class="table-wrap" style="max-height:340px"><table class="data">
          <thead><tr><th style="width:36px"></th><th>接口</th><th class="num">数字字段</th><th>预览</th></tr></thead>
          <tbody>${cal.discovery.requests.map((request) => {
            const url = (() => {
              try {
                const parsed = new URL(request.url);
                return `${parsed.pathname}${parsed.search ? ` <span class="muted">${esc(parsed.search.slice(0, 120))}${parsed.search.length > 120 ? "…" : ""}</span>` : ""}`;
              } catch {
                return esc(request.url);
              }
            })();
            return `<tr>
              <td><input type="checkbox" data-action="cal-pick" data-index="${request.index}" ${cal.selected.has(request.index) ? "checked" : ""}></td>
              <td><span class="tag ${request.method === "POST" ? "warn" : ""}">${request.method}</span> <span class="mono">${url}</span>${request.businessError ? `<div class="small" style="color:var(--red)">接口提示：${esc(request.businessError)}</div>` : ""}</td>
              <td class="num">${request.numberCount}</td>
              <td><details><summary>查看</summary><div class="leaf-list">${request.preview.slice(0, 80).map((leaf) => `<div><span>${esc(leaf.path)}</span><b>${esc(leaf.value)}</b></div>`).join("")}</div></details></td>
            </tr>`;
          }).join("") || `<tr><td colspan="4" class="empty">没有找到数据接口。确认页面已经加载出数据后点「再抓一次」。</td></tr>`}</tbody>
        </table></div>
        <div class="grid cols-3" style="margin-top:12px">
          <label class="field"><span>Shopee 店铺 ID（可选）</span><input class="mono" data-bind="cal.shopIds" value="${esc(cal.shopIds)}" placeholder="多个用逗号分隔"><span class="hint">${esc(platform.shopIdHint)}。填写后接口里的店铺 ID 会变成占位符，同一模板可用于其他店铺。</span></label>
          <label class="field"><span>模板名称</span><input data-bind="cal.name" value="${esc(cal.name)}" placeholder="例如 Shopee CNSC"></label>
          <div style="align-self:end"><button class="btn primary" data-action="cal-build" ${cal.selected.size ? "" : "disabled"}>${template?.endpoints?.length ? "把选中的接口加入模板" : "用选中的接口生成模板"}</button></div>
        </div>
        ${cal.notes.length ? `<div class="notice small" style="margin-top:10px"><b>识别到的可变参数</b><ul>${cal.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul></div>` : ""}
      </div></section>` : ""}

      ${template ? viewMapping(template) : ""}
    </div>
  `;
}

function viewMapping(template) {
  const cal = S.cal;
  const fields = S.state.metricFields;
  const trialValues = cal.trial?.values || {};
  return `
    <section class="panel step"><div class="step-no">3</div><div>
      <div class="panel-head"><div><h3>字段映射</h3><p>已根据字段名自动建议，请对照卖家中心页面上的数字核对。广告花费如果比页面上大 10 万倍，把「除以」填 100000。</p></div></div>
      <div class="map-row muted small"><span>中台字段</span><span>接口</span><span>数据位置（JSON 路径，[*] 表示求和）</span><span>除以</span><span style="text-align:right">试采值</span></div>
      ${fields.map((field) => {
        const mapping = template.metrics[field.key] || {};
        const leaves = cal.samples[mapping.endpoint] || [];
        return `<div class="map-row">
          <b>${esc(field.label)}</b>
          <select data-map="${field.key}.endpoint"><option value="">不采集</option>${template.endpoints.map((endpoint) => `<option value="${esc(endpoint.id)}" ${mapping.endpoint === endpoint.id ? "selected" : ""}>${esc(endpoint.id)} ${esc(endpoint.label)}</option>`).join("")}</select>
          <input class="mono" list="leaves-${field.key}" data-map="${field.key}.path" value="${esc(mapping.path || "")}" ${mapping.endpoint ? "" : "disabled"}>
          <input type="number" min="0" data-map="${field.key}.scale" value="${esc(mapping.scale || 1)}" ${mapping.endpoint ? "" : "disabled"}>
          <span class="value">${trialValues[field.key] !== undefined ? esc(Number(trialValues[field.key]).toLocaleString()) : cal.trial && mapping.path ? `<span class="tag warn">未取到</span>` : ""}</span>
          <datalist id="leaves-${field.key}">${leaves.map((leaf) => `<option value="${esc(leaf.path)}">${esc(leaf.value)}</option>`).join("")}</datalist>
        </div>`;
      }).join("")}
      <details style="margin-top:12px"><summary>接口详情（高级：可直接修改地址与请求体中的占位符）</summary>
        <p class="muted small">可用占位符：{startTs} {endTs} 当天起止秒、{startMs} {endMs} 毫秒、{date} 日期、{dateCompact} 无横线日期、{shopId} 店铺 ID、{cookie:名称} 页面 Cookie。</p>
        ${template.endpoints.map((endpoint, index) => `<div class="panel" style="padding:10px 12px">
          <div class="toolbar" style="margin-bottom:6px"><b>${esc(endpoint.id)}</b> <span class="tag">${esc(endpoint.method)}</span> <input data-endpoint="${index}.label" value="${esc(endpoint.label)}" style="width:220px"><span class="grow"></span><button class="btn small danger" data-action="endpoint-remove" data-index="${index}">移除接口</button></div>
          <textarea data-endpoint="${index}.url" rows="2">${esc(endpoint.url)}</textarea>
          ${endpoint.body !== null && endpoint.body !== undefined ? `<textarea data-endpoint="${index}.body" rows="3" style="margin-top:6px;width:100%">${esc(endpoint.body)}</textarea>` : ""}
          ${Object.keys(endpoint.headers || {}).length ? `<div class="muted small mono" style="margin-top:4px">请求头：${esc(Object.entries(endpoint.headers).map(([key, value]) => `${key}: ${value}`).join("  ·  "))}</div>` : ""}
        </div>`).join("")}
      </details>
    </div></section>

    <section class="panel step ${cal.trial ? "done" : ""}"><div class="step-no">4</div><div>
      <h3>试采并保存</h3>
      <div class="grid cols-4">
        <label class="field"><span>日期</span><input type="date" data-bind="cal.trialDate" value="${esc(cal.trialDate)}"></label>
        <label class="field"><span>站点（决定时区）</span><select data-bind="cal.trialSite">${siteOptions(cal.trialSite)}</select></label>
        <label class="field"><span>Shopee 店铺 ID</span><input class="mono" data-bind="cal.trialShopId" value="${esc(cal.trialShopId)}" placeholder="模板含 {shopId} 时必填"></label>
        <div style="align-self:end" class="toolbar"><button class="btn" data-action="cal-trial" ${cal.storeId && !S.busy.trial ? "" : "disabled"}>${S.busy.trial ? "试采中…" : "试采这一天"}</button></div>
      </div>
      ${cal.trial ? `<div class="notice ${cal.trial.missing.length || cal.trial.endpoints.some((endpoint) => endpoint.error) ? "warn" : ""}" style="margin-top:10px">
        ${cal.trial.endpoints.map((endpoint) => `<div>${esc(endpoint.id)} ${esc(endpoint.label)}：${endpoint.error ? `<b>${esc(endpoint.error)}</b>` : `HTTP ${endpoint.status} · ${endpoint.ms}ms`}</div>`).join("")}
        ${cal.trial.missing.length ? `<div>未取到：${esc(cal.trial.missing.join("、"))}</div>` : ""}
        <div style="margin-top:4px">请打开卖家中心把 ${esc(cal.trial.date)} 的数字和上面「试采值」一一对照，一致后保存。</div>
      </div>` : ""}
      <div class="toolbar" style="margin-top:12px">
        <span class="grow"></span>
        <button class="btn primary" data-action="cal-save">保存模板</button>
      </div>
    </div></section>
  `;
}

// ---------------------------------------------------------------------------
// 页面：采集记录
// ---------------------------------------------------------------------------

function viewHistory() {
  const history = S.state.history;
  const detail = S.historyDetail ? history.find((run) => run.id === S.historyDetail) : null;
  if (detail) {
    const rows = S.historyRows || [];
    const fields = S.state.metricFields;
    return `
      <div class="toolbar"><button class="btn small" data-action="history-back">← 返回记录列表</button><span class="grow"></span>
        <button class="btn small" data-action="history-reupload" data-id="${esc(detail.id)}" data-dry="1">中台试匹配</button>
        <button class="btn small primary" data-action="history-reupload" data-id="${esc(detail.id)}">重新写入中台</button></div>
      <section class="panel">${runSummary(detail, { detail: true })}</section>
      ${detail.upload?.errors?.length || detail.upload?.warnings?.length ? `<section class="panel"><h3>中台返回</h3>
        ${(detail.upload.errors || []).map((error) => `<div class="small" style="color:var(--red)">✗ ${esc(error.message)}</div>`).join("")}
        ${(detail.upload.warnings || []).map((warning) => `<div class="small" style="color:var(--amber)">! ${esc(warning.message)}</div>`).join("")}</section>` : ""}
      ${detail.issues?.length ? `<section class="panel"><h3>采集提醒（${detail.issues.length}）</h3><div class="table-wrap" style="max-height:260px"><table class="data"><tbody>
        ${detail.issues.map((issue) => `<tr><td>${issue.level === "error" ? `<span class="tag err">错误</span>` : `<span class="tag warn">提醒</span>`}</td><td>${esc(issue.storeName)}</td><td>${esc(issue.shopName || "")}</td><td>${esc(issue.date || "")}</td><td>${esc(issue.message)}</td></tr>`).join("")}
      </tbody></table></div></section>` : ""}
      <section class="panel"><h3>采集到的数据（${rows.length} 行）</h3><div class="table-wrap"><table class="data">
        <thead><tr><th>日期</th><th>中台店铺</th><th>站点</th><th>币种</th>${fields.map((field) => `<th class="num">${esc(field.label.replace(/（.*）/, ""))}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${esc(row.date)}</td><td>${esc(row.shopName)}<div class="muted small">${esc(row._store || "")}</div></td><td>${esc(row.country)}</td><td>${esc(row.currency)}</td>${fields.map((field) => `<td class="num">${row[field.key] === undefined ? "" : esc(Number(row[field.key]).toLocaleString())}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${4 + fields.length}" class="empty">没有数据</td></tr>`}</tbody>
      </table></div></section>`;
  }
  return `
    <h1>采集记录</h1>
    <p class="subtitle">最近 200 次采集。写入中台失败时可以在详情里重新写入。</p>
    <div class="table-wrap" style="max-height:none"><table class="data">
      <thead><tr><th>开始时间</th><th>方式</th><th>状态</th><th class="num">店铺</th><th class="num">行数</th><th>中台</th><th></th></tr></thead>
      <tbody>${history.map((run) => `<tr>
        <td>${fmtTime(run.startedAt)}</td>
        <td>${run.trigger === "schedule" ? "定时" : "手动"} · ${run.mode === "upload" ? "写入" : run.mode === "preview" ? "试匹配" : "本地"}</td>
        <td>${statusTag(run.status)}</td>
        <td class="num">${run.stores.filter((store) => store.status === "ok" || store.status === "partial").length}/${run.stores.length}</td>
        <td class="num">${run.rowCount}</td>
        <td>${run.upload ? (run.upload.ok ? `<span class="tag ok">${run.upload.dryRun ? "可匹配" : "已写入"} ${run.upload.dryRun ? run.upload.rowCount : run.upload.written}</span>` : `<span class="tag err">失败</span>`) : `<span class="muted">—</span>`}</td>
        <td style="text-align:right"><button class="btn small" data-action="history-open" data-id="${esc(run.id)}">详情</button></td>
      </tr>`).join("") || `<tr><td colspan="7" class="empty">还没有采集记录</td></tr>`}</tbody>
    </table></div>`;
}

// ---------------------------------------------------------------------------
// 页面：设置
// ---------------------------------------------------------------------------

function viewSettings() {
  const { config, cliPath, openAtLogin, cliVersion } = S.state;
  const diag = S.diag;
  return `
    <h1>设置</h1>
    <p class="subtitle">配置保存在本机，采集令牌使用 Windows 账户加密保存。</p>
    ${config.zhongtai.hasToken ? `<section class="panel">
      <div class="panel-head"><div><h2>同舟供应链中台</h2><p>已连接 ${esc(config.zhongtai.baseUrl)}${config.zhongtaiUser ? `（${esc(config.zhongtaiUser.displayName || config.zhongtaiUser.username)} 于 ${fmtTime(config.zhongtaiUser.at)} 登录）` : ""}</p></div>
      <div class="toolbar" style="margin:0"><button class="btn" data-action="test-zhongtai" ${S.busy.zt ? "disabled" : ""}>${S.busy.zt ? "测试中…" : "测试连接"}</button><button class="btn" data-action="unpair">断开 / 换账号</button></div></div>
    </section>` : connectCard()}
    <section class="panel">
      <div class="panel-head"><div><h2>紫鸟 CLI</h2><p>需要紫鸟浏览器客户端已安装并登录。CLI 当前路径：<span class="mono">${esc(cliPath || "未找到")}</span></p></div></div>
      <div class="toolbar">
        <button class="btn" data-action="cli-diagnose" ${S.busy.diag ? "disabled" : ""}>${S.busy.diag ? "检查中…" : "检查紫鸟环境"}</button>
        <button class="btn" data-action="cli-install" ${S.busy.install ? "disabled" : ""}>${S.busy.install ? "下载中…" : `${cliPath ? "重新" : "一键"}安装紫鸟 CLI ${esc(cliVersion)}`}</button>
        <button class="btn" data-action="cli-pick">手动选择 ziniao-cli.exe</button>
      </div>
      ${diag ? `<div class="notice ${diag.doctorError ? "warn" : ""}">
        <div>路径：<span class="mono">${esc(diag.path || "未找到")}</span></div>
        <div>版本：${esc(diag.version || "")}</div>
        <div>环境检查（doctor）：${diag.doctorError ? `<b>${esc(diag.doctorError)}</b>` : "通过"}</div>
        ${diag.execStyle ? `<div>页面脚本方式：<span class="mono">${esc(diag.execStyle.command)} ${esc(diag.execStyle.flag)}</span></div>` : ""}
        ${diag.doctor ? `<details><summary>doctor 明细</summary><pre class="mono small">${esc(JSON.stringify(diag.doctor, null, 2))}</pre></details>` : ""}
      </div>` : ""}
      <div class="grid cols-4" style="margin-top:12px">
        <label class="inline"><input type="checkbox" id="set-headless" ${config.ziniao.headless ? "checked" : ""}> 后台（无窗口）打开店铺</label>
        <label class="inline"><input type="checkbox" id="set-close" ${config.ziniao.closeAfter ? "checked" : ""}> 采集后关闭本次打开的店铺窗口</label>
        <label class="field"><span>单店失败重试次数</span><input type="number" min="0" max="3" id="set-retry" value="${esc(config.ziniao.retryPerStore)}"></label>
        <label class="field"><span>单店接口超时（秒）</span><input type="number" min="60" max="900" id="set-timeout" value="${esc(config.ziniao.storeTimeoutSec)}"></label>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>定时采集</h2><p>按这台电脑的本地时间执行。电脑需要开机且紫鸟客户端处于登录状态；错过时刻 2 小时内开机会自动补跑。</p></div></div>
      <div class="grid cols-4">
        <label class="inline"><input type="checkbox" id="set-sched" ${config.schedule.enabled ? "checked" : ""}> 开启每天定时采集</label>
        <label class="field"><span>时刻（多个用逗号分隔）</span><input id="set-times" value="${esc(config.schedule.times.join(", "))}" placeholder="09:30, 21:30"></label>
        <label class="field"><span>每次采集最近几天</span><input type="number" min="1" max="31" id="set-lookback" value="${esc(config.schedule.lookbackDays)}"><span class="hint">Shopee 数据次日才稳定，建议 3 天，旧数据会被新值覆盖</span></label>
        <label class="field"><span>采集后</span><select id="set-auto"><option value="1" ${config.schedule.autoUpload ? "selected" : ""}>自动写入中台</option><option value="0" ${config.schedule.autoUpload ? "" : "selected"}>只试匹配，不写入</option></select></label>
        <label class="inline"><input type="checkbox" id="set-today" ${config.schedule.includeToday ? "checked" : ""}> 同时采集今天（实时数据，不完整）</label>
        <label class="inline"><input type="checkbox" id="set-login" ${openAtLogin ? "checked" : ""}> 开机自动启动（后台运行）</label>
      </div>
      <div class="toolbar" style="margin-top:12px"><button class="btn primary" data-action="save-collect">保存采集与定时设置</button></div>
    </section>
    <section class="panel">
      <div class="toolbar" style="margin:0"><button class="btn" data-action="open-data">打开数据目录</button><button class="btn" data-action="relaunch">重启程序</button><span class="muted small">版本 ${esc(S.state.appVersion)}</span></div>
      <div style="margin-top:10px"><div class="muted small">调试工具（技术人员使用）</div>
        <div class="toolbar" style="margin-top:8px"><input id="dbg-args" class="mono grow" value="${esc(S.debugArgs || "store list")}" placeholder="紫鸟 CLI 参数，例如 store list"><button class="btn" data-action="debug-cli">运行 CLI</button></div>
        <div class="toolbar"><input id="dbg-store" class="mono" style="width:180px" value="${esc(S.debugStore || "")}" placeholder="店铺 ID"><input id="dbg-body" class="mono grow" value="${esc(S.debugBody || "return {href: location.href, title: document.title}")}"><button class="btn" data-action="debug-page">页面内执行</button></div>
        <textarea id="dbg-out" class="mono" rows="16" style="width:100%" readonly>${esc(S.debugOut || "")}</textarea>
      </div>
    </section>
  `;
}

function viewLogs() {
  return `
    <h1>日志</h1>
    <div class="toolbar"><button class="btn" data-action="open-logs">打开日志文件夹</button></div>
    <pre class="log">${S.state.logs.slice().reverse().map((line) => `<span class="${line.level}">${esc(line.at.slice(5, 19).replace("T", " "))} [${esc(line.level)}] ${esc(line.message)}</span>`).join("\n")}</pre>
  `;
}

// ---------------------------------------------------------------------------
// 渲染与事件
// ---------------------------------------------------------------------------

function render() {
  if (!S.state) return;
  const views = { home: viewHome, stores: viewStores, templates: viewTemplates, history: viewHistory, settings: viewSettings, logs: viewLogs };
  const scroll = $("#main").scrollTop;
  $("#main").innerHTML = views[S.tab]();
  $("#main").scrollTop = scroll;
  document.querySelectorAll("#nav button").forEach((button) => button.classList.toggle("active", button.dataset.tab === S.tab));
  $("#app-version").textContent = `v${S.state.appVersion} · 店铺数据采集`;
  const { config, running } = S.state;
  $("#side-status").innerHTML = `<div><span class="dot ${running ? "busy" : config.schedule.enabled ? "on" : ""}"></span>${running ? "采集中" : config.schedule.enabled ? `定时 ${esc(config.schedule.times.join("、"))}` : "未开启定时"}</div>`;
}

function setPath(target, pathText, value) {
  const keys = pathText.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) node = node[key];
  node[keys.at(-1)] = value;
}

function collectDates() {
  if (S.run.range === "yesterday") return [yesterday()];
  if (S.run.range === "custom") {
    if (!S.run.from || !S.run.to || S.run.from > S.run.to) {
      toast("请选择正确的日期区间", "err");
      return undefined;
    }
    const list = [];
    for (let day = S.run.from; day <= S.run.to && list.length < 62;) {
      list.push(day);
      const next = new Date(`${day}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      day = next.toISOString().slice(0, 10);
    }
    return list;
  }
  return null;
}

const actions = {
  async pair() {
    const username = $("#pair-user").value.trim();
    const password = $("#pair-pass").value;
    if (!username || !password) return toast("请输入中台账号和密码", "err");
    await withBusy("pair", async () => {
      S.state = await api("zhongtai:pair", { baseUrl: $("#pair-base").value, username, password });
      toast("已连接中台", "ok");
    });
  },
  async unpair() {
    S.state = await api("zhongtai:unpair");
    render();
  },
  async "toggle-schedule"() {
    const enabled = !S.state.config.schedule.enabled;
    await api("settings:save", { schedule: { enabled, times: S.state.config.schedule.times.length ? S.state.config.schedule.times : ["09:30"] }, openAtLogin: enabled ? true : undefined });
    toast(enabled ? `已开启：每天 ${S.state.config.schedule.times.join("、") || "09:30"} 自动采集，并设为开机自动启动` : "已关闭自动采集", "ok");
    await reload();
  },
  async collect() {
    const dates = collectDates();
    if (dates === undefined) return;
    S.progress = [];
    S.progressCount = { index: 0, total: 0 };
    await api("collect:start", { dates, mode: S.run.mode });
    S.state.running = true;
    render();
  },
  async cancel() {
    await api("collect:cancel");
  },
  async "stores-refresh"() {
    await withBusy("stores", async () => {
      const list = await api("stores:refresh");
      toast(`读取到 ${list.length} 个紫鸟店铺`, "ok");
      await reload();
    });
  },
  async "zt-shops"() {
    await withBusy("ztShops", async () => {
      S.zhongtaiShops = await api("zhongtai:shops");
      toast(S.zhongtaiShops.length ? `中台店铺 ${S.zhongtaiShops.length} 个，填写店铺名时可下拉选择` : "中台没有返回店铺名单（中台可能还未更新到支持该功能的版本）");
    });
  },
  "store-edit"(el) {
    const id = el.dataset.id;
    if (S.editingStore === id) {
      S.editingStore = null;
      return render();
    }
    const mapping = S.state.config.stores[id];
    const cached = (S.state.config.storeCache || []).find((store) => store.storeId === id) || {};
    S.editingStore = id;
    S.storeDraft = { targets: (mapping?.targets || []).map((target) => ({ ...target })) };
    if (!S.storeDraft.targets.length) S.storeDraft.targets.push({ shopName: cached.storeName || "", country: guessSite(cached.storeName), shopId: "", currency: "" });
    render();
  },
  "target-add"() {
    S.storeDraft.targets.push({ shopName: "", country: S.storeDraft.targets.at(-1)?.country || "MY", shopId: "", currency: "" });
    render();
  },
  "target-remove"(el) {
    S.storeDraft.targets.splice(Number(el.dataset.index), 1);
    render();
  },
  async "store-save"(el) {
    const id = el.dataset.id;
    const cached = (S.state.config.storeCache || []).find((store) => store.storeId === id) || {};
    const current = S.state.config.stores[id] || {};
    const targets = S.storeDraft.targets.filter((target) => target.shopName.trim()).map((target) => ({ ...target, shopName: target.shopName.trim(), currency: (target.currency || "").trim().toUpperCase() }));
    const templateId = current.templateId || (Object.keys(S.state.config.templates).length === 1 ? Object.keys(S.state.config.templates)[0] : "");
    await api("stores:save", { storeId: id, storeName: cached.storeName || current.storeName, platform: "shopee", templateId, enabled: Boolean(targets.length && templateId) && (current.enabled ?? true), targets });
    S.editingStore = null;
    toast("已保存", "ok");
    await reload();
  },
  async "store-remove"(el) {
    await api("stores:remove", { storeId: el.dataset.id });
    S.editingStore = null;
    await reload();
  },
  async "store-trial"(el) {
    S.progress = [];
    await api("collect:start", { storeIds: [el.dataset.id], dates: [yesterday()], mode: "preview" });
    S.state.running = true;
    S.tab = "home";
    toast("已开始试采（只在中台试匹配，不写入），进度见总览");
    render();
  },
  "cal-new"() {
    S.cal = newCal();
    const stores = S.state.config.storeCache || [];
    if (stores.length) S.cal.storeId = stores.find((store) => /shopee/i.test(store.platformName))?.storeId || stores[0].storeId;
    render();
  },
  "cal-edit"(el) {
    S.cal = newCal(S.state.config.templates[el.dataset.id]);
    const using = Object.values(S.state.config.stores).find((store) => store.templateId === el.dataset.id);
    if (using) {
      S.cal.storeId = using.storeId;
      const target = (using.targets || [])[0];
      if (target) {
        S.cal.trialSite = target.country;
        S.cal.trialShopId = target.shopId || "";
      }
    }
    render();
  },
  "cal-close"() {
    S.cal = null;
    render();
  },
  async "cal-discover"() {
    await discover(true);
  },
  async "cal-rediscover"() {
    await discover(false);
  },
  "cal-pick"(el) {
    const index = Number(el.dataset.index);
    if (el.checked) S.cal.selected.add(index);
    else S.cal.selected.delete(index);
    render();
  },
  async "cal-build"() {
    const cal = S.cal;
    const result = await api("calibrate:build", {
      storeId: cal.storeId,
      platformId: cal.platformId,
      indexes: [...cal.selected],
      name: cal.name,
      sellerCenter: cal.sellerCenter,
      shopIds: cal.shopIds.split(/[,，\s]+/).filter(Boolean),
      templateId: "",
      existing: cal.template,
    });
    if (cal.template) {
      // 追加到当前编辑中的模板：接口编号顺延，已有映射保留。
      const offset = cal.template.endpoints.length;
      const rename = {};
      result.template.endpoints.forEach((endpoint, index) => {
        const id = `e${offset + index + 1}`;
        rename[endpoint.id] = id;
        cal.template.endpoints.push({ ...endpoint, id });
      });
      for (const [field, mapping] of Object.entries(result.suggestions)) {
        if (!cal.template.metrics[field]?.path) cal.template.metrics[field] = { ...mapping, endpoint: rename[mapping.endpoint] || mapping.endpoint };
      }
      for (const [id, leaves] of Object.entries(result.samples)) cal.samples[rename[id] || id] = leaves;
      delete cal.template.metrics.undefined;
    } else {
      cal.template = result.template;
      Object.assign(cal.samples, result.samples);
    }
    for (const value of Object.values(cal.template.metrics)) delete value.sampleValue;
    if (!cal.name) cal.name = cal.template.name;
    cal.notes = result.notes;
    cal.selected = new Set();
    const firstShopId = cal.shopIds.split(/[,，\s]+/).filter(Boolean)[0];
    if (firstShopId && !cal.trialShopId) cal.trialShopId = firstShopId;
    toast(`已加入 ${result.template.endpoints.length} 个接口，自动建议了 ${Object.keys(result.suggestions).length} 个字段`, "ok");
    render();
  },
  "endpoint-remove"(el) {
    const [removed] = S.cal.template.endpoints.splice(Number(el.dataset.index), 1);
    for (const [field, mapping] of Object.entries(S.cal.template.metrics)) if (mapping.endpoint === removed.id) delete S.cal.template.metrics[field];
    render();
  },
  async "cal-trial"() {
    await withBusy("trial", async () => {
      const cal = S.cal;
      const result = await api("calibrate:test", { storeId: cal.storeId, template: { ...cal.template, name: cal.name || cal.template.name }, date: cal.trialDate, target: { country: cal.trialSite, shopId: cal.trialShopId } });
      cal.trial = result;
      for (const endpoint of result.endpoints) if (endpoint.preview.length) cal.samples[endpoint.id] = endpoint.preview;
    });
  },
  async "cal-save"() {
    const cal = S.cal;
    if (!cal.template) return;
    const saved = await api("templates:save", { ...cal.template, name: cal.name || cal.template.name });
    cal.template = saved;
    toast("模板已保存", "ok");
    await reload();
  },
  async "tpl-export"(el) {
    const file = await api("templates:export", { id: el.dataset.id });
    if (file) toast(`已导出：${file}`, "ok");
  },
  async "tpl-import"() {
    const saved = await api("templates:import");
    if (saved) {
      toast(`已导入模板「${saved.name}」`, "ok");
      await reload();
    }
  },
  async "tpl-delete"(el) {
    const template = S.state.config.templates[el.dataset.id];
    if (!window.confirm(`删除模板「${template.name}」？使用它的店铺会变成未选择模板。`)) return;
    await api("templates:delete", { id: el.dataset.id });
    await reload();
  },
  async "history-open"(el) {
    S.tab = "history";
    S.historyDetail = el.dataset.id;
    S.historyRows = await api("history:rows", { id: el.dataset.id });
    render();
  },
  "history-back"() {
    S.historyDetail = null;
    S.historyRows = null;
    render();
  },
  async "history-reupload"(el) {
    const dryRun = Boolean(el.dataset.dry);
    const result = await api("history:reupload", { id: el.dataset.id, dryRun });
    toast(`${dryRun ? "试匹配" : "写入"}完成：${dryRun ? result.rowCount : result.written} 行${result.errors.length ? `，${result.errors.length} 条错误` : ""}`, result.errors.length ? "err" : "ok");
    await reload();
  },
  async "save-zhongtai"() {
    const token = $("#set-token").value.trim();
    if (token && token.length < 24) return toast("令牌至少 24 位", "err");
    await api("settings:save", { zhongtai: { baseUrl: $("#set-base").value, token } });
    toast("已保存", "ok");
    await reload();
  },
  async "test-zhongtai"() {
    await withBusy("zt", async () => {
      const result = await api("zhongtai:test");
      if (result.shops) S.zhongtaiShops = result.shops;
      toast(`中台连接正常${result.shopsSupported ? `，读取到 ${result.shops.length} 个店铺` : "（当前中台版本不支持读取店铺名单，不影响写入）"}`, "ok");
    });
  },
  async "cli-diagnose"() {
    await withBusy("diag", async () => {
      S.diag = await api("cli:diagnose");
    });
  },
  async "cli-install"() {
    await withBusy("install", async () => {
      const result = await api("cli:install");
      toast(`已安装：${result.path}`, "ok");
      await reload();
    });
  },
  async "cli-pick"() {
    const file = await api("cli:pick");
    if (file) await reload();
  },
  async "save-collect"() {
    await api("settings:save", {
      ziniao: { headless: $("#set-headless").checked, closeAfter: $("#set-close").checked, retryPerStore: Number($("#set-retry").value) || 0, storeTimeoutSec: Number($("#set-timeout").value) || 240 },
      schedule: { enabled: $("#set-sched").checked, times: $("#set-times").value.split(/[,，\s]+/).filter(Boolean), lookbackDays: Math.min(31, Math.max(1, Number($("#set-lookback").value) || 3)), includeToday: $("#set-today").checked, autoUpload: $("#set-auto").value === "1" },
      openAtLogin: $("#set-login").checked,
    });
    toast("已保存", "ok");
    await reload();
  },
  "debug-toggle"() {
    S.debugOpen = !S.debugOpen;
  },
  async "debug-cli"() {
    S.debugOpen = true;
    S.debugArgs = $("#dbg-args").value;
    S.debugOut = "运行中…";
    render();
    try {
      const result = await api("debug:cli", { args: S.debugArgs }, { quiet: true });
      S.debugOut = `$ ziniao-cli ${result.args.join(" ")}\n退出码 ${result.code} · ${result.ms}ms\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
    } catch (error) {
      S.debugOut = `出错：${error.message}`;
    }
    render();
  },
  async "debug-page"() {
    S.debugOpen = true;
    S.debugStore = $("#dbg-store").value.trim();
    S.debugBody = $("#dbg-body").value;
    S.debugOut = "运行中…";
    render();
    try {
      const result = await api("debug:page", { storeId: S.debugStore, body: S.debugBody }, { quiet: true });
      S.debugOut = JSON.stringify(result, null, 2);
    } catch (error) {
      S.debugOut = `出错：${error.message}\n${error.detail || ""}`;
    }
    render();
  },
  async relaunch() {
    await window.tz.call("app:relaunch");
  },
  async "open-logs"() {
    await api("open:logs");
  },
  async "open-data"() {
    await api("open:data");
  },
};

async function discover(reopen) {
  await withBusy("discover", async () => {
    const cal = S.cal;
    const url = calPageUrl();
    if (!/^https:\/\//.test(url)) throw new Error("页面地址无效");
    const result = await api("calibrate:discover", { storeId: cal.storeId, platformId: cal.platformId, pageUrl: url, reopen });
    cal.discovery = result;
    // 默认勾选看起来像数据接口的请求（数字多、不是账号/店铺信息类）
    if (!cal.selected.size) {
      for (const request of result.requests) {
        if (/mydata|datacenter|pas|report|metric|overview|dashboard/i.test(request.url) && request.numberCount >= 3 && !request.businessError) cal.selected.add(request.index);
      }
    }
    toast(`找到 ${result.requests.length} 个数据接口`, "ok");
  });
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("#nav button");
  if (nav) {
    S.tab = nav.dataset.tab;
    if (S.tab === "history") S.historyDetail = null;
    reload();
    return;
  }
  const go = event.target.closest("[data-go]");
  if (go) {
    S.tab = go.dataset.go;
    render();
    return;
  }
  const el = event.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const name = el.dataset.action;
  if (el.tagName === "INPUT" || el.tagName === "SELECT") return;
  if (actions[name]) Promise.resolve(actions[name](el)).catch(() => {});
});

document.addEventListener("change", (event) => {
  const el = event.target;
  const value = el.type === "checkbox" ? el.checked : el.value;
  if (el.dataset.bind) {
    setPath(S, el.dataset.bind, value);
    if (["run.range", "cal.page", "onlyShopee", "cal.storeId", "cal.sellerCenter"].includes(el.dataset.bind)) render();
    return;
  }
  if (el.dataset.draft) {
    const [index, key] = el.dataset.draft.split(".");
    S.storeDraft.targets[Number(index)][key] = value;
    if (key === "shopName" && !S.storeDraft.targets[Number(index)].manualSite) {
      const shop = S.zhongtaiShops.find((item) => item.shopName === value);
      if (shop?.countryCode) S.storeDraft.targets[Number(index)].country = shop.countryCode;
      if (shop?.shopKey) S.storeDraft.targets[Number(index)].shopKey = shop.shopKey;
      render();
    }
    return;
  }
  if (el.dataset.map) {
    const [field, key] = el.dataset.map.split(".");
    const metrics = S.cal.template.metrics;
    metrics[field] = metrics[field] || { endpoint: "", path: "", scale: 1 };
    metrics[field][key] = key === "scale" ? Number(value) || 1 : value;
    if (key === "endpoint" && !value) delete metrics[field];
    render();
    return;
  }
  if (el.dataset.endpoint) {
    const [index, key] = el.dataset.endpoint.split(".");
    S.cal.template.endpoints[Number(index)][key] = value;
    return;
  }
  const name = el.dataset.action;
  if (name === "store-toggle" || name === "store-shop") {
    const id = el.dataset.id;
    const overview = (S.state.storeOverview || []).find((item) => item.storeId === id) || {};
    const current = S.state.config.stores[id] || { storeId: id, storeName: overview.storeName || id };
    let patch;
    if (name === "store-toggle") patch = { enabled: value };
    else {
      const shop = (S.state.config.zhongtaiShops || []).find((item) => item.shopKey === value);
      patch = { targets: shop ? [{ shopName: shop.shopName, shopKey: shop.shopKey, country: overview.site || shop.countryCode || "" }] : [] };
    }
    api("stores:save", { ...current, storeName: overview.storeName || current.storeName, ...patch }).then(reload).catch(() => {});
  }
  if (name === "cal-pick") actions["cal-pick"](el);
});

document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset.bind === "storeFilter") {
    S.storeFilter = el.value;
    const caret = el.selectionStart;
    render();
    const again = document.querySelector('[data-bind="storeFilter"]');
    again.focus();
    again.setSelectionRange(caret, caret);
  }
});

window.tz.on("progress", (event) => {
  const time = new Date().toTimeString().slice(0, 8);
  if (event.total) S.progressCount = { index: event.index, total: event.total };
  if (event.message) S.progress.push({ time, message: event.message });
  if (S.tab === "home") render();
});
window.tz.on("log", (line) => {
  if (!S.state) return;
  S.state.logs.push(line);
  if (S.state.logs.length > 400) S.state.logs.shift();
  if (S.tab === "logs") render();
});
window.tz.on("run-state", async ({ running }) => {
  if (!S.state) return;
  S.state.running = running;
  if (!running) await reload();
  else render();
});

reload().catch((error) => {
  $("#main").innerHTML = `<div class="notice err">启动失败：${esc(error.message)}</div>`;
});
