# Sprint PRD — Brain API: GET /api/brain/harness/initiative/:id/detail

## OKR 对齐

- **对应 KR**：KR（Harness Pipeline 可观测性 / Initiative 详情面板）
- **当前进度**：N/A（Brain API 上下文不可达，本地推断）
- **本次推进预期**：补全 ws3 Dashboard 详情面板所依赖的缺失后端 API 端点

## 背景

ws3 (PR #3106) 在 `HarnessPipelinePage` 中新增了 `InitiativeDetailPanel` 组件，
该组件调用 `GET /api/brain/harness/initiative/:id/detail`，但 Brain 后端从未实现该端点。
结果：详情面板打开时始终显示"详情加载失败"。
本次 sprint 补实现该端点。

## Golden Path（核心场景）

Dashboard 从 [点击 Initiative Card → 打开 InitiativeDetailPanel] → 经过 [前端调用 GET /api/brain/harness/initiative/:id/detail] → 到达 [面板展示 PRD 全文 + 步骤时间线 + 合约摘要]

具体：
1. 前端带 initiative_id（即 harness_initiative 任务 ID）调用该端点
2. Brain 从 `initiative_contracts` 表读取 `prd_content`、`contract_content`；从 `cecelia_events`（event_type='langgraph_step'）重建 `step_timing` 和 `gan_rounds`
3. 返回 HTTP 200，body 含 `initiative_id`、`prd_content`、`contract_content`、`gan_rounds`、`step_timing`、`screenshot_urls`

## Response Schema

### Endpoint: GET /api/brain/harness/initiative/:id/detail

**Path Parameters**:
- `id` (string, 必填): harness_initiative 任务 ID（UUID 格式）

**Query Parameters**: 无

**Success (HTTP 200)**:
```json
{
  "initiative_id": "e04a51cb-b13e-4389-bb3e-1d21267dd2e3",
  "prd_content": "# Sprint PRD...",
  "contract_content": "# Contract DoD...",
  "gan_rounds": 2,
  "step_timing": [
    {"node": "planner", "started_at": "2026-05-25T10:00:00Z", "ended_at": "2026-05-25T10:01:00Z", "duration_ms": 60000},
    {"node": "proposer", "started_at": "2026-05-25T10:01:00Z", "ended_at": null, "duration_ms": null}
  ],
  "screenshot_urls": []
}
```
- `initiative_id` (string, 必填): 原样返回请求的 id
- `prd_content` (string|null, 必填): 来自 `initiative_contracts.prd_content`，无则 null
- `contract_content` (string|null, 必填): 来自 `initiative_contracts.contract_content`，无则 null
- `gan_rounds` (number|null, 必填): 从 cecelia_events 统计（proposer+reviewer langgraph_step 配对数），无则 null
- `step_timing` (array, 必填): 从 cecelia_events langgraph_step 事件列表，每元素含 `node/started_at/ended_at/duration_ms`；无则 `[]`
- `screenshot_urls` (array, 必填): 当前固定返回 `[]`（截图存储未实现）
- **禁用字段**: 不得出现 `steps`/`stages`/`tasks`/`contract`/`runs`/`data`/`payload` 等

**Error (HTTP 404)**:
```json
{"error": "initiative not found"}
```

**Error (HTTP 400)**:
```json
{"error": "invalid id"}
```

**Schema 完整性**: 顶层 keys 必须完全等于 `["initiative_id","prd_content","contract_content","gan_rounds","step_timing","screenshot_urls"]`

## 边界情况

- id 不是合法 UUID → 400 `{"error":"invalid id"}`
- id 合法但无对应 contract/events（initiative 不存在）→ 返回 200 + null 字段 + 空数组（宽容降级，不返回 404，便于 frontend 渲染"无数据"空态）
- cecelia_events 表查询失败 → step_timing 降级为 `[]`，不抛 500

## 范围限定

**在范围内**：
- `packages/brain/src/routes/harness.js` 新增 `GET /initiative/:id/detail` 路由
- 从 `initiative_contracts` 读 prd_content / contract_content
- 从 `cecelia_events` 重建 step_timing + gan_rounds
- screenshot_urls 固定返回 `[]`

**不在范围内**：
- 截图上传/存储功能
- Dashboard 前端改动（已有 InitiativeDetailPanel，等待端点即可）
- `initiative_contracts` 或 `cecelia_events` 表 schema 变更

## 假设

- [ASSUMPTION: initiative_contracts 表含 prd_content / contract_content 列（与 /dag 端点相同查法）]
- [ASSUMPTION: cecelia_events 表含 task_id::uuid + event_type='langgraph_step' + payload（含 node/started_at/ended_at）]
- [ASSUMPTION: harness.js router 已挂载在 /api/brain/harness/ 前缀下，新路由加在同文件即可]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`: 新增 GET /initiative/:id/detail 路由（约 60-80 行）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 内部 API 路由，无 UI 改动
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端端点，evaluator 在本地 curl localhost:5221/api/brain/harness/initiative/:id/detail 验证
