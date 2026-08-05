# Contract Draft — 军师台GP四级下钻真落地

**TASK_ID**: 7835c87b-ca2e-4c2f-9c54-28d910d14211
**Sprint Dir**: sprints/08051141-relay-7835c87b
**Generated**: 2026-08-05
**Round**: 1（首轮）

---

## 范围边界

### 在边界内（本合同覆盖）

| 编号 | 功能 | 实现位置 |
|------|------|---------|
| FR-01 | 步骤行点击有可见 DOM 变化 | `OverviewTab` 步骤行 + `data-testid="step-row"` |
| FR-02 | GP 版本对比表（列=版本，行=11要素，紫底 diff） | `StepLedgerPanel` panelView=versions 分支，新增 `GPVersionTable` 组件 |
| FR-03 | 点击版本对比表格子 → 行详情卡（条目+日期），可收起 | `GPVersionTable` 内联或 `CellDetailCard` 子组件 |
| FR-04 | 无账本线空态一致性（提示+铺账本入口，不换布局） | `OverviewTab` 空态分支 |

### 在边界外（本合同不覆盖）

- 军师对话页修复
- 拍板卡形态变更
- 要素页接线（批次 2/2）
- 新数据表或新字段（golden_paths / journey_step_links 不变）
- 照相层（精确到秒级快照）
- L4 步骤 subItems 展开（仅需步骤行点击有 DOM 变化）

---

## 数据契约

### 复用 API（不新增接口）

| 接口 | 已存在 | 用途 |
|------|--------|------|
| `GET /api/brain/golden-paths?journey_id=<id>&limit=30` | ✓ | 版本列轴 |
| `GET /api/brain/journey_step_links?journey_id=<id>&cells=1&limit=500` | ✓ | 格子数据（版本快照时间切片） |
| `GET /api/brain/journey_steps?journey_id=<id>&limit=50` | ✓ | 步骤列表（已有） |

### 版本快照算法（前端时间切片）

```
对每个 GP 版本（按 approved_at/created_at 升序）：
  cutoff = gp.created_at + 1天宽容
  snapshot[step_id::cell_key] = 在 created_at ≤ cutoff 的 cells 中，最新一条记录
```

不变量：此算法为近似值，精度到日，PRD 接受此近似（决策 df1ccf5a）。

---

## 技术断言（判定点翻译）

| J-ID | PRD 用户语言 | 技术断言 | 验证方式 |
|------|------------|---------|---------|
| J-01 | 步骤行点击前后不同 | 点击前无 `[data-testid="step-ledger-panel"]`；点击后该元素可见 | `waitForSelector('[data-testid="step-ledger-panel"]')` |
| J-02 | 版本对比表有 FR/NFR/判定点列标签 | `table thead th` 中存在文字包含"FR"、"NFR"、"判定点"的单元格 | `getByRole('columnheader')` 断言 |
| J-03 | 版本对比表有版本列标签（含 v 前缀） | `table thead th` 中至少一列文字匹配 `/^v\d/` | `.toMatch(/^v\d/)` |
| J-04 | 相对上版变化格子带紫底（≥1个） | 页面中 `.changed` 元素数量 > 0（fixture 需 ≥2 GP版本） | `locator('.changed').count()` |
| J-05 | 点格子后出现行详情卡含日期 | `[data-testid="cell-row-detail"]` 可见，且内部文字包含日期格式（`\d{2}-\d{2}` 或 `\d{4}-\d{2}`） | `waitForSelector + textContent` |
| J-06 | 再次点击格子或点 X → 详情卡消失 | 执行关闭操作后，`[data-testid="cell-row-detail"]` 不可见 | `.not.toBeVisible()` |
| J-07 | 无账本线全貌页显示空态提示 | 进入无账本线后，`text=账本模板铺入后自动出现` 可见 | `getByText('账本模板铺入后自动出现').toBeVisible()` |
| J-08 | L1/L2/L3 各截图存档 | 三处截图写入 `screenshots/L1.png`、`screenshots/L2.png`、`screenshots/L3.png` | `page.screenshot({ path: 'screenshots/L1.png' })` |

---

## Fixture 数据

- **Fixture Journey ID**: `8bb8252f-29b4-4c34-acb9-1accda7ddfcf`（已有 TEST-FIXTURE GP v1/v2）
- J-04 的 `.changed` 断言依赖该 fixture 存在 ≥2 个 GP 版本
- J-07 需要一条无 journey_step_links 的 journey，从现有 lines 列表中取第一条无账本线

---

## 不变量（代码约束）

1. `golden_paths` 表不新建、不新增字段
2. `journey_step_links` 表不新建、不新增字段
3. 版本对比表不替换账本面板——两子视图通过 `panelView` tab 切换共存
4. `OverviewTab` 左侧 L1 矩阵交互逻辑不变
5. `StrategistLinePage.tsx` 若超 500 行则将 `GPVersionTable` 拆至独立文件

---

## 风险标注

| 风险 | 可能性 | 处理方式 |
|------|--------|---------|
| fixture journey 无 2 个 GP，J-04 无法触发 `.changed` | 中 | 测试中 skip J-04 并加注释；开发时确认 fixture 数据 |
| `journey_step_links` 无 `created_at` 字段导致时间切片失效 | 低 | 代码加 null 守卫，格子降级为 gray |
| `StrategistLinePage.tsx` 已 1105 行，新增组件必须拆分 | 高（必发生） | GPVersionTable 拆至独立文件 |
