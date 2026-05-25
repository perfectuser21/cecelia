# Sprint PRD — Brain API initiative/:id/detail 端点

## OKR 对齐

- **对应 KR**：KR（Harness Pipeline 可观测性）
- **当前进度**：N/A（Brain API 上下文不可达，本地推断）
- **本次推进预期**：补全 dashboard Initiative 详情面板所需的 Brain API 端点，使侧栏数据可渲染

## 背景

ws3 已实现 `InitiativeDetailPanel` 组件（`HarnessPipelinePage.tsx`），该组件在用户点击 pipeline 卡片时展开，调用 `GET /api/brain/harness/initiative/${id}/detail` 获取 PRD 内容、合约摘要、步骤时间线、截图链接。但该端点在 Brain `packages/brain/src/routes/harness.js` 中**不存在**，导致侧栏始终显示"详情加载失败"。

## Golden Path（核心场景）

用户从 [HarnessPipelinePage 点击任意 harness_initiative 卡片] → 经过 [InitiativeDetailPanel 向 Brain 发送 GET /initiative/:id/detail 请求，Brain 查询任务表+读取 sprint 文件] → 到达 [侧栏成功渲染 PRD 全文、步骤时间线和合约摘要]

具体：
1. 用户点击 pipeline 列表中一个 `harness_initiative` 类型的卡片
2. 前端 `InitiativeDetailPanel` 发送 `GET /api/brain/harness/initiative/{id}/detail`
3. Brain 查询 tasks 表获取 initiative 记录（含 sprint_dir、payload），读取 `{sprint_dir}/sprint-prd.md` 和 `{sprint_dir}/sprint-contract.md`，聚合任务阶段时间（started_at/completed_at），返回 JSON
4. 侧栏渲染 PRD 全文、步骤时间线（各阶段耗时）、合约摘要；无截图时 screenshot_urls 为空数组

## Response Schema

### Endpoint: GET /api/brain/harness/initiative/:id/detail

**Path Parameters**:
- `:id` (string, UUID, 必填): harness_initiative 任务的 id

**Query Parameters**: 无

**Success (HTTP 200)**:
```json
{
  "initiative_id": "bf597bb0-9d68-44cc-835a-59495e385763",
  "prd_content": "# Sprint PRD...",
  "contract_content": "# Contract DoD...",
  "gan_rounds": 2,
  "step_timing": [
    { "node": "harness_planner", "started_at": "2026-05-25T10:00:00Z", "ended_at": "2026-05-25T10:05:00Z", "duration_ms": 300000 },
    { "node": "harness_proposer", "started_at": null, "ended_at": null, "duration_ms": null }
  ],
  "screenshot_urls": []
}
```

- `initiative_id` (string, 必填): 与请求路径 :id 相同
- `prd_content` (string|null, 必填): sprint-prd.md 全文；文件不存在时为 null
- `contract_content` (string|null, 必填): sprint-contract.md 全文；文件不存在时为 null
- `gan_rounds` (number|null, 必填): GAN 对抗轮次计数；无数据时为 null
- `step_timing` (array, 必填): 各 harness 阶段任务列表，空时为 `[]`
  - `node` (string): task_type 字段值
  - `started_at` (string|null): ISO8601 或 null
  - `ended_at` (string|null): ISO8601 或 null
  - `duration_ms` (number|null): 毫秒耗时或 null
- `screenshot_urls` (array of string, 必填): 截图 URL 列表，无数据时为 `[]`

**禁用响应字段名**: `prd`/`contract`/`timeline`/`screenshots`/`stages`/`details`/`data`（必须完全按上述字段名）
**Schema 完整性**: 顶层 keys 必须完全等于 `["initiative_id","prd_content","contract_content","gan_rounds","step_timing","screenshot_urls"]`

**Error (HTTP 404)**:
```json
{"error": "initiative not found"}
```

**Error (HTTP 500)**:
```json
{"error": "<string>"}
```

## 边界情况

- initiative id 不存在或 task_type != 'harness_initiative' → 404
- sprint 文件不存在（prd/contract）→ 对应字段返回 null，不报 5xx
- 无 harness 子任务 → `step_timing: []`，`gan_rounds: null`
- initiative 刚创建尚无文件 → 正常返回 null 字段，不报错

## 范围限定

**在范围内**：`GET /api/brain/harness/initiative/:id/detail` 路由实现（只读）
**不在范围内**：POST/PATCH/DELETE、截图上传逻辑、前端 `InitiativeDetailPanel` 改动（已实现）、ws-progress 端点改动

## 假设

- [ASSUMPTION: sprint 文件从本地文件系统读取，路径为 REPO_ROOT/{sprint_dir}/sprint-prd.md，与现有 readSprintFiles 逻辑一致]
- [ASSUMPTION: step_timing 从 tasks 表的 started_at/completed_at 聚合，无需读取 checkpoint_blobs]
- [ASSUMPTION: screenshot_urls 初始版本返回空数组，后续可从 harness_ai_notes 扩展]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`: 新增 `GET /initiative/:id/detail` 路由

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 内部路由，无 UI 改动、无外部 agent 协议
## target_environment: local_api
## target_environment_reason: 纯 Brain 内部端点，evaluator 在本地 curl localhost:5221/api/brain/harness/initiative/:id/detail 验证
