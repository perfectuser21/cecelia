# Sprint PRD — Harness Initiative 健康度只读端点 `GET /api/brain/harness/initiative/:id/health`

## OKR 对齐

- **对应 KR**：Harness Pipeline 端到端可观测性（单个 Run 健康可裁决）
- **当前进度**：已有 `/harness/runs`、`/runs/:id/progress`、`/initiative/:id/detail`、`/harness/stats`
- **本次推进预期**：补齐"单个 initiative 一句话健康裁决"端点（thin）

## 背景

今天凌晨修复（#3383 / #3386）后，需用一个范围极小的真实 Feature 验证 Harness Pipeline 能从 prep 一路跑到 report 且 Final E2E PASS。选 local_api 把"产品本身会失败"的干扰降到最低，纯测管道机械连通性。现有端点只能查到 runs+events 原始数据，主理人要自己拼两个端点猜 Run 卡没卡；本次提供一句话健康裁决端点作为数据源。

## Golden Path（核心场景）

主理人对某真实 initiative 调 `GET /api/brain/harness/initiative/:id/health` → 系统读 `initiative_runs` + `initiative_run_events` → 返回健康裁决 JSON，主理人一眼看出该 Run 是健康在跑 / 卡住 / 僵尸 / 已完成 / 已失败。

具体：
1. 主理人调 `GET /api/brain/harness/initiative/:id/health`，传一个合法且存在的 initiative_id
2. 系统读 `initiative_runs`（取该 initiative 最新 run 的 state/node）+ `initiative_run_events`（统计重试、打断、最近事件时间），按判定逻辑裁决健康状态
3. 系统返回 200 + JSON：`healthy`（布尔）、`state`（healthy/stuck/zombie/completed/failed）、`last_node`（当前/最后所在节点，如 prep）、`retries`、`interrupts`、`stuck_minutes`、`reason`（一句话判定依据）
4. （场景二）对"卡在 prep 反复重试"的 Run 调用 → 返回 `state=stuck`、`stuck_minutes=N`、`retries=N`、`last_node=prep`，主理人据此判断是否重启
5. （异常）传非法 UUID → 返回 400 + 清晰 `error`；传合法但不存在的 id → 返回 404 + 清晰 `error`，主理人知道是 ID 写错而非端点挂了

## 边界情况

- 非法 UUID 格式 → 400，不进 DB 查询
- 合法 UUID 但 `initiative_runs` 无记录 → 404
- 同一 initiative 有多条历史 run → 取最新一条作裁决依据
- 无任何 `initiative_run_events` → retries/interrupts 为 0，不报错
- 纯只读：不加 migration、不改写任何数据

## 范围限定

**在范围内**：
- 新增只读端点 `GET /api/brain/harness/initiative/:id/health`
- 基于现有表 `initiative_runs` + `initiative_run_events` 的健康裁决逻辑
- unit 测试（判定逻辑）+ smoke（curl）测试

**不在范围内**：
- 前端检查器（out/harness-pipeline.html）接入（留下个 sprint）
- 全局健康榜 / 批量列出所有 stuck/zombie run
- 任何 DB migration 或写操作

## 假设

- [ASSUMPTION: 同一 initiative 多 run 时，以最新 run 作健康裁决对象（PrepPRD 场景二未显式说明取哪条）]
- [ASSUMPTION: stuck 与 zombie 的阈值（stuck_minutes）由 proposer 在实现阶段按现有 tick 间隔/已有判定常量确定，PRD 不锁死具体分钟数]
- [ASSUMPTION: 端点实现落在现有 `packages/brain/src/routes/harness.js`，与已有 harness 端点同文件]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`: 新增 `/initiative/:id/health` 路由 + 健康裁决逻辑
- `packages/brain/src/__tests__/`: 新增 unit + smoke 测试（与现有 harness-*.test.js 同目录）

## E2E 验收

> Planner 初稿留占位 + 自然语言验收点；最终可执行脚本由 proposer 在 GAN 阶段按 `target_environment=local_api` 填入（curl + psql）。

```bash
# 占位：proposer 将填入 local_api 真实脚本（curl localhost:5221 + psql 比对）
# 期望验收点（自然语言）：
# 1. curl GET /api/brain/harness/initiative/4225330d-6ff8-42ed-8eb1-d152be920b3b/health → 200，JSON 含 healthy / state / last_node
# 2. state 正确反映 run 实况：已 failed 的 run 返回 failed；卡在 prep 反复重试的 run 返回 stuck/zombie（psql 查 initiative_run_events 比对判定逻辑）
# 3. 非法 UUID → 400 带 error；合法但不存在的 id → 404 带 error
# 4. 先 commit failing test（commit-1）再实现（commit-2）；CI 全绿
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端只读端点，无 UI、无远端 agent、无 engine 改动
## target_environment: local_api
## target_environment_reason: 仅 curl localhost:5221 + psql 本地 Brain 即可验证，无外部凭据/机器
## journey_id: Harness Pipeline（Cecelia Line 唯一；task.payload.journey_id 未注入，PrepPRD 未提供具体 UUID，锚定到 Harness Pipeline journey）
## step_id: feature fe8922dd-dc73-47eb-9a5b-551698d2ede8（Harness Initiative 健康度端点，来源 = PrepPRD「涉及的 Ability / Feature」锚定结果）
