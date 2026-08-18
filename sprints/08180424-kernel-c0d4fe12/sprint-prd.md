# Sprint PRD — Diff Impact Gate 透传 reason_code 并对确定性结论 fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness kernel 一类无限重试空转，提升调度可信度）

## 背景

runs f62c7e87 / d1360a48 在 `deny:impact:mapper_stale` 上无限空转。根因：`packages/brain/src/impact-contract/diff-gate.js` 步骤 3a 把 Mapper 返回的**任何** `freshness.status !== 'fresh'` 一律折叠成 `reason:'mapper_stale' + retryable:true`。即使 Map 已给出**确定性**结论（`freshness.reason_code` 明确指向不会因重试而改变的终态，如 `no_anchor` / `revision_mismatch` / `manifest_projection_mismatch`），Gate 仍丢弃真实 `reason_code` 并标记可重试，导致 orchestrator 无限重跑而非终止。本 sprint 让 Gate 透传 Map 的 `reason_code`，并对确定性结论给出 fail-closed（不可重试）出口。

## Golden Path（核心场景）

系统从 [Gate 复算影响半径] → 经过 [判定 Mapper freshness 与 reason_code] → 到达 [终态裁决可观测]

具体：
1. [触发] harness 任务进入 Diff Impact Gate，`evaluateDiffGate` 调用 Mapper 复算，Mapper 返回 `freshness.status !== 'fresh'` 且携带确定性 `reason_code`（如 `no_anchor`）
2. [系统处理] Gate 不再一律折叠为 `mapper_stale`：把 `mapperResult.freshness.reason_code` 原样透传进返回体；当该 reason_code 属于确定性终态时，返回 `retryable:false`（fail-closed 出口），不再进入重试循环
3. [可观测结果] Gate 返回 `{gate:'impact_unknown', reason_code:'<Map 原因>', retryable:false}`；orchestrator 据 `retryable:false` 终止空转、走 deny/block 收尾，而非无限重跑；真实原因可在返回体与日志中读到

## 边界情况

- Mapper 返回 `freshness` 但 `reason_code` 为 null/缺失 → 保持原有 `mapper_stale` 语义且 `retryable:true`（暂态，可重试），不误判为终态
- Mapper 返回的是暂态原因（如 `map_unavailable` / `resolver_error` / `fact_stale`）→ 仍 `retryable:true`，允许重试，不被误判为 fail-closed
- Mapper 不可达（抛异常）→ 维持既有 `mapper_unavailable` + `retryable:true` 出口，不受本次改动影响

## 范围限定

**在范围内**：`diff-gate.js` 步骤 3a（`mapper_stale` 分支）的 reason_code 透传与确定性终态的 `retryable` 判定；对应回归测试。
**不在范围内**：state-resolver / map-client 的 reason_code 生成逻辑；revision/digest mismatch 分支（3b）行为改写；orchestrator 消费侧的重试策略重构（仅依赖 `retryable` 语义，不改其循环骨架）。

## 假设

- [ASSUMPTION: 「确定性结论」= `freshness.reason_code` 属于不会因重试自愈的终态集合（如 `no_anchor`/`anchor_missing`/`revision_mismatch`/`manifest_projection_mismatch`/`fail_current_revision`）；暂态集合（`map_unavailable`/`resolver_error`/`fact_stale`/`fact_snapshot_stale`）仍保持 `retryable:true`。确定/暂态两集合的最终归类由 Proposer 依 state-resolver 现有枚举在合同阶段锁死。]
- [ASSUMPTION: orchestrator 已按 `retryable` 字段决定是否重试，本 sprint 仅需保证 Gate 出口语义正确即可止住空转。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 步骤 3a `mapper_stale` 分支透传 `reason_code` + 确定性终态置 `retryable:false`
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增 failing→PASS 回归（确定性结论透传 reason_code 且不可重试；暂态仍可重试）

## NFR 约束

<!-- 来源: golden-path/feature decisions category=nfr 均为空数组；下列为本 Gate 既有设计红线 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 可观测: Gate 每次终态裁决必须携带可读的 `reason_code`，禁止把确定性原因抹成通用 `mapper_stale`

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: step/feature invariant 为空；下列为 diff-gate.js 头部声明的既有设计铁律 -->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿放行（来源: diff-gate 设计原则）
- [不无限空转] 确定性终态必须 `retryable:false`，不得让 orchestrator 无限重试（来源: 本 sprint 根因 r19）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 journey 已完成 ability 的 golden_path；查询返回空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=local_api 产出（node 测试 / curl+psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api）
# 期望验收点（自然语言）：
# 1) 构造 mapClient 返回 freshness.status='stale'、reason_code='no_anchor'（确定性终态），
#    evaluateDiffGate 返回 reason_code='no_anchor' 且 retryable=false（fail-closed，非 mapper_stale/可重试）
# 2) 构造 reason_code=null 或暂态原因（如 map_unavailable），仍返回 retryable=true（保留重试）
# 3) 回归测试永久留在 CI：证明 f62c7e87/d1360a48 类空转不再复现
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/ 的 impact-contract Gate（纯后端 kernel 逻辑），无 UI/agent 协议/engine 参与
## target_environment: local_api
## target_environment_reason: payload.target_environment 显式为 local_api；验收在本地 evaluator 跑 node 测试 + curl localhost:5221 即可
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
