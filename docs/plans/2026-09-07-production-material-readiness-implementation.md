# Production Material Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在生产中心以只读方式展示基于采购订单与采购入库单计算的物料到齐进度，并从服务端开始脱敏供应商信息。

**Architecture:** 简道云客户端按活跃生产单号分批读取采购与入库数据；独立的纯函数模块完成物料分类、供应商主体比较和累计到货计算；服务端缓存安全的计算结果并合并进生产单接口；React 生产中心展示摘要、列表状态和可展开的物料时间线。

**Tech Stack:** Node.js, React, TypeScript, Jiandaoyun Open API, CSS

---

### Task 1: 建立隐私与物料计算失败用例

**Files:**
- Create: `server/supplier-privacy.js`
- Create: `server/production-materials.js`
- Create: `scripts/production-materials-test.mjs`
- Modify: `package.json`

1. 编写覆盖稳定匿名代号、同厂内料忽略、异厂内料必需、多次入库累计、取消采购单排除和无包材待核查的测试。
2. 运行测试，确认测试因缺少实现而失败。
3. 实现最小可用的脱敏与计算函数。
4. 再次运行测试并确认通过。

### Task 2: 增加简道云表单映射与分批查询

**Files:**
- Modify: `server/field-mapping.js`
- Modify: `server/jiandaoyun-client.js`

1. 增加委外加工明细、采购订单和采购入库单的字段映射。
2. 增加按生产单号、采购单号分批读取的只读方法，每批最多 20 个值。
3. 保留现有通用分页和重试行为。
4. 用真实配置做只读查询抽样，确认关联字段命中。

### Task 3: 合并缓存并清除原始敏感字段

**Files:**
- Modify: `server/normalize-outsourcing-orders.js`
- Modify: `server/server.js`
- Modify: `scripts/production-timeline-test.mjs`

1. 生产单标准化时改用供应商匿名代号，不再返回原始记录。
2. 增加独立物料进度缓存并在生产同步时刷新。
3. 物料读取失败时保留上一份缓存并给出警告。
4. 给同舟供应链与国内定制生产单附加物料进度。
5. 运行生产时间线和备货流程回归测试。

### Task 4: 接入生产中心列表与时间线

**Files:**
- Modify: `src/api.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `src/theme-refresh.css`

1. 补充安全的物料进度类型。
2. 增加“物料到齐”摘要指标及列表进度列。
3. 展开区域增加物料清单、累计到货进度和时间线节点。
4. 为四种状态提供清晰、可访问且与现有 UI 一致的视觉反馈。
5. 确认窄屏下不遮挡、文字对比度足够。

### Task 5: 本地综合验收

**Files:**
- Verify only

1. 运行物料计算测试、生产时间线测试、备货流程测试和生产构建。
2. 运行 `git diff --check`。
3. 刷新本地简道云数据，抽查状态分布且确认响应无供应商原名。
4. 打开本地生产中心，检查默认选项卡、物料状态、展开轨迹和国内定制选项卡。
5. 保持线上版本不变，等待用户验收。
