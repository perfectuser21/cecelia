# Sprint PRD — Diff Impact Gate 透传 reason_code 并对确定性 Map 结论 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness kernel 因 mapper_stale 误判导致的空转到 deadline，提升调度可信度）

## 背景

08-15 20:08 起两条生产 run（f62c7e87 / d1360a48）同病复现：Generator 已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试到 deadline（130+/80+ 跳空转）。但 Map 本身新鲜（GET /api/brain/map?scope=cecelia 全部 snapshots fresh）。根因：`diff-gate.js:201-207` 只判 `freshness.status !== 'fresh'` 就折叠成 `mapper_stale/retryable:true`，**丢掉 reason_code**，把 radius 的**确定性**结论（`impact_anchor_missing` / `capability_assertion_coverage_missing`）当成可重试的新鲜度问题 → 永远重试不改变、人看到的永远是 mapper_stale。radius 结论本身正确，错在消费方。

## Golden Path（核心场景）

系统从 [Generator 产出本地候选] → 经过 [Diff Impact Gate 判定] → 到达 [确定性出口而非无限重试]

具体：
1. kernel 在 `spawn:evaluator` 前调用 Diff Impact Gate；mapper 在快照新鲜前提下返回**确定性**结论 `{freshness:{status:'unknown', reason_code:'impact_anchor_missing'}, unclaimed_files:[...]}` 或 `capability_assertion_coverage_missing`。
2. `diff-gate.js` 分三类判定：(a) 真新鲜度类 reason_code（fact_snapshot_stale / projection_revision_missing / projection_revision_mismatch / manifest_projection_mismatch / graph_projection_revision_mismatch）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护）；(b) 确定性结论（impact_anchor_missing / capability_assertion_coverage_missing / capability_not_in_active_projection / unsafe_assertion_ref / assertion_identity_ambiguous）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，detail 带 `unclaimed_files` 与缺覆盖 `capability_ids`；(c) 其余未知 reason_code → fail-closed `impact_unknown/mapper_contract_invalid, retryable:false`。
3. `harness-gates.js` beforeEvaluate 的 gateReceipt 透传 `reason/retryable/detail`；`loop.js`/derive 对 `retryable:false` 的 impact 结论不再按 infrastructure_blocked 退避重试，而走确定性出口：`impact_anchor_missing` → spawn:generator_fix（detail 携 unclaimed_files 清单）一次，仍失败 → wait:human_review；`capability_assertion_coverage_missing` → wait:human_review。
4. 可观测出口：orchestrator_decision_log 新增行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false` 且 `detail.impact_gate.unclaimed_files` 非空——运维可从日志直接判因，不再空转到 deadline。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- unclaimed_files 为空但 reason_code=impact_anchor_missing：仍 blocked/retryable:false，detail.unclaimed_files=[]（不因空数组回退成 mapper_stale）。
- 同一次调用命中多个确定性 reason_code：按 diff-gate 既定优先级取其一，detail 保留全部证据字段。
- radius 返回真新鲜度类 reason_code（stale 快照）：必须仍 retryable:true，绝不能被误分到 blocked（否则真 stale 无法自愈）。

## 范围限定

**在范围内**：`packages/brain` 内 diff-gate.js（三类分流）、harness-gates.js（gateReceipt 透传）、loop.js/derive（DETERMINISTIC_IMPACT_ERROR_CODES 集合 + 路由 generator_fix / human_review）；Brain semver 四处同步 + DevGate 三项。
**不在范围内**：不放宽 radius 的无主文件/断言覆盖规则（radius.js 不改，结论本身正确）；不给能力 G1 补断言（另立 Map 覆盖任务）；不复活已死 run；map-client.js assertMapperContract 不动。

## 假设

- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 不再触发 impact_anchor_missing；回归夹具用录制件复现旧行为，不依赖实时 map。]
- [ASSUMPTION: 本单合同冻结测试必须落 `sprints/08172017-kernel-37cf5c5f/tests/`（前一单 f9f943fc 因放 packages/brain/src/**/__tests__/ 被 kernel 判 force_approve_but_contract_artifacts_missing）；永久回归测试由 Generator 在实现阶段复制到 packages/brain/src/**/__tests__/。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 消费方三类分流，核心修复点（原 201-207 只判 status!=='fresh'）。
- `packages/brain/src/impact-contract/harness-gates.js`: beforeEvaluate gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/orchestrator/loop.js`: retryable:false 的 impact 结论走确定性出口，补 DETERMINISTIC_IMPACT_ERROR_CODES + derive 路由。
- `packages/brain/package.json`（+ 版本四处同步）: semver bump。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，本 task/ability/journey 均无 NFR 决策；PrepPRD 亦未指定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 无
- 版本要求: Brain semver bump 四处同步（package.json / DEFINITION.md / selfcheck EXPECTED_SCHEMA_VERSION 等）+ DevGate 三项通过
- 可观测: 确定性 impact 结论必须写 orchestrator_decision_log，gate_verdict 与 detail.impact_gate（reason_code/retryable/unclaimed_files）可从日志判因

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源查询均无本 line 铁律 -->
- （本 line 暂无历史）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey golden-paths 查询为空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=local_api 产出（curl + psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl scratch Brain 前置闸 + psql 查 orchestrator_decision_log）
# 期望验收点（自然语言）：
#  1. 对 scratch Brain POST 一条 evaluator 前置闸调用（mapper 返回 impact_anchor_missing + unclaimed_files 非空）；
#  2. psql 查 orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'；
#  3. 且 detail.impact_gate.retryable=false；
#  4. 且 detail.impact_gate.unclaimed_files 非空。
```

## journey_type: autonomous
## journey_type_reason: 改动仅落 packages/brain（diff-gate/harness-gates/loop），纯后端调度决策链，无 UI/agent 协议。
## target_environment: local_api
## target_environment_reason: 验收为数据写入类，对 scratch Brain（curl localhost:5221）触发前置闸后 psql 查 orchestrator_decision_log。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
