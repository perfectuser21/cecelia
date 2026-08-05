# Contract DoD — 军师台GP四级下钻真落地

**TASK_ID**: 7835c87b-ca2e-4c2f-9c54-28d910d14211
**Sprint Dir**: sprints/08051141-relay-7835c87b
**Generated**: 2026-08-05

---

## Definition of Done（完成定义）

### 代码交付

- [ ] `apps/dashboard/src/pages/strategist/GPVersionTable.tsx` 新建（从 StrategistLinePage 拆出）
- [ ] `apps/dashboard/src/pages/strategist/StrategistLinePage.tsx`：
  - [ ] `panelView === 'versions'` 分支替换为 `<GPVersionTable>` 组件（删除原占位注释）
  - [ ] 步骤行 `<tr>` 加 `data-testid="step-row"` 属性
  - [ ] `StepLedgerPanel` 加 `data-testid="step-ledger-panel"` 属性
- [ ] `GPVersionTable` 实现以下功能：
  - [ ] 列 = 版本节点（每个 GP = 一列，按 approved_at/created_at 升序）
  - [ ] 行 = 11要素（FR / NFR / 判定点 / 不变量 / 失败语义 / 效果确认 / 两轴衔接 + 动态 element cell_key）
  - [ ] 表头：第一列空，后续列标签 = `v{n} + 标题截断≤12字`
  - [ ] 版本快照时间切片算法（前端计算，无照相层）
  - [ ] 相对上版有变化的格子加 `changed` class（`bg-violet-900/30 border border-violet-500/20`）
  - [ ] 只有 1 个 GP 版本时 `changed` 格为空（无对比基准）
  - [ ] 点击格子 → 出现 `[data-testid="cell-row-detail"]` 行详情卡
  - [ ] 行详情卡：按时间列出 step_id+cell_key 的全部 journey_step_links 记录，每条含 cell_status 点 / cell_key / assertion_ref / created_at 日期
  - [ ] 再次点击同格或点 X → 详情卡消失
  - [ ] 加载期间显示 spinner（同账本面板风格）
  - [ ] overflow-x-auto 横向滚动，不破坏左侧矩阵宽度
- [ ] 无账本线空态：`text=账本模板铺入后自动出现` 保留可见（FR-04 不回归）
- [ ] 无账本线时不发版本对比请求（NFR-03）
- [ ] 单文件不超过 500 行（NFR-05）

### 测试交付

- [ ] `packages/quality/e2e/strategist-gp-drill.e2e.spec.ts` 新建，包含 J-01 ~ J-08 全部判定点
- [ ] 所有测试可在 `packages/quality/e2e/` 下执行：`npx playwright test strategist-gp-drill.e2e.spec.ts`
- [ ] J-01 通过：点击步骤行后 `[data-testid="step-ledger-panel"]` 可见
- [ ] J-02 通过：版本对比表表头含 "FR" / "NFR" / "判定点"
- [ ] J-03 通过：表头至少一列匹配 `/^v\d/`
- [ ] J-04 通过（或标注 skip + 原因）：`.changed` 元素 count > 0
- [ ] J-05 通过：`[data-testid="cell-row-detail"]` 可见且含日期文字
- [ ] J-06 通过：关闭操作后 `[data-testid="cell-row-detail"]` 不可见
- [ ] J-07 通过：无账本线 `text=账本模板铺入后自动出现` 可见
- [ ] J-08 通过：`screenshots/L1.png`、`screenshots/L2.png`、`screenshots/L3.png` 文件存在

### 代码质量

- [ ] 无 console.log / 注释死代码 / 未用 import
- [ ] TypeScript 无类型错误（`tsc --noEmit`）
- [ ] `StrategistLinePage.tsx` 行数 ≤ 500（GPVersionTable 已拆出）

### CI / PR

- [ ] 提交到分支 `cp-08051214-ws-7835c87b`
- [ ] PR 创建完成，关联 TASK_ID `7835c87b-ca2e-4c2f-9c54-28d910d14211`
- [ ] workspace-ci.yml 通过（TypeScript 构建 + Playwright E2E）
- [ ] 截图三张进入 PR artifacts 或 `packages/quality/screenshots/`

---

## 判定点数量汇总

| 层级 | 判定点 | 数量 |
|------|--------|------|
| J-01 | 步骤行点击 DOM 变化 | 1 |
| J-02 | 版本对比表要素列标签 | 1 |
| J-03 | 版本对比表版本列标签 | 1 |
| J-04 | changed 紫底格子存在 | 1 |
| J-05 | 行详情卡出现+含日期 | 1 |
| J-06 | 行详情卡收起 | 1 |
| J-07 | 无账本线空态提示 | 1 |
| J-08 | L1/L2/L3 截图存档 | 1 |
| **合计** | | **8** |
