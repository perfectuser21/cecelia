# Sprint PRD — 军师台GP四级下钻真落地

**TASK_ID**: 7835c87b-ca2e-4c2f-9c54-28d910d14211
**Sprint Dir**: sprints/08051141-relay-7835c87b
**Generated**: 2026-08-05
**Phase**: dev
**Target Environment**: mac_web (Playwright, localhost:5174)

---

## 背景与范围

### 当前状态（现状差距）

`/strategist/:lineId` 全貌页（`StrategistLinePage.tsx` → `OverviewTab`）：
- 步骤行点击已支持展开右侧 `StepLedgerPanel`（账本+版本切换）
- "版本"子面板（`panelView === 'versions'`）仅列出 GP 记录，格子快照占位注释为「格子快照待照相层接入」——**无真实版本对比表**
- GP 列表与 11 要素无交叉：无版本×要素矩阵、无紫底 diff、无行详情面板
- 不同线（有/无账本）布局已统一（空态提示 + 铺账本入口）

### 目标（本批次 1/2）

按 artifact **f881eef2**（Line04·Golden Path 四级下钻页面原型）版式补齐：

| 层级 | 名称 | 当前状态 | 本批次目标 |
|------|------|---------|-----------|
| L1 | Line 全貌页（Step×要素矩阵） | 已存在，步骤可点击 | 保持，补 DOM 可见变化断言 |
| L2 | GP 详情——版本对比表 | ❌ 不存在 | **新建**：列=版本 ≥v1+当前，行=11要素 |
| L3 | 格子/行详情面板 | 部分（账本格子展开） | **新建**：点要素格→详情卡（条目+日期），可收起 |
| L4 | 步骤 subItems 展开 | ❌ | 本批次仅步骤行点击有 DOM 变化即可 |

**不包含**：军师对话页修复、拍板卡形态、要素页接线（批次 2/2）、新数据表（用 golden_paths 现有字段推导版本轴）

---

## 功能需求（FR）

### FR-01：步骤行点击有可见 DOM 变化

- 路由：`/strategist/<journey_id>`，全貌页
- 点击步骤行 → 右侧面板出现（`StepLedgerPanel`）
- **当前已实现**，但 E2E 需要明确断言 DOM 前后变化（不只断言渲染）
- 实现位置：`OverviewTab` 中 `setSelectedStep`，已有 `{selectedStep && <StepLedgerPanel>}`

### FR-02：GP 版本对比表（L2）

**位置**：`StepLedgerPanel` 内"版本"子面板（`panelView === 'versions'`）替换现有占位

**布局**（对标 f881eef2）：
- 列 = 版本节点（v1, v2, … 当前），版本轴来源：`golden_paths` 表中 `journey_id` 匹配的记录，按 `approved_at` / `created_at` 排序，每条 GP = 一个版本节点
- 行 = 11 要素（FR、NFR、判定点、不变量、失败语义、效果确认、两轴衔接 + 当前步骤已有 element cell_key）
- 表头行：第一列空，后续列标签 = GP 版本号 + 标题截断（≤ 12 字）
- 数据格：从 `journey_step_links`（格子账本）按 step_id + cell_key 匹配填充状态点
- **紫底 diff**：相对上一版本，格子状态有变化时，格子 class 加 `changed`（`bg-violet-900/30 border border-violet-500/20`）
- 若某步骤只有 1 个 GP 版本，changed 格为空（无对比基准）

**API 调用**：
```
GET /api/brain/golden-paths?journey_id=<step.journey_id>&limit=30
GET /api/brain/journey_step_links?journey_id=<step.journey_id>&cells=1&limit=500
```
（两个接口已存在，直接复用）

**快照推导策略**（无照相层）：
- 无历史快照表，用「GP 创建时间」将 journey_step_links 的 `created_at` 与 GP 版本的 `created_at` 做时间切片归位
- 每格取「在该版本创建时间以前最新一条同 step_id + cell_key 的记录」作为该版本快照值
- 若格子在当前版本才出现（该 GP 创建后才有记录），标为 new

### FR-03：行详情面板（L3）

- 点击版本对比表中任一要素格 → 同行（该 step_id + cell_key）的所有 journey_step_links 记录按时间列表出现
- 每条目显示：cell_status 点、cell_key、assertion_ref（或 —）、created_at 日期
- 再次点击相同格，或点 X → 收起

### FR-04：空态一致性

- 有账本的线：展示矩阵 + 步骤行
- **无账本的线**：显示「本线暂无步骤账本，账本模板铺入后自动出现」提示 + 入口按钮（现已有，确保仍存在）
- 两种线进入全貌页，布局结构（分左右两栏 + 矩阵表头）保持一致，不允许切换到另一套布局

---

## 非功能需求（NFR）

| ID | 约束 |
|----|------|
| NFR-01 | 版本对比表横向滚动，不破坏左侧矩阵固定宽 |
| NFR-02 | GP 数量 ≤ 20 时表格不出现横向截断（overflow-x-auto） |
| NFR-03 | 无账本时不发版本对比请求（避免无效 API 调用） |
| NFR-04 | 版本面板加载 spinner 与账本面板保持同一 loading 风格 |
| NFR-05 | 单文件不超过 500 行，如 `StrategistLinePage.tsx` 增量导致超限则按 component 拆分 |

---

## 判定点（技术断言）

| ID | 断言 | 验证方式 |
|----|------|---------|
| J-01 | 步骤行点击前后 DOM 结构不同 | Playwright: 点击前记录 innerHTML，点击后 `waitForSelector('[data-testid="step-ledger-panel"]')` |
| J-02 | 版本对比表表头含 FR / NFR / 判定点列标签 | Playwright: `getByRole('columnheader')` 包含这三个字符串 |
| J-03 | 版本对比表表头含版本列标签（含 "v1" 或 "v2"） | Playwright: 断言 table header 列数 ≥ 2，且至少一列含 "v" 前缀 |
| J-04 | 存在至少一个带 `changed` class 的格子（对有两版本的 GP） | Playwright: `locator('.changed')` count > 0（fixture 数据需有 2 个 GP 版本） |
| J-05 | 点击要素格后出现行详情卡片（带日期文字） | Playwright: `waitForSelector('[data-testid="cell-row-detail"]')` 且内部含日期格式 |
| J-06 | 再次点击同格 → 详情卡消失 | Playwright: 点击 X 按钮或再次点击格 → `data-testid="cell-row-detail"` 不可见 |
| J-07 | 无账本线进入全貌页显示空态提示 | Playwright: navigate 到无账本线 → `text=账本模板铺入后自动出现` 可见 |
| J-08 | 截图存档 L1/L2/L3 各一张 | Playwright: 三步骤各 `page.screenshot({ path: 'screenshots/L1.png' })` |

---

## 不变量（Invariants）

1. `golden_paths` 不新建表、不新增字段——版本轴全部从现有 `approved_at`/`created_at` 推导
2. `journey_step_links` 不新建表、不新增字段——快照时间切片在前端计算
3. 无照相层情况下版本快照为近似值（用时间排序推导），PRD 接受此近似，不要求精确到秒级
4. 版本对比表不替换现有账本面板——两个子视图（账本/版本）通过 tab 切换共存
5. 全貌页左侧矩阵（L1）不修改现有交互逻辑，步骤行点击展开右侧面板的实现不变
6. 批次 2/2 功能（要素页接线、拍板卡）不在本 Sprint 交付

---

## 累积 FR（本批次）

| 编号 | 简述 |
|------|------|
| FR-01 | 步骤行点击有可见 DOM 变化（E2E 断言） |
| FR-02 | GP 版本对比表（列=版本，行=11要素，紫底 diff） |
| FR-03 | 点格子→行详情卡（条目+日期），可收起 |
| FR-04 | 无账本线空态一致性（提示+入口，不换布局） |

**FR 总计：4 条**

---

## 实现路径

### 改动文件

1. `/workspace/apps/dashboard/src/pages/strategist/StrategistLinePage.tsx`
   - `StepLedgerPanel` 内 `panelView === 'versions'` 分支：替换 GP 列表为版本对比表组件
   - 新增 `GPVersionTable` 子组件（若超 500 行则拆到 `GPVersionTable.tsx`）
   - `OverviewTab` 步骤行加 `data-testid="step-row"` 属性

2. 新增文件（若超行限）：`/workspace/apps/dashboard/src/pages/strategist/GPVersionTable.tsx`

3. E2E 测试：`/workspace/packages/quality/e2e/strategist-gp-drill.e2e.spec.ts`
   - 使用 fixture journey_id `8bb8252f-29b4-4c34-acb9-1accda7ddfcf`（已有 TEST-FIXTURE GP v1/v2）

### 版本快照算法（前端）

```typescript
// 给定 gps（按版本排序）和 cells（所有格子）
// 为每个 GP 版本构建快照 Map<step_id+cell_key, StepCell>
function buildVersionSnapshot(gp: GoldenPath, cells: StepCell[]): Map<string, StepCell> {
  const cutoff = new Date(gp.created_at).getTime();
  const snapshot = new Map<string, StepCell>();
  // 取创建时间 <= cutoff 的最新记录
  const eligible = cells.filter(c => new Date(c.created_at ?? 0).getTime() <= cutoff + 86400000); // +1天宽容
  for (const cell of eligible) {
    const key = `${cell.step_id}::${cell.cell_key}`;
    const existing = snapshot.get(key);
    if (!existing || new Date(cell.created_at ?? 0) > new Date(existing.created_at ?? 0)) {
      snapshot.set(key, cell);
    }
  }
  return snapshot;
}
```

---

## E2E 测试骨架

文件：`packages/quality/e2e/strategist-gp-drill.e2e.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

const FIXTURE_JOURNEY_ID = '8bb8252f-29b4-4c34-acb9-1accda7ddfcf';
const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:5174';

test.describe('军师台 GP 四级下钻', () => {
  test('J-01 步骤行点击有 DOM 变化', async ({ page }) => { /* ... */ });
  test('J-02/03 版本对比表结构正确', async ({ page }) => { /* ... */ });
  test('J-04 存在 changed 紫底格子', async ({ page }) => { /* ... */ });
  test('J-05/06 点格子→详情卡出现→收起', async ({ page }) => { /* ... */ });
  test('J-07 无账本线空态提示', async ({ page }) => { /* ... */ });
  test('J-08 L1/L2/L3 截图存档', async ({ page }) => { /* ... */ });
});
```

---

## 验收清单（Final E2E）

- [ ] `/strategist/<F1 id>` 全貌页点击任一步骤行 → 展开/进入该步骤详情（DOM 断言有可见变化）
- [ ] GP 详情存在版本对比表：列=版本(≥v1+当前)，行=11要素，断言表头含 FR/NFR/判定点 且含版本列标签
- [ ] 相对上版变化的格子带紫底 class（至少一个有两版本的 GP 断言存在 `changed` 样式格）
- [ ] 点击任一要素格 → 行详情面板出现（条目带日期），再点收起
- [ ] 不同线进入全貌页显示同一结构（无账本线显示空态提示+铺账本入口，不是另一种布局）
- [ ] 截图存档：L1/L2/L3 三层各一张进 PR

---

## 版式标杆参照

- **Artifact**: f881eef2（Line04·Golden Path 四级下钻页面原型）——壳结构
- **数据芯**: `journey_step_links` 格子账本，API：`/api/brain/journey_step_links`
- **决策 df1ccf5a**（2026-08-04 Alex 拍板）：版本轴=golden_paths批准记录，紫diff=格子级快照，快照粒度=格子级
- **决策 af0d0818**（2026-08-04 Alex 拍板）：GP资产层=四级下钻版式标杆（artifact f881eef2），壳灌格子账本芯

---

*生成者：Planner Agent（Claude Sonnet 4.6），2026-08-05*

---

journey_type: user_facing
target_environment: mac_web
