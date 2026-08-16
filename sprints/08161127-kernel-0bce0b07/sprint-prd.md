# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 出口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类 kernel 无限重试到 deadline 的空转，提升 harness 可信度）

## 背景

08-15 20:08 起两条生产 run（f62c7e87 / d1360a48）同病：Generator 已产出本地候选，但 `spawn:evaluator` 前的 Diff Impact Gate 持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（分别空转 130+/80+ 跳），而 Map 本身新鲜（GET /api/brain/map?scope=cecelia 全部 snapshots fresh，manifest v3）。根因：`diff-gate.js` 只判 `freshness.status !== 'fresh'` 就折叠成 `mapper_stale/retryable:true`，丢掉了 mapper 返回的**确定性** `reason_code`（如 `impact_anchor_missing` / `capability_assertion_coverage_missing`），把不可能靠重试改变的结论标成可重试。本 sprint 让消费方（diff-gate/harness-gates/loop）忠实区分「真新鲜度问题（可重试）」与「确定性结论（fail-closed，走既有确定性出口）」，radius.js 结论本身正确不动。

> 【r2 硬要求·必读】前一单 f9f943fc（run 3cd1072a）合同齐备，但把冻结测试放到 `packages/brain/src/**/__tests__/` 而非 `sprints/<sprint_dir>/tests/`，kernel 采集不到冻结产物 → 终态 `force_approve_but_contract_artifacts_missing`。**本单合同冻结测试必须落在 `sprints/08161127-kernel-0bce0b07/tests/`**；永久回归测试由 Generator 实现阶段复制到 `packages/brain/src/**/__tests__/`。

## Golden Path（核心场景）

系统从 [Generator 已产出候选、进入 evaluator 前置 Diff Impact Gate] → 经过 [gate 按 mapper 返回的 reason_code 分类判定] → 到达 [确定性结论 fail-closed 出口，不再无限重试；真新鲜度问题仍可重试]

具体：
1. [触发] beforeEvaluate 调 Diff Impact Gate，mapper（radius.js）返回 `freshness.status` 与 `reason_code`（含 `unclaimed_files` / 缺覆盖 capability_ids）。
2. [系统处理] diff-gate.js 三分类：
   - (a) **真新鲜度问题**（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护）。
   - (b) **确定性结论**（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，并把 `unclaimed_files` 与缺覆盖 `capability_ids` 放进 `detail`。
   - (c) **其余未知 reason_code** → fail-closed `gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
3. [可观测结果]
   - harness-gates.js beforeEvaluate 的 gateReceipt 透传 `reason/retryable/detail`。
   - loop.js 对 `retryable:false` 的 impact 结论不再按 `infrastructure_blocked` 退避重试，而走既有确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 补齐上述 reason，`failure_class=impact_contract_invalid`），由 derive 路由：`impact_anchor_missing` → `spawn:generator_fix`（detail 携 `unclaimed_files` 清单）一次，仍失败→ `wait:human_review`；`capability_assertion_coverage_missing` → `wait:human_review`。
   - orchestrator_decision_log 落一行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.unclaimed_files` 非空。

## 边界情况

- mapper 返回 `freshness` 缺失或非 object → 归 (c) fail-closed `mapper_contract_invalid, retryable:false`。
- `unclaimed_files` 为空数组但 reason 是 `impact_anchor_missing` → 仍 blocked，detail.unclaimed_files 为空数组（generator_fix 无可修目标时下一轮转 human_review）。
- 真新鲜度问题与确定性结论同时出现时，以 mapper 返回的顶层 reason_code 为准分类（radius.js 语义：确定性结论只在快照 fresh 前提下写入）。

## 范围限定

**在范围内**：`packages/brain/src/impact-contract/diff-gate.js`（三分类）、`harness-gates.js`（gateReceipt 透传）、`packages/brain/src/orchestrator/loop.js`（DETERMINISTIC_IMPACT_ERROR_CODES + derive 路由）；Brain semver 四处同步 + DevGate 三项。
**不在范围内**：不放宽 radius.js 无主文件/断言覆盖规则（radius.js/map-client.js `assertMapperContract` 不动）；不给 G1 补断言（另立 Map 覆盖任务）；不复活已死 run。

## 假设

- [ASSUMPTION: `DETERMINISTIC_IMPACT_ERROR_CODES` 集合已存在于 loop.js（或就近模块），本 sprint 只向其补入上述 reason；若不存在则新建同名集合并接入 derive。]
- [ASSUMPTION: derive 已有 `spawn:generator_fix` 与 `wait:human_review` 两个出口动作，本 sprint 只按 reason 二选一路由，不新增动作类型。]
- [ASSUMPTION: Map manifest 已升 v3、仓库根 DoD.md 已被 F1 认领，故 DoD.md 不再触发 impact_anchor_missing；本 sprint 逻辑用 mock/录制件验证，不依赖真实 DoD.md 触发。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 三分类核心逻辑（区分可重试 vs fail-closed，透传 reason_code + detail）。
- `packages/brain/src/impact-contract/harness-gates.js`: beforeEvaluate gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/orchestrator/loop.js`: DETERMINISTIC_IMPACT_ERROR_CODES 补 reason + derive 路由（generator_fix / human_review）。
- `packages/brain/package.json` 等四处: semver bump 同步。
- `sprints/08161127-kernel-0bce0b07/tests/`: 合同冻结测试（r2 硬要求落点）。
- `packages/brain/src/**/__tests__/`: Generator 实现阶段复制的永久回归测试。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 双源均空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；不改 kernel 90s 重试节奏本身，只改「是否重试」的判定）
- 频控: 无
- 版本要求: Brain semver bump 四处同步（package.json / DEFINITION.md / selfcheck EXPECTED_SCHEMA_VERSION 等）
- 可观测: 确定性 blocked 结论必须写入 orchestrator_decision_log，含 gate_verdict + detail.impact_gate.retryable + unclaimed_files

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [fail-closed] 未知/不可判定的 mapper 结论一律 fail-closed，禁止标成可重试导致无限空转（来源: 本 sprint 根因，写入合同铁律）
- [不改产方] radius.js / map-client.js assertMapperContract 结论正确，禁止在消费方修复中放宽或改动产方规则（来源: PrepPRD 不做项）
- [nightly-red 原始日志] 连续 ≥3 晚同一 job 红时 issue 贴失败 step 最后 20 行原始 stdout（非 PowerShell 截断）（来源: area，本 sprint 不直接相关，铁律留痕）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl scratch Brain + psql 查 orchestrator_decision_log）
# 期望验收点（自然语言）：
# 1. 对 scratch Brain POST 一条 evaluator 前置闸调用（mapper 返回 impact_anchor_missing + unclaimed_files）
# 2. psql 查 orchestrator_decision_log 新增行：gate_verdict='deny:impact:impact_anchor_missing'
#    且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空
# 3. 回归：mapper 返回 fact_snapshot_stale → 仍 deny:impact:mapper_stale 语义（impact_unknown/retryable=true），不被误判为 blocked
```

## journey_type: autonomous
## journey_type_reason: 全部改动在 packages/brain 纯后端（diff-gate/harness-gates/loop），无 UI、无远端 agent 协议、非 engine hooks/skills。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；Brain 内部逻辑，E2E 走本地 curl localhost:5221 + psql 查 orchestrator_decision_log。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
