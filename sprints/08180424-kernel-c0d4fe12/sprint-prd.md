# Sprint PRD — Diff Impact Gate 透传 freshness.reason_code 并对确定性结论 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness kernel 一类空转死循环，提升调度可信赖度）

## 背景

Diff Impact Gate（`packages/brain/src/impact-contract/diff-gate.js`）在复算影响半径后，凡 Mapper
`freshness.status !== 'fresh'` 一律折叠成 `reason: 'mapper_stale', retryable: true`，丢弃了 Mapper
在 `freshness.reason_code` 上给出的**确定性结论**（如 `projection_revision_mismatch` —— 基线已永久漂移，
重试不会自愈）。该 receipt 经 `harness-gates.js` 的 `gateReceipt`（`retryable ?? false`）透传到
orchestrator `loop.js`，line 1542 据 `retryable !== false` 判成 `infrastructure_blocked` → 无限重试。
实证：runs f62c7e87 / d1360a48 出现 `deny:impact:mapper_stale` 空转，任务既不放行也不 block。
`structure-gate.js:124` 存在同构折叠。本 sprint 让 Gate 透传 `reason_code`，并对确定性 reason_code
走 fail-closed 出口（`retryable: false`），使 orchestrator 落到 `impact_contract_invalid` 分支 block 任务而非空转。

## Golden Path（核心场景）

系统从 [Mapper 返回带确定性 reason_code 的非 fresh freshness] → 经过 [Diff Impact Gate 透传 reason_code + 判定确定性] → 到达 [orchestrator block 任务，不再无限重试]

具体：
1. [触发条件] `evaluateDiffGate` 复算得到 `mapperResult.freshness = { status: 'stale'|'unknown', reason_code: <确定性码> }`（如 `projection_revision_mismatch`）。
2. [系统处理] Gate 步骤 3a 不再无脑返回 `mapper_stale/retryable:true`：把 `freshness.reason_code` 透传进 `reason`，并对确定性 reason_code 集合置 `retryable: false`；仅对可自愈码（如 `ttl_exceeded`）保留 `retryable: true`。
3. [可观测结果] 对确定性场景，`gateReceipt.retryable === false`，orchestrator loop.js 落 `failure_class: 'impact_contract_invalid'`，任务被 block（`deny:impact:<reason_code>`），空转终止；对可自愈场景仍返回 `mapper_stale/retryable:true` 正常重试。

## 边界情况

- `freshness.reason_code` 缺失/为 null 但 status 非 fresh → 归入 `mapper_stale` 保留 `retryable: true`（保守可自愈，不误 block）。
- `structure-gate.js` 的 `mapper_stale` 折叠须与 diff-gate 同策略修正，避免两 Gate 语义漂移。
- 确定性 reason_code 集合须与 loop.js 现有 `DETERMINISTIC_IMPACT_ERROR_CODES` 语义一致，不得放宽到把可自愈码误判确定性（否则真 stale 被误 block）。

## 范围限定

**在范围内**：
- `diff-gate.js` 步骤 3a：透传 `freshness.reason_code`、按确定性集合设 `retryable`。
- `structure-gate.js`：同构修正 `mapper_stale` 折叠。
- 确定性 freshness reason_code 判定（可新增共享常量集合）。
- diff-gate / structure-gate / harness-gates 回归测试补 failing test。

**不在范围内**：
- 不改 Mapper `/map/radius` 服务端如何产出 reason_code。
- 不改 orchestrator loop.js 的 `retryable → failure_class` 既有映射逻辑（仅依赖其现有行为）。
- 不动 revision_mismatch / manifest / projection digest 等其它已有 fail-closed 分支。

## 假设

- [ASSUMPTION: 确定性 freshness reason_code 至少含 `projection_revision_mismatch`；可自愈码含 `ttl_exceeded`。最终清单由 proposer 在 GAN 阶段读 map-client / mapper 服务端枚举后锁定。]
- [ASSUMPTION: reason_code 为 null 时视为不确定 → 可自愈 retryable:true，避免误 block。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：步骤 3a 透传 reason_code + 确定性 fail-closed。
- `packages/brain/src/impact-contract/structure-gate.js`：`buildBlockedResult('mapper_stale', ...)` 同构修正。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`：新增确定性/可自愈两类断言。
- `packages/brain/src/impact-contract/__tests__/structure-gate.test.js`：同上。
- `packages/brain/src/impact-contract/__tests__/harness-gates.test.js`：断言 receipt `retryable` 随 reason_code 分流。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task/ability 查询为空）+ PrepPRD（未显式给 NFR）；fail-closed 为 diff-gate.js 头部既有代码级约束 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 确定性 block 必须携带具体 reason_code（透传 `freshness.reason_code`），不得再以泛化 `mapper_stale` 掩盖根因

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: diff-gate.js 头部 fail-closed 原则（代码级 invariant）；decisions 表 step/feature 级查询为空 -->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked，绝不假绿；本 sprint 不得因透传 reason_code 而放行任何非 fresh 场景（来源: journey_feature/代码级）
- [不误 block] 可自愈 freshness（如 ttl_exceeded / reason_code 缺失）必须保留 retryable:true，不得因新逻辑把真 stale 误判为确定性而永久 block（来源: journey_feature）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey golden-paths 查询未返回与 impact-gate 直接相关的已验收 ability -->
- （本 line 暂无与 Diff Impact Gate 直接相关的历史累积 FR）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql/node 脚本。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（node 单测直跑 + 可选 curl localhost:5221）
# 期望验收点（自然语言）：
#  1) 注入 mapClient 返回 freshness={status:'stale', reason_code:'projection_revision_mismatch'} →
#     evaluateDiffGate 返回 gate=impact_unknown, reason='projection_revision_mismatch', retryable=false
#  2) 注入 freshness={status:'stale', reason_code:'ttl_exceeded'} →
#     evaluateDiffGate 返回 reason 透传 'ttl_exceeded'（或 mapper_stale 保留），retryable=true
#  3) 注入 freshness={status:'unknown', reason_code:null} → retryable=true（保守可自愈）
#  4) structure-gate 同三场景行为一致
#  5) harness-gates gateReceipt.retryable 随上述分流（确定性=false / 可自愈=true）
```

## journey_type: autonomous
## journey_type_reason: 全部改动落在 packages/brain/（impact-contract + orchestrator 纯后端），无 UI/agent 协议/engine 介入
## target_environment: local_api
## target_environment_reason: payload.target_environment=local_api；纯后端 Gate 逻辑，本地 evaluator 跑 node 单测 + curl localhost:5221 即可验证
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
