# Sprint PRD — Harness Pipeline 完整可视化 v2（截图链路 + 详情面板 + 报告增强）

## OKR 对齐

- **对应 KR**：提升 Cecelia harness 可观测性
- **当前进度**：WS1/WS2/WS3 进度可视化已上线（PR #3098/#3100）
- **本次推进预期**：initiative 详情（PRD全文/合约/时间线/截图）在 Dashboard 可见，reportNode 输出含 step_timing

## 背景

harness pipeline /pipeline 页面已能展示 WS 进度徽章，但缺两块：①evaluator 跑 mac_web E2E 时不留截图；② initiative 详情无法在 Dashboard 查看（PRD/合约/时间线都藏在 checkpoint_blobs + task_events 里，Dashboard 没有对应 API 也没有面板）。同时 reportNode 报告 JSON 缺少各阶段耗时和逐 WS 问题摘要。

## Golden Path（核心场景）

从 [运维人员打开 Dashboard /pipeline 页面，点击一个已完成的 initiative card] → 经过 [详情面板调 /api/brain/harness/initiative/:id/detail 获取PRD/合约/时间线/截图URL] → 到达 [面板展示 PRD 全文、GAN 合约摘要、步骤时间线、截图缩略图列表]

具体：
1. 用户点击 HarnessPipelinePage.tsx 的 initiative card
2. 页面调 `GET /api/brain/harness/initiative/:id/detail`
3. 面板展示：PRD 全文（Markdown 渲染）/ GAN 合约摘要 / 步骤时间线（节点名 + 耗时）/ 截图列表（if screenshot_urls 非空）
4. 截图来源：mac_web evaluator 在验收后自动截图，路径写入 `~/claude-output/harness-screenshots/`，URL 写入 checkpoint_blobs

## 5 个 Workstream 的交付范围

**WS1 — proposer skill 截图 DoD 自动注入**
`packages/workflows/skills/harness-contract-proposer/SKILL.md` 的 mac_web 合约模板：
每个 WS 的 contract-dod 末尾自动包含 [BEHAVIOR:E2E] 截图条目，格式：
`[BEHAVIOR:E2E:screenshot] evaluator 验收后截图存 screenshots/<ws_id>-<step>.png，复制到 ~/claude-output/harness-screenshots/`

**WS2 — Brain API /detail 端点**
`packages/brain/src/routes/harness.js` 新增路由（见 Response Schema）

**WS3 — Dashboard initiative 详情面板**
`apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`（或 HarnessPipelineDetailPage.tsx）：
点击 card → 侧栏/抽屉展示 PRD全文 / 合约摘要 / 步骤时间线 / 截图 section

**WS4 — reportNode 增强**
`packages/brain/src/workflows/harness-initiative.graph.js` 的 reportNode 函数：
report JSON 新增三字段（见下方 DoD）

**WS5 — E2E 截图链路验证**
新建轻量 playground 类型 harness initiative，验证 WS1-WS4 端到端

## Response Schema

### Endpoint: GET /api/brain/harness/initiative/:id/detail

**URL Parameters**:
- `id` (string, 必填): initiative UUID

**Success (HTTP 200)**:
```json
{
  "initiative_id": "46fef18e-5447-4717-a6bc-6cf30d628e03",
  "prd_content": "# Sprint PRD — ...",
  "contract_content": "## Contract ...",
  "gan_rounds": 2,
  "step_timing": [
    {"node": "prep", "started_at": "2026-05-25T10:00:00Z", "ended_at": "2026-05-25T10:01:00Z", "duration_ms": 60000},
    {"node": "plan", "started_at": "2026-05-25T10:01:00Z", "ended_at": "2026-05-25T10:03:00Z", "duration_ms": 120000}
  ],
  "screenshot_urls": ["file:///home/cecelia/claude-output/harness-screenshots/ws1-01.png"]
}
```

字段说明：
- `prd_content` (string|null): 来自 `initiative_contracts.prd_content`
- `contract_content` (string|null): 来自 `initiative_contracts.contract_content`
- `gan_rounds` (number|null): 来自 `initiative_contracts.review_rounds`
- `step_timing` (array): 从 `task_events WHERE event_type='graph_node_update' AND task_id=:id`，按 nodeName 聚合 min/max created_at，推算 duration_ms
- `step_timing[].node` (string): graph 节点名，如 `prep`/`plan`/`execute`/`evaluate`/`report`
- `step_timing[].started_at` (ISO string): 节点首次出现时间
- `step_timing[].ended_at` (ISO string): 节点最后出现时间
- `step_timing[].duration_ms` (number): ended_at - started_at 毫秒数
- `screenshot_urls` (array): 截图 URL 列表，来自 checkpoint_blobs channel='screenshot_urls' 或 []

**禁用响应字段名**: `steps`/`phases`/`timeline`/`data`/`result`/`details`/`info`

**Error (HTTP 404)**:
```json
{"error": "initiative not found"}
```

### reportNode 新增字段（WS4）

reportNode 返回的 report JSON 中新增：
```json
{
  "step_timing": [{"node": "prep", "duration_ms": 60000}],
  "ws_issues": [{"ws_id": "ws1", "feedback": "...", "ci_fail_type": "test_fail"}],
  "ws_costs": [{"ws_id": "ws1", "cost_usd": 0.12}]
}
```
- `step_timing` (array): 同 /detail 端点的 step_timing
- `ws_issues` (array): 来自 sub_tasks 的 evaluator feedback + ci_fail_type
- `ws_costs` (array): 来自 sub_tasks 的 cost_usd 分解

**禁用字段名**: `timings`/`timing`/`issues`/`costs`/`breakdown`

## DoD（验收条件）

1. [BEHAVIOR] `GET /api/brain/harness/initiative/:id/detail` 返回 HTTP 200，含 `prd_content`/`contract_content`/`gan_rounds`/`step_timing`/`screenshot_urls` 字段
2. [BEHAVIOR] `step_timing` 数组非空（initiative 有 task_events 时），每条含 `node`/`started_at`/`ended_at`/`duration_ms`
3. [BEHAVIOR] Dashboard 点击 initiative card 后，面板展示 PRD 全文文本（含 "# Sprint PRD"）
4. [BEHAVIOR] Dashboard 详情面板展示步骤时间线（至少显示 node 名和 duration）
5. [BEHAVIOR] reportNode 输出 JSON 含 `step_timing`/`ws_issues`/`ws_costs` 三个顶层字段
6. [BEHAVIOR] mac_web 类型 proposer 合约的 contract-dod 含截图条目字面 `screenshot`
7. [BEHAVIOR:E2E] 跑完 WS5 playground initiative 后，`screenshots/` 目录有 ≥1 个 PNG 文件
8. [ARTIFACT] `sprints/cecelia-pipeline-viz-v2/` 目录含 sprint-prd.md + contract-dod.md（每 WS 一份）

## 边界情况

- initiative 无 task_events → `step_timing: []`
- initiative 无 initiative_contracts 行 → prd_content/contract_content 均返 null，HTTP 200
- screenshot_urls 为空 → Dashboard 截图 section 不渲染（隐藏而非报错）
- step_timing 节点只出现一次 → started_at = ended_at，duration_ms = 0

## 范围限定

**在范围内**：上述 WS1-WS5；initiative_contracts 表只读（不新增列）；step_timing 从 task_events 推算（不新建表）
**不在范围内**：WebSocket 实时推送截图；截图上传云存储；非 harness_initiative 任务类型；apps/api/ 改动

## 假设

- [ASSUMPTION: initiative_contracts 表含 prd_content/contract_content/review_rounds 列，已由 PR #3091 创建]
- [ASSUMPTION: task_events 表含 task_id/event_type/payload/created_at 列，payload.nodeName 是节点名]
- [ASSUMPTION: checkpoint_blobs channel='screenshot_urls' 存储截图路径列表（若不存在，/detail 返回空数组）]

## 预期受影响文件

- `packages/workflows/skills/harness-contract-proposer/SKILL.md`: WS1 截图 DoD 条目
- `packages/brain/src/routes/harness.js`: WS2 新增 /detail 路由
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`（或 HarnessPipelineDetailPage.tsx）: WS3 详情面板
- `packages/brain/src/workflows/harness-initiative.graph.js`: WS4 reportNode 增强
- `packages/brain/src/__tests__/harness-detail.test.js`: WS2 单测（mock pool）

## journey_type: user_facing
## journey_type_reason: WS3 涉及 apps/dashboard/ React UI，initiative 详情面板是用户交互核心
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard 内网产品，本机 Playwright localhost:5174 验收（WS5 E2E）
