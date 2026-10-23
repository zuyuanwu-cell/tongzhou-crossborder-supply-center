# 生产发布防回退基线

## 事故根因

生产机曾同时承担运行、临时修改和前端构建。后端改动发布时执行了全量 `npm run build`，把生产机上落后的 `src/` 重新编译为 `dist/`，导致经营工作台和产品库被旧页面覆盖。旧脚本还排除了 `dist/` 备份，并且只检查 API 健康；页面能打开并不代表关键功能仍存在。

## 强制发布规则

1. 生产发布分为 `backend`、`frontend` 和 `full`。后端发布绝不构建或替换 `dist/`。
2. 生产工作区存在已修改的受控文件或未纳管源码时，发布直接失败。临时修复必须先回写 Git。
3. 前端只能从明确的 Git 提交构建到临时目录，不能直接写入线上 `dist/`。
4. 候选包必须执行：
   - 资源完整性检查；
   - 与当前线上 `dist/` 的体积及关键标记保留率比较；
   - `config/production-ui-contract.json` 中的关键功能契约检查；
   - 登录后的 UI 冒烟检查。
5. 前端切换采用目录级切换。切换后外网、边缘健康或 UI 冒烟任一失败，立即恢复完整旧 `dist/`。
6. 每次前端发布保留完整旧 `dist/`、候选包校验清单、目标 Git 提交和发布时间。

## 当前保护对象

- 经营工作台：俄罗斯、印尼、马来西亚、越南的时间/工作状态信息。
- 经营工作台：RUB、IDR、MYR、VND 汇率展示。
- 新版产品库：产品中心、卡片/列表布局、直营及分销成本口径。

如果业务确认要删除或重做上述功能，必须先评审并更新 UI 契约，不能为了让构建通过而临时放宽检查。

## 发布命令约定

后端发布：

```bash
DEPLOY_COMPONENT=backend DEPLOY_TARGET_COMMIT=<commit> bash scripts/deploy-baota.sh
```

前端或全量发布必须额外配置登录后的冒烟命令：

```bash
DEPLOY_COMPONENT=frontend \
DEPLOY_TARGET_COMMIT=<commit> \
DEPLOY_UI_SMOKE_COMMAND='<authenticated-ui-smoke-command>' \
bash scripts/deploy-baota.sh
```

冒烟脚本必须验证经营工作台和产品库的真实 DOM/截图，不能用 `true`、只访问首页或只请求 `/api/health` 代替。

## 发布前人工确认

- 候选版本必须先在独立预览地址打开。
- 对经营工作台与产品库各保留一张验收截图。
- 确认 Git 提交、候选包清单和截图一致后才允许切换生产。
- 不再允许通过覆盖单个 `index.html` 或在生产机直接运行 Vite 构建来发布前端。
