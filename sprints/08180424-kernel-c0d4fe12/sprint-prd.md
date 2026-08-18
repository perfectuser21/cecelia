# Sprint PRD — Diff Impact Gate 透传 Map 确定性 reason_code + fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness kernel 一类无限重试空转，回收算力）

## 背景

runs `f62c7e87` / `d1360a48` 在 `deny:impact:mapper_stale` 上空转（issue_ref）。
根因：Universal Mapper `/map/radius` 会返回两类非 fresh 结论——

- `freshness.status='stale'`（`fact_snapshot_stale` / `projection_revision_missing` 等）= **瞬态**，事实快照落后，重试会自愈；
- `freshness.status='unknown'`（`capability_not_in_active_projection` / `impact_anchor_missing` / `unsafe_assertion_ref` / `graph_projection_revision_mismatch` / `assertion_identity_ambiguous` / `capability_assertion_coverage_missing`）= **确定性结论**，结构上就判不了，重试永不自愈。

`diff-gate.js` 的 Step 3a 把这两类**折叠成同一个** `reason: 'mapper_stale', retryable: true`，丢弃了 Map 给出的 `reason_code`。loop.js 据此判 `failure_class=infrastructure_blocked` → backoff + continue → **无限重试空转**，确定性结论永远走不到 fail-closed 终止出口。

## Golden Path（核心场景）

系统在 Diff Impact Gate 复算影响半径 → Map 给出确定性 unknown 结论 → 门禁如实透传 reason_code 并 fail-closed 终止，不再空转。

具体：
1. harness run 到达 `beforeEvaluate` Diff Impact Gate，`evaluateDiffGate` 调 Mapper 复算影响半径。
2. Mapper 返回 `freshness.status='unknown'`，携带确定性 `reason_code`（如 `capability_not_in_active_projection`）。
3. Gate **不再**折叠为 `mapper_stale`：把该 `reason_code` 原样透传到 receipt（`reason`/`reason_code`），并标记 `retryable: false`。
4. loop.js 观察到 `deny:impact:capability_not_in_active_projection` + `failure_class='impact_contract_invalid'` → 走 `failRun('impact_gate_deterministic:<reason_code>')` 终止出口，run 结束为 failed，**不再 backoff 循环**。
5. 反向不变：`freshness.status='stale'`（瞬态）仍返回 `mapper_stale` + `retryable: true`，loop.js 照旧 backoff 重试（真自愈路径不受影响）。

## 边界情况

- Mapper 抛异常/不可达（`mapper_unavailable`）→ 维持现状 `retryable: true`（真瞬态，不归入本次 fail-closed）。
- `revision_mismatch` / `*_digest_mismatch` 等既有 impact_unknown 分支 → 本次不改动语义。
- `freshness.status='unknown'` 但 `reason_code` 缺失（理论不应发生）→ 仍必须 fail-closed（`retryable: false`），reason 用兜底常量，绝不假绿放行。

## 范围限定

**在范围内**：
- `diff-gate.js` Step 3a：区分 `stale`（瞬态，retryable）与 `unknown`（确定性，fail-closed），透传 Map 的 `reason_code`。
- 对应回归测试（unknown→retryable:false+reason_code 透传；stale→retryable:true 不变）。
- loop.js 层确定性 gate → 终止出口不空转的回归断言。

**不在范围内**：
- `structure-gate.js`（beforeGenerate）同类折叠——本 sprint 只做 Diff Gate（title 明确）。
- Mapper `/map/radius` 本身的 freshness 判定逻辑（不动）。
- loop.js 的 `DETERMINISTIC_IMPACT_ERROR_CODES` 集合语义（现有 impact_contract_invalid 路径已够用，仅靠 retryable=false 触发）。

## 假设

- [ASSUMPTION: 判定确定性的唯一依据是 `freshness.status==='unknown'`；`status==='stale'` 一律视为瞬态可重试。此边界与 `map/radius.js` 的 stale/unknown 语义一致。]
- [ASSUMPTION: receipt 透传无需改 harness-gates.js（其 `gateReceipt` 已 `reason: result.reason ?? result.reason_code`），仅需 diff-gate 返回正确字段。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：Step 3a 折叠点——按 `freshness.status` 分流，透传 `reason_code`，unknown 置 `retryable:false`。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`：新增 failing→green 回归（unknown 确定性 / stale 瞬态两条）。
- `packages/brain/src/orchestrator/__tests__/loop.test.js`：新增回归——确定性 impact gate 结论走终止出口而非 backoff 空转。

## E2E 验收

> Planner 初稿留占位；可执行脚本由 proposer 按 target_environment=local_api 填入（node --test / jest）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node --test 单测 + 断言）
# 期望验收点（自然语言）：
# 1. diff-gate 单测：Mapper 返回 freshness.status='unknown',reason_code='capability_not_in_active_projection'
#    → 结果 reason/reason_code='capability_not_in_active_projection' 且 retryable===false（不再是 mapper_stale）。
# 2. diff-gate 单测：Mapper 返回 freshness.status='stale',reason_code='fact_snapshot_stale'
#    → 结果 reason='mapper_stale' 且 retryable===true（瞬态语义保持不变）。
# 3. loop 回归：确定性 impact gate（retryable:false）→ exitReason='impact_gate_deterministic'，无重复 backoff hop。
# 4. 全量 npm test（brain）绿，新回归测试永久留存于 CI。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path/feature 两源均为空数组），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用现有 gate 同步判定，无新增网络往返）
- 频控: 待定（无新增）
- 版本要求: 无
- 可观测: 确定性阻断必须写入 run 审计的 `impact_gate` receipt（含真实 reason_code），并以 `impact_gate_deterministic:<reason_code>` 作为 failRun 原因

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: golden-path/feature/area 三源；step/feature 为空，area 返回项属 capture-triage 他域不适用；本段取本模块自身铁律 -->
- [fail-closed] Mapper 任何不可判定情形均 fail-closed，绝不假绿放行（来源: 模块铁律 diff-gate.js header）
- [不折叠确定性] Map 的确定性结论（unknown）不得被折叠成瞬态 mapper_stale 而进入无限重试（来源: 本 sprint 定案）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收 ability 历史；journey 现有 ability 均为 planned 状态）

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/（impact-contract + orchestrator），纯后端调度逻辑，无 UI/远端 agent 参与。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端逻辑，验收在本地 evaluator 跑 node --test（payload.target_environment 亦显式为 local_api）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
