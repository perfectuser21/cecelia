# Sprint PRD — Brain 只读自检端点 GET /api/brain/harness-selftest

## OKR 对齐

- **对应 KR**：Harness Pipeline 端到端可验证（Cecelia Line 唯一 — Harness Pipeline）
- **当前进度**：流水线已打通 generator→CI→合 main→staging E2E→promote→report（参见 #3425~#3431）
- **本次推进预期**：补一个零副作用的只读探针，端到端拉通最后一公里的真验

## 背景

Harness pipeline（generator→CI→合 main→staging E2E→promote→report）已分阶段落地，需要一个**最小、纯新增、零副作用**的真实改动来端到端验证整条流水线能把一个 sprint 从代码生成一路跑到 report。Brain 新增一个只读自检端点是成本最低、风险最低的载体：不读数据库、不改任何现有行为，仅返回固定 JSON。

## Golden Path（核心场景）

系统/调用方从 [发起 HTTP 请求] → 经过 [Brain 命中只读自检路由] → 到达 [拿到固定自检 JSON]

具体：
1. [触发条件] 调用方对 Brain 发起 `GET /api/brain/harness-selftest`
2. [系统处理] Brain 命中该只读路由，不查数据库、不触发任何副作用，组装固定响应
3. [可观测结果] 返回 HTTP 200，响应体 JSON 中 `ok === true` 且 `service === "harness"`

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 并发多次请求：每次返回相同固定 JSON，无状态、幂等
- Brain 未连数据库 / 数据库异常：本端点不依赖数据库，仍应正常返回 200
- 重复部署：纯新增路由，不与现有任何端点路径冲突

## 范围限定

**在范围内**：
- 新增一个只读端点 `GET /api/brain/harness-selftest`
- 返回固定 JSON，含 `ok: true`、`service: "harness"`
- HTTP 状态码 200

**不在范围内**：
- 任何数据库读写
- 修改、删除或影响任何现有端点 / 行为
- 鉴权、限流、参数解析等附加逻辑
- 在响应中暴露动态运行时状态（版本、时间戳等不在本次范围）

## 假设

- [ASSUMPTION: 端点挂在 Brain 现有路由体系下（`packages/brain/src/routes/`），路径前缀沿用 `/api/brain/`]
- [ASSUMPTION: 响应 Content-Type 为 application/json]
- [ASSUMPTION: 端点对所有调用方开放，无需鉴权（与其它 `/api/brain/*` 只读探针一致）]

## 预期受影响文件

- `packages/brain/src/routes/`: 新增或挂载 `harness-selftest` 只读路由（具体文件由 Proposer/Generator 决定）
- `packages/brain/src/server.js`: 如需注册新路由，挂载入口（纯新增，不动现有挂载）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本次为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；只读端点应毫秒级返回）
- 频控: 无（只读探针，无副作用）
- 版本要求: 无
- 可观测: 无强制要求（端点本身即可观测探针）

## E2E 验收

> Planner 初稿此区块留占位 + 自然语言验收点。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + jq 断言）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#   对运行中的 Brain 发起 GET /api/brain/harness-selftest，
#   断言 HTTP 状态码 = 200，
#   断言响应 JSON 的 ok 字段 === true，
#   断言响应 JSON 的 service 字段 === "harness"，
#   并确认现有任一既有端点（如 /api/brain/context）行为不变。
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端只读端点，无 UI、无远端 agent、无 engine hooks
## target_environment: local_api
## target_environment_reason: Brain 内部纯 API 探针，本地 evaluator 用 curl localhost:5221 + jq 即可验收
## journey_id: cecelia-harness-pipeline（task.payload.journey_id 未注入，取 Cecelia Line 唯一 — Harness Pipeline）
## step_id: harness-e2e-verify-r3（PrepPRD 锚定：端到端验证 sprint）
