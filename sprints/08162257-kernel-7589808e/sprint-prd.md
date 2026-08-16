# Sprint PRD — Diff Impact Gate 透传 reason_code 并 fail-closed，终结确定性 Map 结论被折叠成 mapper_stale 的无限重试

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 / KR1（系统稳定 — 自愈成功率≥90%，MTTR<30min）
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类 kernel 空转到 deadline 的自愈失效）

## 背景

08-15 20:08 起两条生产 run 同病并已实测复现：run f62c7e87（task 93cbbb32）与 run d1360a48（task 0ca4b234）的 Generator 均已产出本地候选，但 `spawn:evaluator` 前的 Diff Impact Gate 持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（分别空转 130+/80+ 跳）。而 Map 本身新鲜（`GET /api/brain/map?scope=cecelia` 全 snapshots fresh，fact_revisions=bc4e8644=origin/main，10 分钟一扫）。根因：`radius.js` 在快照新鲜前提下把**确定性**结论（无主文件 `impact_anchor_missing`、能力零断言 `capability_assertion_coverage_missing`）也写进 freshness；`diff-gate.js:201-207` 只看 `freshness.status!=='fresh'` 就返回 `mapper_stale/retryable:true`，丢掉 reason_code，把不可能靠重试改变的确定性结论标成可重试。关联 issue：runs f62c7e87/d1360a48 空转。

## Golden Path（核心场景）

系统从 [Generator 已出候选] → 经过 [beforeEvaluate 的 Diff Impact Gate] → 到达 [按 reason_code 走确定性出口，不再无限重试]

具体：
1. 触发：kernel 在 `spawn:evaluator` 前调用 Diff Impact Gate，mapper 在快照新鲜下返回确定性结论 `{freshness:{status:'unknown', reason_code:'impact_anchor_missing'}, unclaimed_files:['DoD.md']}`（或 `capability_assertion_coverage_missing` + 缺覆盖 capability_ids）。
2. 系统处理：`diff-gate.js` 区分三类——(a) 真新鲜度问题（`fact_snapshot_stale`/`projection_revision_missing`/`projection_revision_mismatch`/`manifest_projection_mismatch`/`graph_projection_revision_mismatch`）→ 维持 `impact_unknown/mapper_stale, retryable:true`；(b) 确定性结论（`impact_anchor_missing`/`capability_assertion_coverage_missing`/`capability_not_in_active_projection`/`unsafe_assertion_ref`/`assertion_identity_ambiguous`）→ `gate:'blocked'`、`reason:<原 reason_code>`、`retryable:false`，并把 `unclaimed_files` 与缺覆盖 capability_ids 放进结果 `detail`；(c) 其余未知 reason_code → fail-closed `impact_unknown/mapper_contract_invalid, retryable:false`。
3. 可观测结果：`harness-gates.js` beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail；`loop.js` 对 `retryable:false` 的 impact 结论不再按 `infrastructure_blocked` 退避重试，而经 `DETERMINISTIC_IMPACT_ERROR_CODES`（failure_class=`impact_contract_invalid`）由 derive 路由：`impact_anchor_missing` → `spawn:generator_fix` 一次（携带 `unclaimed_files` 清单），仍失败 → `wait:human_review`；`capability_assertion_coverage_missing` → 直接 `wait:human_review`。orchestrator_decision_log 落一行 `gate_verdict='deny:impact:<reason>'`，`detail.impact_gate.retryable=false`。

<!-- Response Schema（gate 结果字段/枚举）由 Proposer 在 Step 1.1 从 diff-gate/loop 实现推导并写入合同，Planner 不定义技术规范。 -->

## 边界情况

- 新鲜度真问题与确定性结论**同时**出现：新鲜度优先，仍 retryable:true（新鲜度修复后确定性结论可能自然消失）。
- 未知/新增 reason_code：走 (c) fail-closed，禁止默认 retryable:true。
- `impact_anchor_missing` 的 generator_fix 已重试过一次仍失败：升级 human_review，不得二次重试。

## 范围限定

**在范围内**：`packages/brain/src/impact-contract/diff-gate.js`、`packages/brain/src/harness-gates.js`（beforeEvaluate gateReceipt）、`loop.js`/derive 的 `DETERMINISTIC_IMPACT_ERROR_CODES` 与路由；Brain semver 四处同步 + DevGate 三项。
**不在范围内**：不放宽 `radius.js` 无主文件/断言覆盖规则（结论本身正确）；不改 `map-client.js assertMapperContract`；不给 G1 补断言（另立 Map 覆盖任务）；不复活已死 run。

## 假设

- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 不再触发 `impact_anchor_missing`；但代码仍须正确处理该 reason_code 以覆盖其它无主文件。]
- [ASSUMPTION: 合同冻结测试必须放 `sprints/08162257-kernel-7589808e/tests/`（kernel 冻结产物只认此目录）；永久回归测试由 Generator 实现阶段复制进 `packages/brain/src/**/__tests__/`。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 三类分流 + reason_code 透传 + detail 载荷（无限重试根因）。
- `packages/brain/src/harness-gates.js`: beforeEvaluate gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/loop.js`（及 derive 路由）: `DETERMINISTIC_IMPACT_ERROR_CODES` 集合 + retryable:false 走确定性出口而非退避重试。
- `packages/brain/package.json` 等 semver 四处同步点。

## NFR 约束

<!-- 来源: decisions category=nfr（step 源为空）+ PrepPRD 显式约束；PrepPRD 显式值优先 -->
- 超时/延迟: 确定性结论必须 `retryable:false`，禁止空转到 deadline（现状 130+/80+ 跳空转即回归）。
- 频控: 保留 90s 重试节流仅用于真 retryable 情形。
- 版本要求: Brain semver bump 四处同步（package.json / DEFINITION 等）+ DevGate 三项通过。
- 可观测: gate 决策必须写 orchestrator_decision_log（gate_verdict + detail.impact_gate.reason/retryable/unclaimed_files），运维可从日志判因。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级三源合并去重 -->
- [基础设施重试身份] Generator 基础设施失败必须重试原始服务端派发动作（首次 generator→generator，generator-fix→generator-fix）；本 sprint 只对**确定性 impact 结论**改判 retryable:false，不得波及真基础设施失败的重试身份（来源: area, id:53f23a09）。
- [Planner 分支] Planner workspace 必须从服务端签发的 planner_branch 起步，Provider 可校验但不得 checkout/switch（来源: area, id:ae95068e）。
- [Fleet Brain URL 权威] Dispatcher 与 Fleet Worker 必须注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁手工绕过（来源: area, id:39624ab8）。
- [Evaluator 校验时钟] validation_clock_required 默认 fail-closed，仅 hotfix 且 pr_url/pr_head_sha 与 GitHub 实时一致时可建一次共享时钟，缺失/不一致一律拒绝（来源: area, id:ddca7267）。

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 将填入真实脚本（local_api → 对 scratch Brain POST 一条 evaluator 前置闸调用 + psql 查表）
# 期望验收点（自然语言）：
#   1. 对 scratch 库 Brain POST 一条 evaluator 前置 Diff Impact Gate 调用（mock/录制件复现 impact_anchor_missing + unclaimed_files=['DoD.md']）。
#   2. psql 查 orchestrator_decision_log 新增一行：gate_verdict='deny:impact:impact_anchor_missing'
#      且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空。
#   3. 回归夹具：用 run d1360a48 真实 changed_files（含 DoD.md）+ 真实 radius 录制件 →
#      旧代码 mapper_stale/retryable:true，新代码 blocked:impact_anchor_missing/retryable:false。
```

## journey_type: autonomous
## journey_type_reason: 改动全部落在 packages/brain/（diff-gate/harness-gates/loop），纯后端调度决策，无 UI/远端 agent 协议/engine hooks。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api，验收走本地 evaluator curl localhost:5221 + psql scratch 库。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
