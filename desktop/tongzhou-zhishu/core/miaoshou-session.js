"use strict";

// 妙手网页会话（Electron）。用独立的持久化分区保存妙手登录状态：
// - 用户点「登录妙手」时显示这个窗口，自己输入账号密码登录（同舟智数不接触、不保存妙手密码）；
// - 之后窗口隐藏在后台，开关规则时在这个页面里发请求，用的就是妙手网页自己的登录状态。

const { ORIGIN, RULE_PAGE, MiaoshouError } = require("./miaoshou");

const PARTITION = "persist:miaoshou";
const REVIEW_LIST = "/api/order/package/render_list/searchOrderPackageList";

class MiaoshouSession {
  constructor({ BrowserWindow, icon, log = () => {}, onClosed = () => {} }) {
    this.BrowserWindow = BrowserWindow;
    this.icon = icon;
    this.log = log;
    this.onClosed = onClosed;
    this.window = null;
    this.loading = null;
  }

  ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const win = new this.BrowserWindow({
      width: 1180,
      height: 780,
      show: false,
      title: "妙手 ERP · 同舟智数",
      icon: this.icon,
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.removeMenu();
    // 只允许停留在妙手自己的域名；新窗口一律在本窗口打开。
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/([a-z0-9-]+\.)*91miaoshou\.com\//i.test(url)) win.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*91miaoshou\.com\//i.test(url)) event.preventDefault();
    });
    // 关闭 = 隐藏：登录状态和后台请求都依赖这个窗口。
    win.on("close", (event) => {
      if (this.quitting) return;
      event.preventDefault();
      win.hide();
      this.onClosed();
    });
    this.window = win;
    return win;
  }

  async load(url = RULE_PAGE) {
    const win = this.ensureWindow();
    if (!this.loading) {
      this.loading = win.loadURL(url).catch((error) => {
        // 页面内跳转会让 loadURL 以 ERR_ABORTED 结束，不算失败。
        if (!/ERR_ABORTED/.test(String(error?.message))) throw error;
      }).finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
    return win;
  }

  /** 显示妙手窗口让用户登录。 */
  async showLogin() {
    const win = this.ensureWindow();
    win.show();
    win.focus();
    await this.load(RULE_PAGE).catch((error) => this.log("warn", `打开妙手失败：${error.message}`));
    return true;
  }

  hide() {
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  destroy() {
    this.quitting = true;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  /** 在妙手页面里发请求，返回 { status, url, text }。 */
  async request(method, pathname, form = null) {
    if (!/^\/api\/[a-z0-9_/]+$/i.test(pathname)) throw new MiaoshouError(`不允许的妙手接口：${pathname}`);
    const body = form ? new URLSearchParams(form).toString() : null;
    const script = `(async () => {
      const response = await fetch(${JSON.stringify(pathname)}, {
        method: ${JSON.stringify(method)},
        credentials: "include",
        headers: ${JSON.stringify(body === null ? { Accept: "application/json, text/plain, */*" } : { Accept: "application/json, text/plain, */*", "Content-Type": "application/x-www-form-urlencoded" })},
        body: ${JSON.stringify(body)} ?? undefined,
      });
      return { status: response.status, url: response.url, text: (await response.text()).slice(0, 400000) };
    })()`;
    return this.runInSession(script);
  }

  async requestReviewOrderPage(parameters) {
    const body = new URLSearchParams(parameters).toString();
    const script = `(async () => {
      if (!document.documentElement.dataset.version && (location.pathname === "/" || /login|passport|sign-in/i.test(location.pathname))) {
        return { loggedOut: true, error: "妙手登录已失效，请重新登录。" };
      }
      try {
        const response = await fetch(${JSON.stringify(REVIEW_LIST)}, {
          method: "POST", credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/x-www-form-urlencoded",
            "x-front-version": document.documentElement.dataset.version || "",
            "x-referer": location.origin + "/order/package/all",
          },
          body: ${JSON.stringify(body)}, signal: AbortSignal.timeout(25000),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.result !== "success") {
          const reason = String(result?.reason || result?.message || "");
          const loggedOut = response.status === 401 || /登录|登陆|login|授权已经过期|会话/i.test(reason);
          return { loggedOut, error: loggedOut ? "妙手登录已失效，请重新登录。" :
            "读取妙手订单列表失败（HTTP " + response.status + (reason ? "，" + reason.slice(0, 100) : "") + "）。" };
        }
        if (!Array.isArray(result.packageList)) return { error: "妙手订单列表返回格式异常。" };
        const orders = result.packageList.flatMap((row) => row.subPackageList?.length ? row.subPackageList : [row]).map((row) => ({
          orderNo: String(row.orderInfo?.platformOrderSn ?? row.platformOrderSn ?? ""),
          shopId: String(row.orderInfo?.shopId ?? row.shopId ?? ""),
          mark: String(row.orderInfo?.isMarketing ?? ""),
          orderStartedAt: String(row.orderInfo?.gmtOrderStart ?? ""),
        }));
        return { orders, total: result.total, packageCount: result.packageList.length };
      } catch (error) {
        return { error: "读取妙手订单列表失败：" + String(error?.name || "网络错误") + "。" };
      }
    })()`;
    const result = await this.runInSession(script);
    if (result?.error) throw new MiaoshouError(result.error, { loggedOut: result.loggedOut });
    return result;
  }

  async runInSession(script) {
    let win = this.ensureWindow();
    const onOrigin = () => String(win.webContents.getURL() || "").startsWith(`${ORIGIN}/`);
    if (!onOrigin()) win = await this.load(RULE_PAGE);
    if (!onOrigin()) throw new MiaoshouError("妙手登录已失效，请重新登录。", { loggedOut: true });
    let timer;
    try {
      return await Promise.race([
        win.webContents.executeJavaScript(script, true),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new MiaoshouError("妙手请求超时")), 30000);
        }),
      ]);
    } catch (error) {
      if (error instanceof MiaoshouError) throw error;
      throw new MiaoshouError(`妙手请求失败：${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { MiaoshouSession, PARTITION };
