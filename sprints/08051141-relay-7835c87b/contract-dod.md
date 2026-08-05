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

## 测试文件路径

- E2E 测试：`sprints/08051141-relay-7835c87b/tests/e2e-gp-drill.spec.ts`
- 截图目录：`sprints/08051141-relay-7835c87b/screenshots/`
