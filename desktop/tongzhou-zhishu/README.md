# 同舟智数（desktop/tongzhou-zhishu）

Windows 桌面采集端：通过紫鸟 CLI 打开店铺浏览器，在已登录的平台卖家中心页面内同源调用数据接口，把店铺日数据写入中台 `POST /api/shop-daily-report/ingest`。使用说明见 [使用说明.md](./使用说明.md)。

## 结构

| 路径 | 作用 |
| --- | --- |
| `main.js` / `preload.js` | Electron 主进程（窗口、托盘、定时、IPC、令牌 DPAPI 加密） |
| `ui/` | 界面（原生 JS，无构建步骤） |
| `core/ziniao.js` | 紫鸟 CLI 封装：定位/一键安装、JSON 输出解析、SOCKS 重试、页面脚本「启动 + 轮询」执行 |
| `core/page-scripts.js` | 页面内脚本：请求记录器（fetch/XHR）、接口探测、按模板重放 |
| `core/recipe.js` | 采集模板：请求 → 占位符模板（{startTs}{endTs}{date}{shopId}{cookie:x}）、JSON 路径取值、字段建议 |
| `core/collector.js` | 校准（探测/生成/试采）与正式采集编排、历史与重传 |
| `core/zhongtai.js` | 中台客户端（X-Ingest-Token，分批写入、试匹配、店铺名单） |
| `core/platforms/` | 平台适配器注册表；`shopee/` 为 Shopee 卖家中心 |
| `test/` | 模拟紫鸟 CLI + 模拟卖家中心 + 模拟中台的端到端测试；`integration-zhongtai.js` 对接真实中台服务 |

## 新增平台

在 `core/platforms/<id>/index.js` 导出 `id、name、SELLER_ORIGINS、DISCOVERY_PAGES、API_PATTERN、matchStore、originFor、checkPage、blankTemplate`，并在 `core/platforms/index.js` 登记。校准、采集、回写流程不用改。

## 开发与打包

```bash
cd desktop/tongzhou-zhishu
npm install            # 国内可先设置 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm test               # 单元 + 端到端（模拟）
npm run test:integration   # 启动仓库里的中台服务做真实写入（需先在仓库根目录 npm install）
npm start              # 本地运行
npm run package:win    # 生成 dist/同舟智数-<版本>-win-x64.zip（免安装版，Linux/Windows 均可打包）
```

中台侧依赖：`SHOP_METRICS_INGEST_TOKEN`（≥24 位）与 `GET /api/shop-daily-report/ingest/shops`（本次随中台后端一起提交）。
