# Sprint PRD — Harness Pipeline 核心稳定化（异步化 + Patrol + Agent 通信）

## OKR 对齐

- **对应 KR**：Harness Pipeline 可用性 — Brain tick 在长时任务中不阻塞
- **当前进度**：60%
- **本次推进预期**：80%

## 背景

Planner/GAN 当前在 Brain LangGraph 中同步阻塞，Brain tick 被卡 10-30min。Patrol 未覆盖 harness_initiative。harness_intervention handler 是空桩。thread_lookup.status 无完整生命周期。无 Agent 消息通信通道。

## Golden Path（核心场景）

**WS1 — Planner 异步化**：Brain tick 触发 harness_initiative → Planner 节点以 detached 模式启动 → 写 thread_lookup → interrupt() 挂起 graph → Brain tick 继续处理其他任务 → Planner callback 到来 → graph resume → 进入 GAN 阶段

**WS2 — GAN 每轮异步化**：GAN 循环每轮 Proposer/Reviewer → detached 模式启动 → interrupt() 挂起 → Brain tick 不占用 → callback 到来 → resume → 继续下一轮直至 approved 或轮数上限

**WS3 — Harness Patrol + Intervention**：Brain tick → Patrol 扫描 initiative_runs（completed_at IS NULL）→ 检测卡住阈值（Planner>15min, GAN>20min）→ 创建 harness_intervention 任务 → task-router 派发 → handler 读 Docker logs → LLM 分析 → retry/skip/告警

**WS4 — Agent 消息通信**：harness_messages 表持久化消息 → 容器内 poll GET /api/brain/harness/messages/:initiativeId/:subTaskId → 消费 → POST 创建新消息 → graph 结束/失败时 thread_lookup.status UPDATE 为 completed/failed

## Response Schema

### Endpoint: GET /api/brain/harness/messages/:initiativeId/:subTaskId

**Path Parameters**：
- `initiativeId` (UUID, 必填)：initiative 标识
- `subTaskId` (string, 必填)：sub-task 标识

**Query Parameters**：
- `consumed` (boolean-as-string, 可选, 默认 `false`)：是否包含已消费消息；禁用别名 `include_consumed`/`all`/`show_consumed`

**Success (HTTP 200)**：
```json
{"messages": [{"id": "<uuid>", "message": "<string>", "created_at": "<iso8601>", "consumed_at": null}]}
```
- `messages` (array, 必填)：空时返 `[]`
- 禁用字段名：`data`/`items`/`results`/`payload`/`list`

**Error (HTTP 404)**：`{"error": "<string>"}`

### Endpoint: POST /api/brain/harness/messages/:initiativeId/:subTaskId

**Request Body**：`{"message": "<string>"}`

**Success (HTTP 201)**：
```json
{"id": "<uuid>", "message": "<string>", "created_at": "<iso8601>"}
```
- 禁用响应字段名：`data`/`result`/`payload`/`body`

## 边界情况

- Planner callback 超时 >15min → Patrol 发现 → 创建 harness_intervention（防重：同 initiative 已有 pending intervention 则跳过）
- GAN 轮数超限 → 现有上限判断不变，detached 改造不影响
- harness_messages 表查询到不存在的 initiativeId → 返 `{"messages": []}`（不返 404）
- thread_lookup.status 已为 completed → 幂等 UPDATE，不报错

## 范围限定

**在范围内**：
- `packages/brain/src/workflows/harness-initiative.graph.js`：WS1 Planner 节点 + WS2 GAN 节点异步化
- `packages/brain/src/pipeline-patrol.js` 或新增 `packages/brain/src/harness-patrol-plugin.js`：WS3 harness patrol
- `packages/brain/src/task-router.js` + 新增 `packages/brain/src/harness-intervention-handler.js`：WS3 handler 注册
- DB migration：`harness_messages` 表（WS4）
- `packages/brain/src/routes/harness.js`：GET/POST messages 端点（WS4）
- `packages/brain/src/lib/harness-thread-lookup.js`：status 生命周期（WS4）

**不在范围内**：GAN 收敛语义变更、Evaluator 节点、Dashboard UI、harness 外其他 patrol 逻辑

## 假设

- [ASSUMPTION: `packages/brain/src/spawn/detached.js` 已有稳定实现可复用于 WS1/WS2]
- [ASSUMPTION: Patrol 卡住阈值 Planner>15min, GAN>20min, Sub-task>60min，与 PrepPRD 一致]
- [ASSUMPTION: intervention handler LLM 分析用现有 Brain LLM 客户端（不引入新外部依赖）]
- [ASSUMPTION: harness_messages 查不到 initiativeId 返空数组而非 404（容器 polling 容错）]

## 预期受影响文件

- `packages/brain/src/workflows/harness-initiative.graph.js`：WS1 + WS2 核心改动
- `packages/brain/src/pipeline-patrol.js` 或新增 `packages/brain/src/harness-patrol-plugin.js`：WS3
- `packages/brain/src/task-router.js`：WS3 intervention 路由注册
- 新增 `packages/brain/src/harness-intervention-handler.js`：WS3 LLM handler
- DB migration 文件：harness_messages 表
- `packages/brain/src/routes/harness.js`：WS4 messages 端点
- `packages/brain/src/lib/harness-thread-lookup.js`：WS4 status 生命周期

## journey_type: autonomous
## journey_type_reason: 全部改动在 packages/brain/src/，无 UI/dashboard/engine 改动
## target_environment: local_api
## target_environment_reason: 纯后端 Brain 内部改动，curl localhost:5221 + psql 本地验证
