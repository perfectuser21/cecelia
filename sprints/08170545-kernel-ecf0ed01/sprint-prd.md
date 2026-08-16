# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 出口（r10）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类会把 run 空转到 deadline 的确定性误重试）

## 背景

08-15 20:08 起两条生产 run 同病：run f62c7e87（task 93cbbb32）与 run d1360a48（task 0ca4b234）的 Generator 均已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 却持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（130+/80+ 跳空转）。而 Map 本身新鲜（GET /api/brain/map?scope=cecelia 全部 snapshots fresh）。根因：`radius.js` 在快照新鲜时把**确定性**结论（`impact_anchor_missing` / `capability_assertion_coverage_missing`）也写进 freshness.status='unknown'，`diff-gate.js` 只判 `status!=='fresh'` 就折叠成 `mapper_stale, retryable:true` 并**丢掉 reason_code**，使不可能靠重试改变的结论被无限重试。

## Golden Path（核心场景）

系统从 [Generator 已产候选，kernel 调 Diff Impact Gate] → 经过 [gate 按 reason_code 三分类 + 确定性出口] → 到达 [orchestrator_decision_log 记录确定性 verdict，kernel 走 generator-fix 或 human_review，不再无限重试]

具体：
1. mapper 返回 `{freshness:{status:'unknown', reason_code:'impact_anchor_missing'}, unclaimed_files:['DoD.md']}`（候选含 Map 无主文件）。
2. diff-gate.js 识别该 reason_code 属**确定性结论**类，返回 `gate:'blocked'`、`reason:'impact_anchor_missing'`、`retryable:false`，并把 `unclaimed_files` / 缺覆盖 capability_ids 放进 result.detail。
3. harness-gates.js beforeEvaluate 的 gateReceipt 透传 `reason/retryable/detail`；loop.js/derive 对 `retryable:false` 的 impact 结论不再按 infrastructure_blocked 退避，而是走确定性出口（failure_class=impact_contract_invalid）：`impact_anchor_missing`→`spawn:generator_fix`（携 unclaimed_files 清单，一次；仍失败→human_review），`capability_assertion_coverage_missing`→`wait:human_review`。
4. 可观测结果：orchestrator_decision_log 新增行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false` 且 `detail.impact_gate.unclaimed_files` 非空。

三分类边界（diff-gate.js）：
- (a) 真新鲜度问题（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `impact_unknown/mapper_stale, retryable:true`（回归保护）。
- (b) 确定性结论（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked'`, `reason:<原 reason_code>`, `retryable:false`，detail 带 unclaimed_files / capability_ids。
- (c) 其余未知 reason_code → fail-closed `impact_unknown/mapper_contract_invalid, retryable:false`。

## 边界情况

- 未知/新增 reason_code：必须 fail-closed（retryable:false），不得静默当新鲜度问题重试。
- `impact_anchor_missing` 走 generator-fix 一次后仍失败 → 兜底到 human_review，避免 fix↔gate 死循环。
- radius.js 结论本身正确（无主文件/断言覆盖规则不放宽），只改消费方 diff-gate.js / loop.js / derive。

## 范围限定

**在范围内**：`packages/brain/src/impact-contract/diff-gate.js`（三分类 + 透传 reason_code/detail）、`packages/brain/src/harness-gates.js`（beforeEvaluate gateReceipt 透传）、loop.js/derive（retryable:false 确定性出口 + DETERMINISTIC_IMPACT_ERROR_CODES 补集 + 路由到 generator_fix / human_review）、Brain semver 四处同步 + DevGate 三项。
**不在范围内**：不放宽 radius.js 的无主文件/断言覆盖规则（radius.js 不改）；不给能力 G1 补断言（另立 Map 覆盖任务）；不复活已死 run；map-client.js assertMapperContract 不动。

## 假设

- [ASSUMPTION: DETERMINISTIC_IMPACT_ERROR_CODES 集合与 derive 路由已存在于 loop.js/derive，本次为补齐 reason 集合与分支，而非新建路由框架。]
- [ASSUMPTION: gateReceipt 结构已支持 detail 透传，仅需补 reason/retryable/detail 字段。]
- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 不再触发 impact_anchor_missing；回归夹具仍用 run d1360a48 录制件复现旧/新对比。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 新增 reason_code 三分类与确定性出口，透传 unclaimed_files/capability_ids 进 detail。
- `packages/brain/src/harness-gates.js`: beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/loop.js`（及 derive 决策）: DETERMINISTIC_IMPACT_ERROR_CODES 补集，retryable:false 的 impact 结论路由到 generator_fix / wait:human_review，不再退避重试。
- `packages/brain/package.json` 等 semver 四处：版本 bump 同步。

## 合同产物落位（r2 硬要求）

- Proposer 的合同冻结测试文件**必须**放在 `sprints/08170545-kernel-ecf0ed01/tests/`，**禁止**放 `packages/brain/src/**/__tests__/`（前一单 f9f943fc 因放错目录导致 kernel 采集失败、run 以 `force_approve_but_contract_artifacts_missing` 终态）。可原样复用上一单合同/测试内容。
- 永久回归测试由 Generator 在实现阶段复制到 `packages/brain/src/**/__tests__/` 常驻 CI。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 按 local_api 填 curl + psql 脚本
# 期望验收点（自然语言）：对 scratch Brain POST 一条 evaluator 前置闸调用（候选含 Map 无主文件），
# psql 查 orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'
# 且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）+ PrepPRD 显式约束 -->
- 超时/延迟: 待定（PrepPRD 未指定；现状 kernel 每 90s 重试为待消除的错误行为，非目标 NFR）
- 频控: 无
- 版本要求: 无
- 可观测: gate 确定性 verdict 必须透传 reason/retryable/detail 进 orchestrator_decision_log（来源: PrepPRD 修法 B/验收）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature/journey_feature 三源均空，ability_id=null）-->
- [重试身份] Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator-fix（来源: area）
- [planner分支] Planner workspace 必须停在服务端签发的 planner_branch，Provider 可校验但禁止 checkout/switch（来源: area）
- [BrainURL权威] Dispatcher 与 Fleet Worker 必须同时注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁止为单 Attempt 手工绕过（来源: area）
- [评估时钟] Kernel existing PR evaluator 采用既有 PR 校验时钟，不重置（来源: area）
<!-- area 级另有 capture-triage/android nightly 学习条目若干，与本 kernel gate line 无关，略 -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无 done/working 历史；journey e6f803f2 现有 ability 均为 planned）

## journey_type: autonomous
## journey_type_reason: 全部改动落在 packages/brain/src/（diff-gate/harness-gates/loop/derive），纯后端 kernel 决策逻辑，无 UI / 远端 agent / engine 触及。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；Final E2E 为数据写入类，走本地 evaluator curl scratch Brain + psql 查 orchestrator_decision_log。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
