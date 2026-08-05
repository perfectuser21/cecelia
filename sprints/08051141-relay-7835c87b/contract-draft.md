# Contract Draft — 军师台GP四级下钻真落地

**Sprint**: 08051141-relay-7835c87b
**Task ID**: 7835c87b-ca2e-4c2f-9c54-28d910d14211
**生成时间**: 2026-08-05
**Proposer**: harness-contract-proposer（首轮）

---

## 一、场景地图

| 层级 | 触发 | 产物 | 验收方式 |
|------|------|------|----------|
| L1 | 打开 `/strategist/<lineId>`，全貌 Tab | 步骤×要素矩阵渲染 | `step-row-clickable` testid 可见 |
| L1→L2 | 点击步骤行 | 右侧 `StepLedgerPanel` 弹出 | `step-ledger-panel` testid visible |
| L2 版本子页签 | 切换到"版本"Tab | GP 版本对比表 (`gp-version-table`) 渲染 | 表头含版本列标签 + FR/NFR/判定点 行标签 |
| L3 | 点击版本对比格子 | `cell-detail-panel` 展开 | 面板 visible，含带日期条目 |
| L4 | 再次点击同一格子 | `cell-detail-panel` 收起 | 面板 hidden/detached |
| 空态降级 | 无批准 GP 时切"版本"Tab | 空态提示 | "本线暂无批准版本记录"文本 visible |
| 跨线一致 | 无账本 journey | 统一空态（LayoutGrid + 文字）| "账本模板铺入后自动出现"文本 visible |

---

## 二、技术断言（可机器验证）

### FR-1：L1 步骤行可点
- **断言**：`OverviewTab` 中步骤行 `<tr>` 带 `data-testid="step-row-clickable"` 属性
- **触发**：mount 完成、steps.length > 0
- **验证方式**：`page.locator('[data-testid="step-row-clickable"]').first().isVisible()`

### FR-2：L1→L2 面板弹出
- **断言**：点击步骤行后，`data-testid="step-ledger-panel"` 的 DOM 节点由 detached → visible
- **验证方式**：`page.locator('[data-testid="step-ledger-panel"]').isVisible()`

### FR-3：GP 版本对比表结构
- **断言**：
  1. 切版本 Tab 后，`data-testid="gp-version-table"` 存在于 DOM
  2. 表头含至少一个版本列（文本匹配 `/v\d+/` 或"当前"）
  3. 行标签中包含"FR"、"NFR"、"判定点"等 STANDARD_ELEMENT_KEYS 子集
- **降级条件**：无 approved GP 时，表不渲染，改为 `data-testid="gp-version-empty"` + 文本"本线暂无批准版本记录"

### FR-4：紫 diff 格子（有 ≥2 approved GP）
- **断言**：`data-testid="gp-version-cell-changed"` 至少存在 1 个
- **样式断言**：该元素 classList 包含 `bg-violet` 前缀 class 或 `changed` class
- **前提**：测试 fixture 需预置 ≥2 条 approved GP（通过直接 POST `/api/brain/golden-paths` 或 DB insert）

### FR-5：L3 行详情面板
- **断言**：
  1. 点击版本对比格子后 `data-testid="cell-detail-panel"` 变为 visible
  2. 面板内至少一条条目含日期字符串（`/\d{2}-\d{2}/` 格式）
- **验证方式**：`page.locator('[data-testid="cell-detail-panel"]').isVisible()`

### FR-6：L4 收起
- **断言**：再次点击同一格子后，`data-testid="cell-detail-panel"` 变为 hidden 或 detached
- **验证方式**：`expect(panel).not.toBeVisible()` 或 `toBeHidden()`

### FR-7（NFR）：无批准 GP 空态
- **断言**：`data-testid="gp-version-empty"` 存在，文本含"本线暂无批准版本记录"
- **触发条件**：journey 仅有 candidate GP

### FR-8：跨线布局一致性
- **断言**：无步骤账本时，全貌 Tab 仍渲染矩阵区域（不切换为另一种 DOM 结构）
- **断言**："账本模板铺入后自动出现"文字可见
- **断言**：`LayoutGrid` 图标区域存在

---

## 三、data-testid 锚点清单

| testid | 位置 | 说明 |
|--------|------|------|
| `step-row-clickable` | `OverviewTab` 步骤 `<tr>` | L1 步骤行 |
| `step-ledger-panel` | `StepLedgerPanel` 根元素 | L2 右侧详情面板 |
| `gp-version-table` | 版本对比表根 `<div>/<table>` | L2 版本子页签对比表 |
| `gp-version-cell-changed` | 紫 diff 格子 | 两版本间有变化的格子 |
| `gp-version-empty` | 无批准 GP 时的空态 | 降级提示 |
| `cell-detail-panel` | L3 行详情面板 | 点击格子后展开 |

---

## 四、实现范围（同 PRD）

**在范围**：
- `StepLedgerPanel` 版本子页签 GP 版本对比表
- 格子级快照 diff（两版本间 cell_status/assertion_ref 变化标紫底）
- 行详情 L3/L4 面板（点击展开/再点收起）
- 无批准 GP 空态降级
- 跨线全貌页布局一致性（无账本空态统一结构）

**不在范围**：
- 对话 Tab / 拍板 Tab / 要素 Tab
- 新建数据库表
- GP 写操作（批准/驳回/推进）

---

## 五、假设 & 约束

1. 版本轴 = `golden_paths` 表中 `status='approved'` 或 `status='delivered'`，按 `approved_at` 升序排列
2. 格子 diff = 同一 `(step_id, cell_key)` 在相邻 GP 版本间 `cell_status` 或 `assertion_ref` 变化
3. 锚点 journey `8bb8252f` 当前无 approved GP → E2E Scenario 3（紫 diff）需在 fixture 中注入 approved GP
4. 截图保存至 `sprints/08051141-relay-7835c87b/screenshots/` (L1.png / L2-version-table.png / L3-detail.png)
5. 全部改动限于 `apps/dashboard/src/pages/strategist/StrategistLinePage.tsx`
6. data-testid 属性名固定（见上表），Generator 不得擅自改名

---

## 六、不变量（Invariant，Generator 不得违反）

- testid 名称不得与上表不同
- lineId / journeyId / gpId 不得硬编码，fixture ID 须动态注入或预约定
- 修 bug 的 failing test 必须 commit 进 repo 永久保留
- 紫底 class 命名：`bg-violet-500/15` 或带 `changed` 标记（两者选一，不得混用）
- 对比表显示空态时（无 approved GP）不抛异常，console 无 error
