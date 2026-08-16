# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 出口（不再把确定性 Map 结论折叠成 mapper_stale 无限重试）

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类 kernel 无限重试到 deadline 的空转，回收算力）

## 背景

08-15 20:08 起两条生产 run 同病并实测复现：run f62c7e87（task 93cbbb32）与 run d1360a48（task 0ca4b234）Generator 均已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 却持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（分别空转 130+/80+ 跳），而 Map 本身新鲜（`GET /api/brain/map?scope=cecelia` 全 snapshots fresh）。根因：`diff-gate.js` 只判 `freshness.status !== 'fresh'` 就返回 `mapper_stale/retryable:true`，把**确定性**结论（`impact_anchor_missing` / `capability_assertion_coverage_missing`）也标成可重试，丢掉 `reason_code`。本 sprint 让 diff-gate 区分「真新鲜度问题（可重试）」「确定性结论（fail-closed，走既有确定性出口）」「未知 reason_code（fail-closed）」，并把决策依据带进 gateReceipt 与决策日志。

## Golden Path（核心场景）

系统从 [Generator 产出本地候选，kernel 在 spawn:evaluator 前调 Diff Impact Gate] → 经过 [diff-gate 按 freshness.status/reason_code 分三类裁决 + harness-gates 透传 receipt + loop/derive 按 retryable 路由] → 到达 [确定性结论一次性落 blocked 并路由到 generator-fix 或 human_review，不再无限重试；决策日志可判因]

具体：
1. mapper 返回 `freshness.status:'unknown', reason_code:'impact_anchor_missing'`（候选含 Map 无主文件，如仓库根新建文件）→ diff-gate 返回 `gate:'blocked', reason:'impact_anchor_missing', retryable:false`，`detail.unclaimed_files` 带无主文件清单。
2. mapper 返回 `reason_code:'capability_assertion_coverage_missing'`（受影响能力零断言，如 G1）→ diff-gate 返回 `gate:'blocked', reason:'capability_assertion_coverage_missing', retryable:false`，`detail` 带缺覆盖 capability_ids。
3. mapper 返回**真新鲜度**问题（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 仍 `impact_unknown / mapper_stale / retryable:true`（回归保护，可重试语义不变）。
4. 未知 reason_code → fail-closed：`impact_unknown / mapper_contract_invalid / retryable:false`。
5. harness-gates beforeEvaluate 的 gateReceipt 透传 `reason / retryable / detail`（含 unclaimed_files / 缺覆盖 capability_ids），运维可从 orchestrator_decision_log 判因。
6. loop.js/derive：对 `retryable:false` 的 impact 结论不再按 `infrastructure_blocked` 退避重试，走既有确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 补上述 reason，`failure_class=impact_contract_invalid`）；`impact_anchor_missing` → `spawn:generator_fix` 一次（detail 带 unclaimed_files），仍失败 → `wait:human_review`；`capability_assertion_coverage_missing` → 直接 `wait:human_review`。

## 边界情况

- 真新鲜度 stale 与确定性结论并存时，以确定性 reason_code 优先落 blocked（fail-closed），不得回退成可重试。
- 未在既有集合内的新 reason_code 一律 fail-closed（`retryable:false`），禁止默认可重试。
- `unclaimed_files` 为空但 reason=`impact_anchor_missing` 时仍落 blocked（detail 允许空数组，不因空数组降级）。
- Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 不再触发 impact_anchor_missing；夹具须用录制件复现旧行为，不依赖实时 Map。

## 范围限定

**在范围内**：
- `packages/brain/src/impact-contract/diff-gate.js`：三类裁决 + reason_code 透传 + detail（unclaimed_files / capability_ids）。
- `packages/brain/src/impact-contract/harness-gates.js`：beforeEvaluate gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/orchestrator/loop.js` + `derive.js`（及 `constants.js` 的 `DETERMINISTIC_IMPACT_ERROR_CODES`）：retryable:false 的 impact 结论走确定性出口路由到 generator_fix / human_review。
- Brain semver bump 四处同步 + DevGate 三项。

**不在范围内**：
- 不放宽 radius.js 的无主文件/断言覆盖规则（结论本身正确，错在消费方）；radius.js 不改。
- 不给 G1 补断言（另立 Map 覆盖任务）。
- 不复活已死 run（d1360a48 / f62c7e87 仅作夹具来源）。
- map-client.js assertMapperContract 不变。

## 假设

- [ASSUMPTION: thin_prd 为空，本 PRD 主题与 scope 直接锚定 task.description（PrepPRD 等价物），主题字面 = 「Diff Impact Gate 透传 reason_code + fail-closed 出口」。]
- [ASSUMPTION: 确定性 reason_code 全集 = `impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`（以 radius.js 现有产出为准，Proposer Step 1.1 核对）。]
- [ASSUMPTION: map-client.js 实际路径为 `packages/brain/src/impact-contract/map-client.js`（非 `src/map/`）；本 sprint 不改它。]
- [ASSUMPTION: r2 硬要求生效——合同冻结测试落 `sprints/08170326-kernel-a2ffdf00/tests/`；永久回归由 Generator 复制到 `packages/brain/src/**/__tests__/`。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 三类裁决主逻辑（201-207 附近扩展），透传 reason_code + detail。
- `packages/brain/src/impact-contract/harness-gates.js`: beforeEvaluate gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/orchestrator/loop.js`: retryable:false 的 impact 结论不再按 infrastructure_blocked 退避。
- `packages/brain/src/orchestrator/derive.js`: 按 reason 路由 generator_fix / human_review。
- `packages/brain/src/orchestrator/constants.js`: `DETERMINISTIC_IMPACT_ERROR_CODES` 补齐 + `failure_class=impact_contract_invalid`。
- `packages/brain/package.json`（+ selfcheck/DEFINITION/version-sync 三处）: semver bump 四处同步。
- `sprints/08170326-kernel-a2ffdf00/tests/`: 合同冻结测试（diff-gate / harness-gates / loop-derive 单测 + d1360a48 回归夹具）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；确定性结论必须一次落定，不得触发 90s 重试循环）
- 频控: 确定性 impact 结论 retryable=false，禁止无限重试到 deadline
- 版本要求: Brain semver 四处同步（package.json / selfcheck EXPECTED_SCHEMA_VERSION 语义 / DEFINITION.md / check-version-sync）
- 可观测: gateReceipt 与 orchestrator_decision_log 必须带 reason / retryable / detail（unclaimed_files / capability_ids），失败可判因

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 级本 task 为空）；全量注入不裁剪，下列为与本 sprint 直接相关的铁律，另有大量 [capture-triage] area 学习条同样生效 -->
- [planner分支] Planner 必须使用服务端签发的 PLANNER_BRANCH，禁止自行 checkout/switch（来源: area）
- [generator重试身份] generator 基础设施重试须保持 retry identity 一致（来源: area）
- [kernel时钟] Kernel 对既有 PR 采用 evaluator validation clock（来源: area）
- [枚举全仓grep] contract-dod/测试里 status/reason 枚举硬编码，GAN 新增值时须全仓库 grep 同步（来源: area）
- [合同实跑] 合同验证命令必须实跑确认 exit code 语义；vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 0（来源: area）
- [local_api闸] judge 机械闸 meta_verification_gap 对 local_api/无 UI smoke 会死锁，此类任务须在合同层规避（来源: area）
- [red精确add] Red commit 只 git add 精确 *.test 路径，禁止 git add . / .harness（来源: area）
- [同语义同策略] 同一语义（如确定性 vs 可重试）在判变端与终验端必须同一处理策略，跨脚本分叉会开假绿面（来源: area）
- [系统] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [系统] 禁止写死环境假设值（来源: area）
- [系统] 真环境验证才算 done（来源: area）
- [系统] 测试默认多租户（来源: area）
- [系统] 凭据安全（来源: area）
- [系统] 日志脱敏（来源: area）
- [系统] 端点鉴权（来源: area）
- [系统] 租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 journey 已完成 ability 的 golden_path；查得 ability 均为 planned（未验收），故本 line 暂无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 将填入真实脚本（local_api → 对 scratch Brain POST + psql 查 orchestrator_decision_log）
# 期望验收点（自然语言）：
#  对 scratch Brain POST 一条 evaluator 前置闸调用（candidate 含 Map 无主文件），
#  psql 查 orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'
#  且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空。
```

## journey_type: autonomous
## journey_type_reason: 改动全部落 packages/brain/（diff-gate/orchestrator kernel 后端逻辑），无 UI/agent 协议/engine，纯自治后端。
## target_environment: local_api
## target_environment_reason: task.payload.target_environment 显式为 local_api；验收为 scratch Brain（curl localhost:5221 + psql orchestrator_decision_log），本地 evaluator 执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定 step）
