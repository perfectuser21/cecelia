# Sprint PRD — Diff Impact Gate 透传 reason_code 并对确定性结论 fail-closed 出口（r18）

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 kernel 无限重试黑洞，harness 可信度提升）

## 背景

08-15 20:08 起两条生产 run 同病：run f62c7e87（task 93cbbb32 OWNERS）、run d1360a48（task 0ca4b234）的 Generator 均已产出本地候选，但 `spawn:evaluator` 前的 Diff Impact Gate 持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（分别空转 130+/80+ 跳），而 Map 快照全部 fresh。根因：`radius.js` 在快照新鲜的前提下把**确定性**结论（无主文件 `impact_anchor_missing`、能力无断言覆盖 `capability_assertion_coverage_missing`）也写进 `freshness.status='unknown'`；`diff-gate.js:201-207` 只看 `status !== 'fresh'` 就一律标 `mapper_stale, retryable:true`，丢掉 `reason_code`，把不可能靠重试改变的结论标成可重试。修法：消费方（diff-gate/harness-gates/loop）区分「真新鲜度问题（可重试）」与「确定性结论（fail-closed）」，radius.js 结论本身正确、不动。

## Golden Path（核心场景）

系统从 [Generator 已出本地候选、kernel 在 spawn:evaluator 前调 Diff Impact Gate] → 经过 [按 reason_code 分类裁决 + 透传 + 确定性出口路由] → 到达 [确定性结论不再无限重试，落库可判因]

具体：
1. Diff Impact Gate 调 mapper，mapper 在快照新鲜下返回 `freshness.status='unknown'` + 确定性 `reason_code`（如 `impact_anchor_missing`，并带 `unclaimed_files`）。
2. `diff-gate.js` 按 reason_code 三类裁决：
   - (a) 真新鲜度问题（`fact_snapshot_stale`/`projection_revision_missing`/`projection_revision_mismatch`/`manifest_projection_mismatch`/`graph_projection_revision_mismatch`）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护）。
   - (b) 确定性结论（`impact_anchor_missing`/`capability_assertion_coverage_missing`/`capability_not_in_active_projection`/`unsafe_assertion_ref`/`assertion_identity_ambiguous`）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，`detail` 带 `unclaimed_files` 与缺覆盖的 `capability_ids`。
   - (c) 其余未知 reason_code → fail-closed `gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
3. `harness-gates.js` beforeEvaluate 的 gateReceipt 透传 `reason`/`retryable`/`detail`（含 unclaimed_files / 缺覆盖能力 id），写进决策日志供运维判因。
4. `loop.js`/derive 对 `retryable:false` 的 impact 结论不再按 infrastructure_blocked 退避重试，走确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 补齐上述确定性码，`failure_class=impact_contract_invalid`），按 reason 路由：`impact_anchor_missing`→`spawn:generator_fix`（携带 unclaimed_files 清单，一次；仍失败→`wait:human_review`）；`capability_assertion_coverage_missing`→`wait:human_review`。
5. 出口：kernel 对确定性结论零重试；`orchestrator_decision_log` 落一行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`、`detail.impact_gate.unclaimed_files` 非空。

## 边界情况

- mapper 不可达（抛异常）→ 维持既有 `mapper_unavailable, retryable:true`，不受本次改动影响。
- 真新鲜度 stale（如 `fact_snapshot_stale`）与确定性 unknown 混合时：radius 已"保留更靠近事实快照边界的失败原因"，diff-gate 先判 stale 码归 (a)，不误入 (b)。
- 未来 radius 新增确定性 reason_code 而未登记 → 落 (c) fail-closed，不再假装可重试（默认安全）。
- generator_fix 修候选（删/挪无主文件）后仍 `impact_anchor_missing` → 升级 human_review，不循环。

## 范围限定

**在范围内**：`packages/brain/src/impact-contract/diff-gate.js`、`packages/brain/src/impact-contract/harness-gates.js`、`packages/brain/src/orchestrator/loop.js`（及 derive 路由）的 reason_code 分类/透传/出口逻辑；Brain semver 四处同步 + DevGate 三项。
**不在范围内**：不放宽 radius 的无主文件/断言覆盖规则；`radius.js` 与 `map-client.js assertMapperContract` 不动；不给能力 G1 补断言（另立 Map 覆盖任务）；不复活已死 run。

## 假设

- [ASSUMPTION: thin_prd 为空，任务 description 即产品意图，主题字面 = "Diff Impact Gate 透传 reason_code + fail-closed 出口"。]
- [ASSUMPTION: 合同冻结测试（contract-draft/dod/task-plan/fixtures）必须落在 `sprints/08180147-kernel-03703a2e/tests/`，不得放 `packages/brain/src/**/__tests__/`——r2 实证：放错位置 kernel 采集不到冻结产物 → force_approve_but_contract_artifacts_missing 终态；永久回归测试由 Generator 实现阶段复制进 `packages/brain/src/**/__tests__/`。]
- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 `DoD.md`），线上不再因 DoD.md 触发 impact_anchor_missing；回归夹具用 run d1360a48 真实 changed_files + 真实 radius 响应**录制件**复现，不依赖线上 Map 现态。]
- [ASSUMPTION: reason→出口映射固定为 impact_anchor_missing→generator_fix→(升级)human_review；capability_assertion_coverage_missing→human_review。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：201-207 分类裁决三类分支 + detail 透传。
- `packages/brain/src/impact-contract/harness-gates.js`：beforeEvaluate gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/orchestrator/loop.js`：DETERMINISTIC_IMPACT_ERROR_CODES 补集 + retryable:false 走确定性出口 + derive 路由。
- `packages/brain/package.json`（及 selfcheck/DEFINITION/version-sync 四处）：semver bump。
- `sprints/08180147-kernel-03703a2e/tests/`：合同冻结单测（diff-gate 三态、harness-gates 透传、loop/derive 路由、d1360a48 回归夹具）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 双源均空；下列为 PrepPRD 显式约束 -->
- 重试语义: 确定性结论零重试（不再消耗 deadline）；仅真新鲜度问题保留 90s 重试。
- Fail-closed: 未知 reason_code 一律 retryable:false，禁止乐观放行/无限重试。
- 可观测: 闸决策必须把 reason_code / unclaimed_files / 缺覆盖 capability_ids 写进 `orchestrator_decision_log`，运维可从日志判因。
- 超时/频控/版本要求: 待定（PrepPRD 未指定）。

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl scratch Brain + psql orchestrator_decision_log）。

```bash
# 占位：proposer 按 local_api 填真实脚本（对 scratch Brain POST 一条 evaluator 前置闸调用 + psql 查落库行）
# 期望验收点（自然语言）：
#   1. 对 scratch Brain POST 一条 evaluator 前置 Diff Impact Gate 调用（mapper 返回 impact_anchor_missing + unclaimed_files）。
#   2. psql 查 orchestrator_decision_log 新增行：gate_verdict='deny:impact:impact_anchor_missing'
#      且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空。
#   3. 确认 kernel 不再对该结论排新一轮重试（下一动作为 generator_fix / human_review，非退避重试）。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 两源本 sprint 为空）。area 级 capture-triage 学习账本较大，此处仅注入本 sprint 直接相关铁律，其余账本条目对本 kernel 改动无约束力。 -->
- [Kernel 时钟] Kernel existing PR evaluator validation clock adoption：evaluator 校验时钟按既有约定采用（来源: area）
- [重试身份] generator_infrastructure_retry_identity：基础设施重试须保持重试身份不漂移（来源: area）
- [planner 分支] planner_role_branch：planner 用服务端签发的 role 分支，禁止自行 checkout 漂移（来源: area）
- [判变基准] 判变基准永远用生产实体自报对账 origin/main，禁凭记忆/固定值（来源: area）
- [失败契约] 调用"失败返回 null/false"契约的函数写完成功分支必须显式 else 兜底（来源: area）
- [真环境验证] 真环境验证才算 done；[多租户] 测试默认多租户；[租户隔离] 记忆/数据按租户隔离（来源: area 系统级）
- [凭据安全] 凭据不入 git；[日志脱敏] 日志脱敏；[端点鉴权] 端点鉴权；[禁写死环境] 禁止写死环境假设值（来源: area 系统级）
- [单 slot 串行] 单 slot 串行任务，并行只许跨 slot（来源: area 系统级）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无已验收历史；journey 内 ability 均为 planned 态）

## journey_type: autonomous
## journey_type_reason: 改动全部落在 packages/brain/（纯后端 kernel/impact-contract/orchestrator），无 UI/远端 agent/engine 路径。
## target_environment: local_api
## target_environment_reason: 验收为 curl scratch Brain + psql 查 orchestrator_decision_log，本地 evaluator 执行（localhost:5221）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
