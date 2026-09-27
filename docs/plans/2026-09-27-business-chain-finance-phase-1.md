# 业务链路与合同财务台账（第一阶段）实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**目标：** 在不改变简道云现有单据和审批流程的前提下，为“开品需求 → 报价 → 销售合同 → 工艺/BOM → 委外加工/采购 → 入库 → 发货 → 结算”建立只读链路索引，并提供合同履约、入库发货和供应商应付视图。

**架构：** 简道云继续作为单据主数据源；中台后台按表单错峰拉取并写入独立 SQLite 索引库，页面只读取本地索引。每条外部记录以 `source_form_id + source_data_id` 唯一识别，合同链路以合同数据 ID 生成稳定 `chain_id`，无法归入合同的数据先保留为待关联单据。第一阶段不向简道云回写，不改变现有备货、生产和财务数据。

**技术栈：** Node.js 16、原生 HTTP API、sql.js、React 19、TypeScript、Vite、现有权限与菜单体系。

---

## Task 1：补齐简道云字段映射与标准化规则

**Files:**
- Modify: `server/field-mapping.js`
- Create: `server/business-chain-config.js`
- Create: `scripts/business-chain-normalization-test.mjs`

1. 只读查询开品需求、报价、销售合同、工艺、委外、采购、入库、发货、预付款、结算表单的真实字段 ID。
2. 将表单 ID、单号、状态、上下游关联字段、金额、数量、供应商/客户、子表字段集中配置。
3. 实现对文本、数字、成员、关联数据、子表、日期字段的容错读取。
4. 用构造数据验证字段缺失、关联值对象/数组、前导零、金额和数量解析。

## Task 2：建立独立业务链路索引库

**Files:**
- Create: `server/business-chain-db.js`
- Create: `scripts/business-chain-db-test.mjs`

1. 创建 `documents`、`document_lines`、`relations`、`sync_state` 表和必要索引。
2. 使用 `source_form_id + source_data_id` 唯一约束，重复同步只更新不重复插入。
3. 保存规范化检索字段与原始 JSON；不复制附件文件，不修改任何简道云记录。
4. 支持按合同、单号、客户、供应商、SKU、状态和更新时间分页查询。

## Task 3：实现错峰同步与链路构建

**Files:**
- Create: `server/business-chain-sync.js`
- Modify: `server/server.js`
- Create: `scripts/business-chain-sync-test.mjs`

1. 每次只同步一个表单，合同及核心履约表高频、历史和结算表低频，避免并发压垮简道云。
2. 首次同步允许分页回填；后续优先按更新时间窗口增量获取，并周期性做低频全量校正。
3. 通过关联数据 ID、合同编号、合同明细 UUID、报价单号等建立确定性关系。
4. 不用 SKU 或产品名称作为唯一关联依据；无法可靠关联时标记“待关联”。
5. 同步失败保留最近一次成功索引，页面显示新鲜度和错误，不返回空白假象。

## Task 4：实现链路、履约与财务 API

**Files:**
- Create: `server/business-chain-service.js`
- Create: `server/business-chain-api.js`
- Modify: `server/server.js`
- Create: `scripts/business-chain-api-test.mjs`

1. 提供概览、合同分页、合同详情链路、供应商应付、同步状态接口。
2. 合同详情聚合报价、工艺、委外、采购、入库、发货、付款/结算节点及数量金额。
3. 财务口径区分：已承诺、已入库应付、已核销付款、待核销差额；数据不足时明确标记而不猜测。
4. “同舟跨境供应链”合同在第一阶段按规范化客户名推断为内部备货，并带 `inferred` 标识。
5. 手动同步接口只创建后台任务并立即返回，页面不等待跨表同步完成。

## Task 5：接入权限、菜单与前端页面

**Files:**
- Modify: `server/access-control.js`
- Modify: `src/main.tsx`
- Create: `src/business-chain/BusinessChainCenter.tsx`
- Create: `src/business-chain/business-chain.css`

1. 新增 `business_chain_view`、`contract_finance_view`、`business_chain_sync` 权限。
2. 新增“业务链路”菜单与 `#business-chain` 页面；财务页签按独立权限显示。
3. 页面提供履约概览、合同清单、阶段进度、数量/金额差异、数据新鲜度和待关联提示。
4. 点击合同打开抽屉，显示从需求到结算的时间线和原始单据编号。
5. 沿用现有深蓝/橙色控制塔视觉体系，并为窄屏提供可用布局。

## Task 6：补齐 Agent、OpenAPI 与验收

**Files:**
- Modify: `server/agent-index.js`
- Modify: `src/main.tsx`
- Modify: `package.json`
- Create: `scripts/business-chain-permissions-test.mjs`

1. 把业务链路页面、实体与接口加入 Agent 索引和 OpenAPI 输出。
2. 验证管理员、运营、财务权限隔离；无财务权限用户不能看到金额和应付接口。
3. 验证断网、简道云超时、空索引和部分表单失败时仍展示最近一次成功数据。
4. 在 Node.js 16 下运行构建、数据库、同步、API、权限与现有关键回归测试。
5. 本地浏览器完成桌面端和窄屏验收；本阶段不发布线上，待用户确认后再部署。

## 验收口径

- 打开页面不触发简道云实时跨表查询，首屏读取本地索引。
- 任一简道云单据不会因本阶段功能被新增、修改或删除。
- 合同可查看关联的报价、工艺、委外、采购、入库、发货和财务节点；关联不确定时明确提示。
- 财务可区分内部备货合同与外部销售合同，并看到生产中、累计入库、累计发货、已入库应付及待核销金额。
- 单表同步失败不清空旧数据，页面显示具体失败表单与最后成功时间。
- 所有新增代码兼容 Node.js 16。
