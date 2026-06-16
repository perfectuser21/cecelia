# Sprint PRD — Harness Initiative 健康度端点 `GET /api/brain/harness/initiative/:id/health`

## OKR 对齐

- **对应 KR**：Harness Pipeline 端到端机械连通性（prep→report Final E2E PASS）
- **当前进度**：今晨 #3383 / #3386 修复后待真验
- **本次推进预期**：用一个范围极小的真实只读 Feature，验证管道从 prep 一路跑到 report 且 Final E2E PASS

## 背景

今晨修复（#3383 inferTaskPlan 坏产物改 terminal、#3386 GAN 子图 thread_id + proposer 分支按 attempt 版本化）后，需要一个干扰项最小的真实 Feature 来验证 Harness Pipeline 的机械连通性。选 local_api 目标、纯只读端点，把"产品本身会失败"的概率降到最低，专注测管道本身是否能从 prep 跑到 report。

本次新增端点本身也有产品价值：主理人对任意一个 Sprint Run 能立刻得到一句话健康判断，不用自己拼 runs+events 两个端点去猜它卡没卡。

## Golden Path（核心场景）

用户/系统从 [主理人对一个 initiative 调健康端点] → 经过 [系统读 initiative_runs + initiative_run_events 做健康裁决] → 到达 [返回一句话健康判断 JSON]

具体：

1. 主理人调 `GET /api/brain/harness/initiative/:id/health`（传一个真实 initiative_id）
2. 系统读 `initiative_runs` + `initiative_run_events`，综合该 Run 的状态、最后节点、重试与中断次数、卡住时长，做出健康裁决
3. 返回 200 + JSON，含 `healthy`、`state`、`last_node`、`retries`、`interrupts`、`stuck_minutes`、`reason` —— 用户一眼看出这个 Run 是健康在跑 / 卡住 / 僵尸 / 已完成 / 已失败

异常分支：

- 主理人传一个"卡在 prep 反复重试"的 Run id → 返回 `state=stuck`（含 `stuck_minutes=N`、`retries=N`、`last_node=prep`）→ 用户据此判断要不要重启该 Run
- 主理人传非法 UUID → 返回 400 + 清晰 error 字段（用户知道是 ID 格式写错了）
- 主理人传合法但不存在的 id → 返回 404 + 清晰 error 字段（用户知道这个 Run 不存在，而非端点挂了）

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。healthy/state/last_node/retries/interrupts/stuck_minutes/reason 七个字段名见 PrepPRD，作为产品意图锚点。 -->

## 边界情况

- 该 initiative 存在但还没有任何 run 事件 → 给出可解释的裁决（如 state 表示未开始/无数据），不报 500
- 卡住与僵尸的区分（stuck vs zombie）依据 stuck_minutes 与重试/中断信号，判定逻辑须可被 psql 比对验证
- 非法 UUID 格式（400）与合法但不存在（404）必须区分，不能混为一谈

## 范围限定

**在范围内**：
- 新增只读端点 `GET /api/brain/harness/initiative/:id/health`
- 数据来自现有表 `initiative_runs` + `initiative_run_events`
- 健康裁决逻辑（healthy / state / last_node / retries / interrupts / stuck_minutes / reason）
- 400（非法 UUID）/ 404（不存在）错误处理
- unit + smoke（curl）测试

**不在范围内**：
- 前端展示（接进 out/harness-pipeline.html 检查器，留下个 sprint）
- 全局健康榜 / 批量列出所有 stuck/zombie run
- 任何 DB migration 或写操作

## 假设

- [ASSUMPTION: 端点挂在 Brain 现有 harness 路由模块下，与已有 `/harness/initiative/:id/detail` 同处一文件]
- [ASSUMPTION: 健康裁决为纯计算（基于读出的 runs/events），不引入新表、不缓存]

## 预期受影响文件

- `packages/brain/src/`（harness 路由模块，与 `/harness/initiative/:id/detail` 同处）：新增 health 端点处理器与健康裁决逻辑
- `packages/brain/`（测试目录）：新增 unit 测试（裁决逻辑）+ smoke 测试（curl 端到端）

## E2E 验收

> Planner 初稿此区块留占位 + 自然语言验收点。最终可执行的 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + psql），写进 contract-draft.md 的 `## E2E 验收` 区块。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql 比对）
# 期望验收点（自然语言）：
#  1. curl GET /api/brain/harness/initiative/4225330d-6ff8-42ed-8eb1-d152be920b3b/health
#     → 200，JSON 含 healthy / state / last_node 字段
#  2. 对已 failed 的 run → state=failed；对卡在 prep 反复重试的 run → state=stuck/zombie
#     （psql 查 initiative_run_events 比对判定逻辑正确）
#  3. 非法 UUID → 400 + error 字段；合法但不存在的 id → 404 + error 字段
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端只读端点，无 UI、无远端 agent、无 engine 改动
## target_environment: local_api
## target_environment_reason: Brain 内部只读 API，验收仅用本地 curl localhost:5221 + psql 比对，无外部凭据/机器依赖
## journey_id: Line 唯一（Cecelia Harness Pipeline）— 来源 task.payload.journey_id，缺则取 PrepPRD 锚定
## step_id: Harness Initiative 健康度端点（feature_id fe8922dd-dc73-47eb-9a5b-551698d2ede8，新增 thin）
