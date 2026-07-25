# Sprint PRD — Kernel telemetry：逻辑轮次与耗时账本

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

当前 Kernel Harness 的 attempt 账本只能暴露 Planner 4 / Reviewer 5 / Generator 9 这类原始计数，无法区分 logical cycle、retry、resume、restart、invalid evaluation，也存在 generator 长期 running 无 completed_at、judge/reporter 时间缺口、orphan attempt 无法结构化收口的问题。本 sprint 需要在不改变 Kernel 路由决策和合同冻结语义的前提下，把结构化 lineage、耗时与 orphan 收口补齐，让 UI/API 能区分有效工作与系统损耗，并为后续 Commander Phase 1 复用统一命名。

## Golden Path（核心场景）

任务观察者从 Kernel telemetry 查询入口进入 → 系统按 task 聚合多个 run 的 attempt lineage 与耗时账本 → 观察者能看清 logical cycle、重试/恢复损耗、orphan 收口结果与 reporter/judge 起止时间。

具体：
1. 观察者查询某个 task 的 Kernel telemetry，看到每个 attempt 都带有 `logical_cycle_id`、`attempt_kind`、`retry_of_attempt_id`、`restart_reason` 与 `workstream key`。
2. 系统把同一 task 跨多个 run 的 attempt 按 logical cycle 和 workstream 聚合，返回按 role/workstream 拆分的 active time、wall time、wait time，以及 retry/recovery/invalid counts。
3. 当旧的 starting/running attempt 已过 lease 且失去执行者时，系统要么把它们结构化标记为 resume/recovery 链的一部分，要么写入终结状态，不再永久停留在 running。
4. reporter 与 judge 也能提供统一的起止时间；若时间只能推导获得，返回结构化 derived 标志而不是缺口。
5. 基于本次 4-run 形状 fixture，观察者能把 4/2/5/9/5 raw counts 还原成逻辑轮次与系统损耗，而不是只看到原始角色次数。

## 边界情况

- migration 只能 additive；允许本地与测试库 Red→Green，禁止生产数据库写入。
- orphan attempt 尚未过 lease 时，不提前终结，也不伪造 resume/recovery。
- 同一 task 跨多个 run 聚合时，必须仅依据结构化字段判断 lineage，不从 Agent 自然语言猜状态。
- reporter/judge 若缺少原生时间戳，必须明确 `derived` 语义，不能默默填充伪造时间。
- 本 sprint 不得改动 Kernel 路由决策、合同冻结语义、run bootstrap 或 preflight 主流程。

## 范围限定

**在范围内**：attempt lineage 字段补齐；logical cycle 与 retry/resume/recovery 分类；lease 过期 orphan 收口；Kernel telemetry 查询 API；按 role/workstream/time bucket 聚合；4-run fixture 与回归测试；最小 dispatcher metadata 接线；DEFINITION.md 与版本账本同步。
**不在范围内**：Commander 状态；Memory/Directive；Harness Actor Inbox；唤醒逻辑；第二流程账本；生产环境数据库执行；弱化或改写既有合同测试；自动 merge。

## 假设

- [ASSUMPTION: 该任务锚定在 `packages/brain/` 的 Kernel/Harness 后端链路，`journey_type` 取 `autonomous`，E2E 在本地 API 与测试数据库完成。]
- [ASSUMPTION: 现有权威表仍可作为唯一真相源，新增 telemetry 字段与聚合接口只做可重建补充，不引入新的主状态机。]
- [ASSUMPTION: `step_id` 未在当前 payload 明确提供，本 sprint 以 Kernel telemetry hotfix 主题作为锚点，后续 proposer 若拿到更细 Golden Path 锚点可细化。]

## 预期受影响文件

- `packages/brain/src/`: attempt store、dispatcher 最小 metadata 接线、Kernel telemetry route 与聚合逻辑、judge/reporter 时间统一处理。
- `packages/brain/src/__tests__/`: 4-run fixture、orphan 收口、lineage 分类、聚合 API 与回归测试。
- `packages/brain/migrations/` 或等价 schema 目录: additive migration，增加 attempt lineage 与时间账本所需字段。
- `DEFINITION.md`: Brain 源码行为变更后的版本与规则账本同步。
- 版本账本四处同步文件: 跟随 Brain 版本更新，保持仓库规则一致。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [外部真相] orphan requeue 或 watchdog_overdue 的恢复判定必须结合 PR、sprint 目录等外部真相核查后再重跑（来源: area）
- [语义成功] 通知/写库类成功判定必须看语义字段，不能只看 `ok:true` 之类表层成功位（来源: area）
- [心跳防误标] 长等待链路必须有周期性心跳或等价 lease 续约，避免存活 session 被误标 failed 导致收账断裂（来源: area）
- [真实多轮] 测试不能全部依赖冷启动重置，必须至少有一条真实多轮扫描、状态不重置、时间真实流逝的集成覆盖（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

(本 line 暂无历史)

## NFR 约束

- 超时/延迟: 查询 API 应能区分 active time、wall time、wait time，避免只暴露总时长。
- 频控: 聚合同一 task 的多个 run 时不得引入额外轮询写放大；查询应以现有权威表与可重建字段为准。
- 版本要求: Brain 源码变更必须同步 `DEFINITION.md` 与四处版本账本。
- 可观测: orphan 收口、retry/resume/recovery、derived 时间都必须通过结构化字段可查询，不允许只留自然语言日志。

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + 测试 Postgres）
# 期望验收点（自然语言）：
# 1. 建立 4-run 形状 fixture 后，查询 API 能把 Planner 4 / Reviewer 2 / Judge 5 / Generator 9 / Reporter 5 raw counts 还原为 logical cycles 与 retry/recovery/invalid 损耗。
# 2. lease 过期的 orphan starting/running attempt 被 resume 或结构化终结，不再永久 running。
# 3. 单个 attempt 查询能返回 logical_cycle_id、attempt_kind、retry_of_attempt_id、restart_reason、workstream key。
# 4. 按 task 聚合多个 run 时，返回 role/workstream 维度的 active time、wall time、wait time 与 retry/recovery/invalid counts。
# 5. reporter/judge 都有统一起止时间；若为推导值，则显式返回 derived 标志。
# 6. Kernel 路由决策与合同冻结语义回归保持不变。
```

## journey_type: autonomous
## journey_type_reason: 任务聚焦 `packages/brain/` 内部 Kernel/Harness 后端热修复，不涉及 UI、远端 agent 协议或 engine 流程。
## target_environment: local_api
## target_environment_reason: 纯 Brain/API 与测试数据库验证，执行位置应为本地 evaluator（`localhost:5221` + 本地/测试 Postgres）。
## journey_id: c9d5deb3-2736-4a99-946a-14d9326e01ae
## step_id: none（PrepPRD 未锚定）
