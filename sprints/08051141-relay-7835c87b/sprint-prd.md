# Sprint PRD — 军师台GP四级下钻真落地（版本对比表+紫diff+行详情+步骤可点）

## OKR 对齐

- **对应 Objective**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **对应 KR**：KR5：Dashboard可交付 — 3大模块无阻断bug，可完整演示20分钟（current=31%）
- **本次推进预期**：+3%（军师台全貌页四级下钻完整可用，GP版本对比表灌真数据）
- **Initiative**：01ad9aff — 军师台GP四级下钻真落地（版本对比表+紫diff+行详情+步骤可点）

## 背景

当前军师台（`/strategist/:lineId`）全貌 Tab 已有步骤×要素矩阵（`StrategistLinePage.tsx`），但存在以下四处差距：

1. **步骤行点击无反应** — 矩阵行已有 `onClick → setSelectedStep`，但右侧 `StepLedgerPanel` 的"版本"子页签内容仅占位（"∅ 格子快照待照相层接入"），无任何可交互版本对比表。
2. **无版本对比表** — `StepLedgerPanel` 的 `versions` 视图只渲染 GP 列表，无 v列×11要素行的对比矩阵。决策 df1ccf5a 已拍板：版本轴 = golden_paths 批准记录，紫底 = 格子级快照 diff。
3. **无紫 diff 样式** — 格子级快照（两版本间 cell_status 或 assertion_ref 变化）需在版本对比表中以紫底 class 标识。当前代码无任何版本对比逻辑。
4. **线之间布局不一致** — 有账本的线展示矩阵，无账本的线应显示空态提示 + 铺账本入口，而非另一种布局（当前已有空态逻辑，需确认统一性）。

版式标杆：artifact f881eef2（Line04·Golden Path四级下钻页面原型）。数据源：`journey_step_links` 格子账本真数据（`/api/brain/journey_step_links?journey_id=...&cells=1`）。

已有数据基础（锚点 journey `8bb8252f`）：
- 4 个步骤（一眼全景/下钻证据/看到的等于真相/舱内拍板），47 条格子账本记录（含 element/capability/scenario/base_ref）
- 1 条 candidate GP `613c1e1f`（总军师），无 approved GP → 版本对比表在初始状态需降级为"暂无批准版本"空态
- 决策 af0d0818 明确三层定位，GP 资产层 = 四级下钻版式标杆（壳灌格子账本芯）

## Golden Path（核心场景）

系统从 [用户打开 /strategist/<lineId>，全貌 Tab 已有步骤矩阵] → 经过 [点击任一步骤行 → 右侧详情面板弹出，在"版本"子页签切到 GP 版本对比表（v列×11要素行）；相对上版变化的格子显示紫底；点击任一格子 → 行详情面板展开（多条目带日期/isNew标记）；点击展开的条目再次点击收起] → 到达 [军师台 L1/L2/L3/L4 四级下钻完整可用，数据来自 journey_step_links 真实格子账本，版本轴锚定 golden_paths 批准记录]

具体：
1. [L1 触发] 用户打开 `/strategist/<lineId>`，全貌 Tab → 左侧矩阵加载成功，显示步骤行
2. [L1→L2 触发] 点击步骤行 → 右侧 `StepLedgerPanel` 弹出，"账本"视图展示当前要素/能力/场景格子（已有功能，保留）
3. [L2→GP版本对比] 切换到"版本"子页签 → 渲染 GP 版本对比表：列 = 版本（v1, v2…当前），行 = 11要素键（FR/NFR/判定点等），表头含版本列标签；无批准 GP 时显示空态提示
4. [紫 diff] 若某格子相对上一版本有变化（cell_status 或 assertion_ref 变化），该格子带 `changed` 紫底 class
5. [L3 触发] 点击版本对比表任一格子 → 行详情面板展开，展示该格子的条目列表（含日期、isNew 标记、依赖 tag）
6. [L3→L4] 再次点击 → 行详情面板收起
7. [跨线一致] 不同 lineId 进入全貌页，结构相同：有账本 → 矩阵；无账本 → 空态提示 + 铺账本入口

## 边界情况

- **无批准 GP**（如锚点 journey 仅有 candidate GP）→ 版本对比表显示空态"本线暂无批准版本记录"提示，不报错
- **单版本 GP**（只有 v1，无前版对比）→ 无紫 diff，所有格子正常渲染，不报错
- **格子账本为空**（步骤无任何 cell_key）→ 版本对比表 = 空格，行均显示"—"
- **步骤未选中时**点击版本对比格子 → 不响应（面板未弹出，操作无效）
- **线 A 有账本，线 B 无账本** → 全貌 Tab 都渲染矩阵区域：A 正常展示，B 显示空态提示 + 铺账本入口（`LayoutGrid` 图标 + "账本模板铺入后自动出现"），不是"另一种布局"

## 范围限定

**在范围内**（批次1/2）：
- `StepLedgerPanel` 版本子页签：GP 版本对比表（v列×11要素行）
- 格子级快照 diff（两版本间状态变化标紫底 `changed` class）
- 行详情面板（L3）：点击格子展开条目列表（date/isNew/tag），再点收起（L4）
- 无批准 GP / 单版本 GP 空态降级处理
- 跨线全貌页布局一致性确认（无账本空态 = 统一结构）

**不在范围内**（批次2/2，显式裁剪）：
- 军师对话页修复（对话 Tab）
- 拍板卡形态（拍板 Tab）
- 要素页接线（要素 Tab）
- 新数据表（快照表如需，用 golden_paths 已有记录推导，无需新建表）
- GP 批准/驳回/推进等写操作

## 假设

- [ASSUMPTION: `golden_paths` 批准记录（status='approved' 或 status='delivered'，按 approved_at 排序）即版本轴，Proposer 按此字段拉取版本列表]
- [ASSUMPTION: 格子级快照 diff 通过对比同一 (step_id, cell_key) 在不同 GP 版本时刻的 cell_status + assertion_ref 推导，无需新建快照表，快照从 journey_step_links 记录的 created_at/updated_at 与 GP approved_at 时间轴对比]
- [ASSUMPTION: 锚点 journey 8bb8252f 当前无已批准 GP，紫 diff E2E 断言需在测试 fixture 中写入一条 approved GP 记录（或用已有 candidate GP 降级为演示对比），不依赖生产数据]
- [ASSUMPTION: 截图（L1/L2/L3 各一张）在 mac_web Playwright 执行时保存到 `sprints/08051141-relay-7835c87b/screenshots/`，并在 PR 描述中附链接]
- [ASSUMPTION: 全部改动在 `apps/dashboard/src/pages/strategist/StrategistLinePage.tsx`，无需改 Brain API 或新增路由]

## 预期受影响文件

- `apps/dashboard/src/pages/strategist/StrategistLinePage.tsx`：主要改动，`StepLedgerPanel` 的版本子页签补充 GP 版本对比表、紫 diff、行详情面板（L3/L4）
- `apps/dashboard/src/pages/strategist/StrategistLinePage.tsx`（`OverviewTab`）：确认无账本空态显示一致性（可能无需改动，仅确认）
- 可选：新增 `data-testid` 属性供 E2E 断言定位

## NFR 约束

- **响应性**：版本列表 API 调用（`/api/brain/golden-paths?journey_id=...`）在 2s 内返回；loading 状态需有转圈指示
- **零新表**：不引入新数据库表；版本对比数据从现有 `golden_paths` + `journey_step_links` 推导
- **样式一致**：紫底 diff class 命名为 `changed`（或 `bg-violet-500/15 border-violet-500/20` 内联 TailwindCSS，与现有 `∅ 格子快照待照相层接入` 的 `bg-violet-900/10` 色系对齐）
- **可观测**：`data-testid` 覆盖：`gp-version-table`（版本对比表根）、`gp-version-cell-changed`（紫 diff 格子）、`step-row-clickable`（可点步骤行）、`cell-detail-panel`（行详情面板）
- **不破坏已有**：账本子页签（ledger view）及 L1 矩阵行为不得回退；已有 `StepLedgerPanel` 组件接口签名不变
- **修 bug 的 failing test 必须 commit 进 CI 永久保留**（regression test，不可删）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级全量（本 sprint 相关摘录） -->
- [真环境验证才算done] 依赖 Brain API/DB/DOM 的断言必须有真实证据后才可 done；mock 渲染不等于功能落地（来源: area）
- [禁写死环境假设值] lineId/journeyId/gpId 不得写死；测试 fixture 中的 ID 必须动态注入或预先约定（来源: area）
- [测试默认多租户] 测试用例必须 scope 到正确 journey_id，禁止跨租户数据泄露（来源: area）
- [端点鉴权] 若新增 API 端点，必须有 auth；本 sprint 复用已有 `/api/brain/golden-paths` 端点，无新增（来源: area）
- [capture-triage] Proposer 复用历史合同模板时必须先核对本次任务真实派发历史，不能假设路径与先例相同（来源: area）
- [capture-triage] Red commit 必须只 git add 精确路径，禁止 git add .（来源: area）
- [capture-triage] 给 harness-generator 补铁律：禁止 generator 自行 merge PR，merge 权归 controller（来源: area）
- [单 slot 串行任务] 并行只许跨 slot（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 最近已合并 PR feat(strategist): 军师台UI②③④——晨报/投入账/全貌页+GP版本面板+收编退役 [#4641] -->
- FR-Acc-001 全貌 Tab L1 矩阵：步骤行×要素格子矩阵正确渲染，点击步骤行弹出右侧 `StepLedgerPanel`（已验收）
- FR-Acc-002 `StepLedgerPanel` 账本视图：能力/要素/场景三区块按 cell_kind 分组展示，`CellRowDetail` 展开正常（已验收）
- FR-Acc-003 全貌 Tab 无账本空态：`LayoutGrid` + "账本模板铺入后自动出现"提示（已验收，本 sprint 不得改变）
- FR-Acc-004 GP 版本列表请求：`StepLedgerPanel` 切换 versions 子页签时调用 `/api/brain/golden-paths?journey_id=...`（已有代码骨架，本 sprint 补充内容）

## E2E 验收（mac_web Playwright，禁只断言渲染）

```typescript
// target_environment: mac_web（Playwright 本机，localhost:5174，内网）
// 文件：sprints/08051141-relay-7835c87b/tests/e2e-gp-drill.spec.ts
//
// 前提：
//   - Cecelia Dashboard 在 localhost:5174 运行（VITE_SKIP_AUTH=true）
//   - Brain API 在 localhost:5221 运行
//   - 测试前确保有至少一条 journey 存在（可用锚点 journey 8bb8252f）
//   - 截图保存到 sprints/08051141-relay-7835c87b/screenshots/

// Scenario 1（L1→L2）：步骤行可点，右侧面板出现
// test: 打开 /strategist/<lineId>，等待步骤行渲染，点击第一行
//   → 断言 [data-testid="step-ledger-panel"] 可见（DOM 有变化，不是死行）
//   → 截图 L1.png（全貌矩阵）

// Scenario 2（L2 版本对比表）：GP 版本对比表结构断言
// test: 在 StepLedgerPanel 点击"版本"子页签
//   → 断言 [data-testid="gp-version-table"] 存在
//   → 断言表头包含至少一个版本列标签（如"v1"或"当前"）且含 FR/NFR/判定点 行标签
//   → 截图 L2-version-table.png

// Scenario 3（紫 diff）：对有两个版本的 GP，断言 changed 样式格存在
// test: （fixture 预置或动态选择有两个 approved GP 的 journey）
//   → 断言至少一个 [data-testid="gp-version-cell-changed"] 存在
//   → 该元素带紫底 class（检查 classList 含 bg-violet 或 changed）

// Scenario 4（L3 行详情）：点击版本对比格子展开详情面板
// test: 点击版本对比表中任一格子
//   → 断言 [data-testid="cell-detail-panel"] 变为 visible
//   → 断言面板内有至少一条条目带日期字段（文本含 "-" 日期格式）
//   → 再次点击同一格子
//   → 断言 [data-testid="cell-detail-panel"] 变为 hidden 或 detached

// Scenario 5（跨线一致）：无账本 journey 显示空态提示
// test: 打开一个无格子账本的 lineId（或清空账本数据的 fixture）
//   → 断言全貌 Tab 仍存在矩阵区域（无账本显示 LayoutGrid 空态，不是另一种布局）
//   → 断言 "账本模板铺入后自动出现" 文本可见

// 截图存档：L1/L2/L3 三层各一张进 PR（screenshots/ 目录）
```

期望验收点（自然语言）：
1. `/strategist/<lineId>` 全貌页点击任一步骤行 → 右侧面板出现（`step-ledger-panel` testid 可见，DOM 断言有变化）
2. 版本子页签 → `gp-version-table` 存在，表头含版本列标签 + FR/NFR/判定点 行标签
3. 对有 ≥2 个批准版本的 GP：至少 1 个 `gp-version-cell-changed` 元素存在，且有紫底样式
4. 点击版本对比格子 → `cell-detail-panel` 出现，含带日期的条目；再点 → 面板收起
5. 无账本 journey 全貌页 = 空态提示 + 铺账本入口（统一布局，不是另一种组件结构）
6. 截图存档：L1（矩阵）/ L2（版本对比表）/ L3（行详情）各一张

## NFR 约束补充

- DevGate：改动在 `apps/dashboard/` 前端，无需 Brain DevGate 三件套；但 PR 必须通过 workspace-ci.yml
- 安全：截图不含 token/凭据；API 调用复用已有鉴权机制
- 无新数据表：Quick snapshot diff 从 golden_paths.approved_at + journey_step_links 时序推导

## journey_type: frontend_feature
## journey_type_reason: 纯前端 UI 改动，`apps/dashboard/src/pages/strategist/StrategistLinePage.tsx`，无 Brain API 新增，无数据迁移
## target_environment: mac_web
## target_environment_reason: 军师台 Dashboard UI，E2E 用 Playwright 本机 localhost:5174 验收，决策 CLAUDE.md §E2E路由：Cecelia Dashboard → mac_web
## journey_id: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
## step_id: 626817c6-3dc7-4773-97ab-d4892f064e8e（锚点：下钻证据步骤）
