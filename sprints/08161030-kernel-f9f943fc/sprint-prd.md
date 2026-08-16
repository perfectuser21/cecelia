# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类 kernel 无限重试到 deadline 的空转黑洞）

## 背景

08-15 20:08 起两条生产 run 同病：run f62c7e87（task 93cbbb32）与 run d1360a48（task 0ca4b234）
的 Generator 均已产出本地候选，但 `spawn:evaluator` 前的 Diff Impact Gate 持续返回
`deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（分别空转 130+/80+ 跳）。
Map 本身新鲜（GET /api/brain/map?scope=cecelia 全 snapshots fresh，fact_revisions=bc4e8644=origin/main）。
根因：`radius.js` 在快照新鲜前提下把**确定性**结论（impact_anchor_missing / capability_assertion_coverage_missing）
也写进 freshness；`diff-gate.js:201-207` 只判 `freshness.status !== 'fresh'` 就统一折叠成
`mapper_stale, retryable:true`，丢掉 reason_code，把不可能靠重试改变的确定性结论标成可重试。

## Golden Path（核心场景）

系统从 [Generator 产出本地候选] → 经过 [beforeEvaluate Diff Impact Gate 分类判定] → 到达 [确定性结论 fail-closed 出口，不再无限重试]

具体：
1. Generator 产出本地候选，kernel 在 `spawn:evaluator` 前调用 beforeEvaluate 的 Diff Impact Gate。
2. Gate 消费 mapper（radius.js）返回的 freshness，`diff-gate.js` 按三类分流：
   - (a) 真新鲜度问题（fact_snapshot_stale / projection_revision_missing / projection_revision_mismatch / manifest_projection_mismatch / graph_projection_revision_mismatch）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护，仍可重试）。
   - (b) 确定性结论（impact_anchor_missing / capability_assertion_coverage_missing / capability_not_in_active_projection / unsafe_assertion_ref / assertion_identity_ambiguous）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，detail 携带 `unclaimed_files` 与缺覆盖 `capability_ids`。
   - (c) 其余未知 reason_code → fail-closed `gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
3. harness-gates.js beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail 进 orchestrator_decision_log。
4. loop.js 对 impact 结论 retryable:false 不再按 infrastructure_blocked 退避重试；走既有确定性出口
   （DETERMINISTIC_IMPACT_ERROR_CODES 补上述 reason，failure_class=impact_contract_invalid），由 derive 路由：
   - impact_anchor_missing → 先 `spawn:generator_fix` 一次（携带 unclaimed_files 清单），仍失败 → wait:human_review。
   - capability_assertion_coverage_missing → wait:human_review。
5. 可观测出口：orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'，
   detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 diff-gate 结果结构后推导，Planner 不定义技术规范。 -->

## 边界情况

- 同一候选同时触发新鲜度问题与确定性结论 → 新鲜度优先判可重试（避免真 stale 被误判 blocked）。
- unclaimed_files 为空但 reason=impact_anchor_missing → generator-fix 无法定位，直接 human_review。
- mapper 返回全新 reason_code（未来新增）→ (c) 分支 fail-closed，禁止静默放行。

## 范围限定

**在范围内**：packages/brain 内 diff-gate.js（三类分流 + reason_code 透传 + detail）、harness-gates.js（gateReceipt 透传）、loop.js/derive（retryable:false 确定性出口 + 路由）。Brain semver 四处同步 + DevGate 三项。
**不在范围内**：不放宽 radius 的无主文件/断言覆盖规则（radius.js 结论正确，不改）；不给 G1 补断言（另立 Map 覆盖任务）；不复活已死 run；map-client.js assertMapperContract 不变。

## 假设

- [ASSUMPTION: DETERMINISTIC_IMPACT_ERROR_CODES 集合与 derive 路由逻辑位于 loop.js 现有确定性出口路径，按 reason 二选一（generator-fix / human_review）复用既有 wait 机制。]
- [ASSUMPTION: E2E 用 scratch Brain + scratch 库，避免污染生产 orchestrator_decision_log。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 三类分流，透传 reason_code + detail（unclaimed_files / capability_ids）。
- `packages/brain/src/harness-gates.js`: beforeEvaluate gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/loop.js`（含 derive）: DETERMINISTIC_IMPACT_ERROR_CODES 补集 + retryable:false 确定性出口路由。
- `packages/brain/package.json` 等版本四处: semver bump 同步。
- 单测/回归夹具（回归用 run d1360a48 真实 changed_files 含 DoD.md + 真实 radius 录制件）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 无命中（step/feature 均空）；以下取自 PrepPRD 显式约束 -->
- 超时/延迟: 待定（PrepPRD 未指定新阈值；现状 kernel 每 90s 重试到 deadline，本 sprint 消除确定性结论的重试路径）
- 频控: 无
- 版本要求: Brain semver bump 四处同步（DevGate check-version-sync 校验）
- 可观测: 失败/blocked 必须写 orchestrator_decision_log，含 gate_verdict + detail.impact_gate.{reason,retryable,unclaimed_files,capability_ids}

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 两源为空）；下列为与本 sprint 直接相关子集 + [系统]铁律 -->
- [新鲜度重试身份] generator 基础设施/新鲜度类失败才可 retryable，确定性结论不得标可重试（来源: area — generator_infrastructure_retry_identity）
- [失败不静默] catch 吞错/失败路径必须显式 FAIL 且带失败分类，禁 warning 降级放行（来源: area — 部署链失败路径禁 warning 降级）
- [证据入决策日志] Brain judge/gate 结果必须写含 exit_code/detail 的一手证据到决策日志，运维可从日志判因（来源: area — .brain-result.json 一手证据）
- [status 枚举全仓核对] 新增 status/reason 枚举值时须全仓库核对硬编码断言（来源: area — GAN 新增状态值全仓核对）
- [禁写死环境假设值] 禁止写死环境假设值（来源: area — [系统]禁止写死环境假设值）
- [真环境验证才算done] 真实环境验证才算 done，禁凭"测试通过"空断言收尾（来源: area — [系统]真环境验证才算done）
- [测试默认多租户] 测试默认多租户隔离（来源: area — [系统]测试默认多租户）
- [凭据安全] API Key/Token/密钥不入 git（来源: area — [系统]凭据安全）
- [日志脱敏] 日志脱敏（来源: area — [系统]日志脱敏）
- [端点鉴权] 端点鉴权（来源: area — [系统]端点鉴权）
- [租户隔离] 记忆/数据按租户隔离（来源: area — [系统]租户隔离）
<!-- （另有 ~50 条 area 级 capture-triage learning 与本 sprint 不直接相关，略） -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 唯一 ability 状态=planned，尚无 done/working -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 将填入真实脚本（local_api → 对 scratch Brain POST 一条 evaluator 前置闸调用 + psql 查 scratch 库）
# 期望验收点（自然语言）：
#   对 scratch Brain POST 一条 evaluator 前置闸调用（候选含 Map 无主文件 DoD.md）→
#   psql 查 scratch 库 orchestrator_decision_log 新增行:
#     gate_verdict = 'deny:impact:impact_anchor_missing'
#     detail.impact_gate.retryable = false
#     detail.impact_gate.unclaimed_files 非空（含 DoD.md）
#   且 kernel 不再进入 mapper_stale 无限重试（该结论 retryable=false）。
```

## journey_type: autonomous
## journey_type_reason: 改动全部在 packages/brain/（diff-gate/harness-gates/loop），纯后端调度决策逻辑，无 UI/agent 协议。
## target_environment: local_api
## target_environment_reason: 仅 packages/brain 后端 + 决策日志验证，用本地 evaluator curl localhost:5221 + psql scratch 库。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
