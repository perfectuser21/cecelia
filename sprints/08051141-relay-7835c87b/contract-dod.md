# Contract DoD — 军师台GP四级下钻真落地

**Sprint**: 08051141-relay-7835c87b
**Task ID**: 7835c87b-ca2e-4c2f-9c54-28d910d14211
**生成时间**: 2026-08-05

---

## Definition of Done（完成标准）

### 代码层

- [ ] `StrategistLinePage.tsx` 步骤行 `<tr>` 带 `data-testid="step-row-clickable"`
- [ ] `StepLedgerPanel` 根元素带 `data-testid="step-ledger-panel"`
- [ ] 版本子页签下：GP 对比表根元素带 `data-testid="gp-version-table"`
- [ ] 无 approved GP 时：空态节点带 `data-testid="gp-version-empty"`，文本含"本线暂无批准版本记录"
- [ ] 有变化格子带 `data-testid="gp-version-cell-changed"` 且含紫底 class（`bg-violet-500/15` 或 `changed`）
- [ ] 行详情面板带 `data-testid="cell-detail-panel"`，点击格子展开，再次点击收起
- [ ] `StepLedgerPanel` 已有账本视图（`panelView === 'ledger'`）行为不变
- [ ] L1 矩阵 `OverviewTab` 行为不变（无账本空态文字"账本模板铺入后自动出现"保留）
- [ ] 无新数据库表引入
- [ ] 无新 API 端点（复用 `/api/brain/golden-paths?journey_id=...`）

### 测试层

- [ ] `sprints/08051141-relay-7835c87b/tests/e2e-gp-drill.spec.ts` 存在
- [ ] Scenario 1（L1→L2 步骤行点击）：pass
- [ ] Scenario 2（L2 版本对比表结构）：pass（或降级为空态断言）
- [ ] Scenario 3（紫 diff）：pass（需 fixture 注入 ≥2 approved GP）
- [ ] Scenario 4（L3/L4 行详情面板展开/收起）：pass
- [ ] Scenario 5（跨线布局一致性）：pass
- [ ] 截图存档：`screenshots/L1.png`、`screenshots/L2-version-table.png`、`screenshots/L3-detail.png`

### CI 层

- [ ] PR 通过 `workspace-ci.yml`（无 TypeScript 错误、无 lint 报错）
- [ ] 无 `*New.tsx` / `*Old.tsx` / `*Backup.*` 临时文件
- [ ] 无未使用的 import / 遗留 console.log

### 版本对比逻辑正确性

- [ ] 版本列表 = `golden_paths` 中 status 为 `approved` 或 `delivered` 的记录，按 `approved_at` 升序
- [ ] 格子 diff 对比：同一 `(step_id, cell_key)` 在相邻版本快照间 `cell_status` 或 `assertion_ref` 变化时标紫
- [ ] 单版本 GP：无紫 diff，所有格子正常渲染，不报错
- [ ] 格子账本为空：版本对比表行显示"—"，不报错

---

## 验收签收格

| 验收项 | 状态 | 证据 |
|--------|------|------|
| FR-1 步骤行可点 | ⬜ | Playwright 截图 L1.png |
| FR-2 面板弹出 | ⬜ | `step-ledger-panel` visible 断言 |
| FR-3 版本对比表结构 | ⬜ | `gp-version-table` 存在 + 行列标签 |
| FR-4 紫 diff | ⬜ | `gp-version-cell-changed` 存在 + class 断言 |
| FR-5 L3 行详情 | ⬜ | `cell-detail-panel` visible + 日期条目 |
| FR-6 L4 收起 | ⬜ | `cell-detail-panel` hidden/detached |
| FR-7 空态降级 | ⬜ | `gp-version-empty` 文本 |
| FR-8 跨线一致 | ⬜ | 空态提示文本 + LayoutGrid |
| workspace-ci 绿 | ⬜ | CI URL |
| 截图存档 | ⬜ | PR 描述附链接 |

---

## Evaluator 判定规则

- 所有 ⬜ 变为 ✅ = **PASS**（可以 merge PR）
- 任何 ⬜ 未完成 = **FAIL**（Evaluator 打回，附具体缺失项）
- 允许"空态降级"替代"紫 diff"（当生产 journey 无 approved GP），但测试 fixture 必须验证紫 diff 路径

---

## 行为断言（[BEHAVIOR]）

[BEHAVIOR] FR-1: L1 步骤行可点击
  - given: 全貌页已加载，steps.length > 0，矩阵渲染完成
  - when: 用户在 OverviewTab 矩阵中点击任一步骤 `<tr>` 行（data-testid="step-row-clickable"）
  - then: data-testid="step-ledger-panel" 从 detached/hidden 变为 visible

[BEHAVIOR] FR-2: L1→L2 StepLedgerPanel 弹出
  - given: 步骤行已可见，用户点击了某步骤行
  - when: 点击事件触发 setSelectedStep
  - then: 右侧 StepLedgerPanel 出现，data-testid="step-ledger-panel" isVisible() 为 true

[BEHAVIOR] FR-3: GP 版本对比表结构正确渲染
  - given: StepLedgerPanel 已弹出，journey 有 ≥1 条 approved GP 记录
  - when: 用户点击"版本"子页签
  - then: data-testid="gp-version-table" 存在于 DOM，表头含版本列标签（匹配 /v\d+/ 或"当前"），行标签含 FR / NFR / 判定点等要素键

[BEHAVIOR] FR-4: 紫 diff 格子在有变化时显示
  - given: 版本对比表已渲染，fixture 已注入 ≥2 条 approved GP 且同一 (step_id, cell_key) 的 cell_status 或 assertion_ref 在两版本间有差异
  - when: 版本对比表完成渲染
  - then: 至少 1 个 data-testid="gp-version-cell-changed" 存在，且该元素 classList 含 bg-violet 前缀 class 或 changed class

[BEHAVIOR] FR-5: L3 行详情面板点击格子展开
  - given: 版本对比表已渲染，至少有一个可点击的格子
  - when: 用户点击版本对比表中任一格子
  - then: data-testid="cell-detail-panel" 变为 visible，面板内至少一条条目含日期字符串（匹配 /\d{2}-\d{2}/ 格式）

[BEHAVIOR] FR-6: L4 再次点击格子收起详情面板
  - given: data-testid="cell-detail-panel" 当前为 visible（已展开）
  - when: 用户再次点击同一格子
  - then: data-testid="cell-detail-panel" 变为 hidden 或 detached

[BEHAVIOR] FR-7: 无批准 GP 时显示空态降级
  - given: 当前 journey 仅有 candidate GP，无 approved/delivered 记录
  - when: 用户切换到"版本"子页签
  - then: data-testid="gp-version-empty" 存在，文本含"本线暂无批准版本记录"，gp-version-table 不渲染，console 无 error

[BEHAVIOR] FR-8: 跨线全貌页布局一致性
  - given: 打开一个无格子账本的 lineId（步骤数据存在但无 journey_step_links 记录）
  - when: 全貌 Tab 渲染完成
  - then: 矩阵区域仍存在（不切换为另一种 DOM 结构），文本"账本模板铺入后自动出现"可见，LayoutGrid 图标区域存在

---

## 可执行验收命令（manual:bash）

主验收命令（运行全部 E2E 场景）：
```
manual:bash npx playwright test sprints/08051141-relay-7835c87b/tests/e2e-gp-drill.spec.ts --headed
```

单场景调试（有头模式，仅跑紫 diff 场景）：
```
manual:bash npx playwright test sprints/08051141-relay-7835c87b/tests/e2e-gp-drill.spec.ts --headed --grep "紫 diff"
```

查看截图存档：
```
manual:bash ls -la sprints/08051141-relay-7835c87b/screenshots/
```

---

## 测试文件路径

- E2E 测试：`sprints/08051141-relay-7835c87b/tests/e2e-gp-drill.spec.ts`
- 截图目录：`sprints/08051141-relay-7835c87b/screenshots/`
