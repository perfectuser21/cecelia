# Sprint PRD — Diff Impact Gate 把确定性 Map 结论透传 reason_code 并 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类 kernel 空转到 deadline 的假 mapper_stale 无限重试）

## 背景

08-15 20:08 起两条生产 run 同病：run f62c7e87（task 93cbbb32）与 run d1360a48（task 0ca4b234）的 Generator 都已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 却持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（分别空转 130+/80+ 跳）。而 Map 本身新鲜（`GET /api/brain/map?scope=cecelia` 全部 snapshots fresh）。根因：`diff-gate.js:201-207` 只判 `freshness.status !== 'fresh'` 就返回 `mapper_stale`，丢掉 radius 给出的**确定性** `reason_code`（`impact_anchor_missing` / `capability_assertion_coverage_missing`），把不可能靠重试改变的结论标成可重试。issue_ref: runs f62c7e87/d1360a48 deny:impact:mapper_stale 空转。

## Golden Path（核心场景）

系统（kernel/orchestrator）从 [Generator 产出候选] → 经过 [Diff Impact Gate 分类判定] → 到达 [确定性结论走 fail-closed 出口，不再无限重试]。

具体：
1. Generator 产出本地候选后，kernel 在 `spawn:evaluator` 前触发 `harness-gates.beforeEvaluate` 调用 Diff Impact Gate。
2. Gate 调 mapper（`radius.resolveImpactRadius`）拿到 `freshness{status, reason_code}` + `unclaimed_files` + 受影响 `capability_ids`。
3. `diff-gate.js` 按 `reason_code` 三分类：
   - **(a) 真新鲜度**（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护）。
   - **(b) 确定性结论**（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，且 `detail` 带 `unclaimed_files` 与缺覆盖的 `capability_ids`。
   - **(c) 其余未知 reason_code**→ fail-closed `gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
4. `harness-gates.beforeEvaluate` 的 gateReceipt 透传 `reason` / `retryable` / `detail`（含 `unclaimed_files` / 缺覆盖 capability_ids）。
5. `loop.js` 对 `retryable:false` 的 impact 结论不再按 `infrastructure_blocked` 退避重试；`DETERMINISTIC_IMPACT_ERROR_CODES` 补入上述确定性 reason，`failure_class=impact_contract_invalid`，交 `derive` 路由。
6. `derive`：`reason=impact_anchor_missing` → 下一动作 `spawn:generator_fix`（detail 携带 `unclaimed_files` 清单）一次，仍失败 → `wait:human_review`；`reason=capability_assertion_coverage_missing` → 直接 `wait:human_review`。

可观测出口：`orchestrator_decision_log` 新增行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.unclaimed_files` 非空；kernel 不再 90s 无限重试到 deadline。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- mapper 返回 `freshness.status:'fresh'` 但整体正常 → Gate 放行（PASS），行为不变。
- 同一候选同时命中多个确定性 reason_code → 取 mapper 返回的首要 reason_code（radius 语义），detail 汇总全部证据。
- `unclaimed_files` 为空数组但 reason=`impact_anchor_missing` → 仍 blocked/retryable:false，detail.unclaimed_files=[]（不因空数组回退成 mapper_stale）。
- 未知/新增 reason_code（未在 (a)(b) 枚举内）→ 必须 fail-closed，禁止默认放行或默认可重试。

## 范围限定

**在范围内**：`packages/brain/src/impact-contract/diff-gate.js`（三分类）、`harness-gates.js`（gateReceipt 透传）、`orchestrator/loop.js`（DETERMINISTIC set + failure_class）、`orchestrator/derive.js`（reason→动作路由）。
**不在范围内**：不放宽 radius 的无主文件/断言覆盖规则；不给能力 G1 补断言（另立 Map 覆盖任务）；不复活已死 run；`map-client.js` `assertMapperContract` 与 `radius.js` 不改（结论本身正确，错在消费方）。

## 假设

- [ASSUMPTION: radius.js 已在 freshness 上返回 `reason_code` 字段（task 根因所述 radius.js:381-397 / 81-90），本 sprint 直接消费不修改。]
- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 不再触发 impact_anchor_missing；回归夹具用 d1360a48 录制件复现旧路径而非依赖当前 manifest。]
- [ASSUMPTION: 合同冻结测试放 `sprints/08161913-kernel-8f826ee6/tests/`（kernel 冻结产物采集只认此路径）；永久回归测试由 Generator 复制到 `packages/brain/src/**/__tests__/`。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：三分类判定，透传 reason_code + detail（当前 201-207 只判 status）。
- `packages/brain/src/impact-contract/harness-gates.js`：beforeEvaluate gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/orchestrator/loop.js`：`DETERMINISTIC_IMPACT_ERROR_CODES`(:84) 补确定性 reason，failure_class=impact_contract_invalid。
- `packages/brain/src/orchestrator/derive.js`：reason→spawn:generator_fix / wait:human_review 路由。
- `packages/brain/package.json` + 版本四处同步（semver bump）。
- `sprints/08161913-kernel-8f826ee6/tests/`：合同冻结测试（单测 + d1360a48 回归夹具）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 双源均空（step/feature 皆 []）；以下为 PrepPRD 隐含可靠性约束 -->
- 超时/延迟: 待定（PrepPRD 未指定；kernel 重试节流 90s 保持不变）
- 可靠性（fail-closed）: 未知 reason_code 必须 fail-closed（retryable:false），禁止默认放行或默认可重试
- 可观测: 确定性拦截必须写 `orchestrator_decision_log`，detail 带 reason_code / retryable / unclaimed_files / capability_ids，供运维从日志判因
- Brain 门禁: semver bump 四处同步 + DevGate 三项（facts-check / check-version-sync / check-dod-mapping）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: step/feature 级 invariant 均空（ability_id 未挂）；area 级 88 条为 capture-triage CI 学习条，与本 Brain diff-gate 变更无治理关系，不逐条注入；本段列本 sprint 强制铁律（含 task「不做」）+ harness 命名铁律 -->
- [planner分支] Planner 只在服务端签发的 PLANNER_BRANCH 上作业，禁自行 checkout/switch（来源: area/planner_role_branch）
- [不放宽radius] 不放宽 radius 的无主文件/断言覆盖规则（来源: 本 sprint 不做）
- [不补断言] 不给能力 G1 补断言，Map 覆盖缺口另立任务（来源: 本 sprint 不做）
- [不动生产方] map-client.js assertMapperContract 与 radius.js 不改，只改消费方（来源: 本 sprint 不做）
- [fail-closed] 未知 reason_code 必须 fail-closed retryable:false，禁默认放行（来源: 本 sprint 可靠性铁律）
- [冻结产物路径] 合同冻结测试必须落 sprints/<sprint_dir>/tests/，否则 kernel 采集不到 → force_approve_but_contract_artifacts_missing（来源: r2 说明历史约束）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths 查询返回空（本 line 暂无已 done/working ability） -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将填入 local_api 真实脚本（curl localhost:522x scratch Brain 前置闸调用 + psql 查 orchestrator_decision_log）
# 期望验收点（自然语言）：
#  1) 单测 diff-gate：mock mapper 返回 {freshness:{status:'unknown',reason_code:'impact_anchor_missing'}, unclaimed_files:['DoD.md']}
#     → gate='blocked'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files=['DoD.md']；
#     返回 capability_assertion_coverage_missing → reason 同名、retryable=false；
#     返回 {status:'stale',reason_code:'fact_snapshot_stale'} → 仍 impact_unknown/mapper_stale/retryable=true（回归保护）。
#  2) 单测 harness-gates.beforeEvaluate：blocked 结果 gateReceipt 含 reason/retryable/detail。
#  3) 单测 loop.js/derive：impact 闸 retryable=false + reason=impact_anchor_missing → 下一动作 spawn:generator_fix（detail 带 unclaimed_files），非退避重试；reason=capability_assertion_coverage_missing → wait:human_review。
#  4) 回归夹具：用 run d1360a48 真实 changed_files（含 DoD.md）+ 真实 radius 录制件，旧代码=mapper_stale、新代码=blocked:impact_anchor_missing。
#  5) Final E2E（scratch 库）：对 scratch Brain POST 一条 evaluator 前置闸调用 → psql 查 orchestrator_decision_log 新增行
#     gate_verdict='deny:impact:impact_anchor_missing' 且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空。
```

## journey_type: autonomous
## journey_type_reason: 变更全在 packages/brain/（kernel/orchestrator 后端逻辑），无 UI、无远端 agent 协议、无 engine hooks，命中 brain→autonomous。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端 diff-gate/loop/derive 修复，E2E 走本地 evaluator（curl localhost:522x scratch Brain + psql 查 orchestrator_decision_log），payload 亦显式指定 local_api。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
