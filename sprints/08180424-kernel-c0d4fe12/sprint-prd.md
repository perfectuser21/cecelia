# Sprint PRD — Diff Impact Gate 透传 reason_code 并对确定性 Map 结论 fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness 编排层 deny:impact:mapper_stale 无限空转这一可信赖性缺口）

## 背景

runs f62c7e87 / d1360a48 出现 `deny:impact:mapper_stale` 空转：Diff Impact Gate（`packages/brain/src/impact-contract/diff-gate.js`）在 Mapper freshness 非 fresh 时，把**所有**非 fresh 情形（含 Map 已给出的确定性结论）统一折叠成硬编码的 `reason: 'mapper_stale'` + `retryable: true`，丢弃 Mapper 真实的 `freshness.reason_code`。

而 Mapper（`map/radius.js`）对 `freshness.status` 区分两类：
- `stale`（`fact_snapshot_stale` / `projection_revision_*` 等）= 瞬时投影滞后，重投影可自愈 → 应可重试；
- `unknown`（`impact_anchor_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous` / `capability_assertion_coverage_missing`）= **确定性结构结论**，重试永远不会变 fresh → 必须 fail-closed 终止。

当前把 `unknown` 也标 `retryable: true`，orchestrator 便无限重发 `deny:impact:mapper_stale`，任务永不收敛（空转）。

## Golden Path（核心场景）

系统从 [编码后 Diff Gate 复算] → 经过 [reason_code 透传 + 确定性判定] → 到达 [非重试终止，不再空转]

具体：
1. [触发条件] 编码完成，orchestrator 调 `evaluateDiffGate`；Mapper 复算返回 `freshness = { status: 'unknown', reason_code: 'impact_anchor_missing' }`（确定性结论：anchor 在活跃投影中不存在）。
2. [系统处理] Gate 读取并**透传** `mapperResult.freshness.reason_code`，识别 `status === 'unknown'` 属确定性不可判定 → **fail-closed 出口** `retryable: false`；与 `status === 'stale'` 的瞬时滞后（保持 `retryable: true`）明确区分。
3. [可观测结果] orchestrator 收到携带真实 reason_code 的裁决（如 `deny:impact:impact_anchor_missing`）并**终止**，任务转 blocked/escalate，不再重复发 `deny:impact:mapper_stale`（runs f62c7e87 / d1360a48 空转场景终结）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- `status === 'stale'`（`fact_snapshot_stale` 等瞬时码）→ 仍 `retryable: true`，不被误判为终止。
- `freshness` 缺失、或 `reason_code` 为 null → 保守 fail-closed：沿用 `reason: 'mapper_stale'` 兜底，且不得因缺 reason_code 而误标可无限重试。
- 已有 4 类 impact_unknown 出口（`mapper_unavailable` / `revision_mismatch` / `*_digest_mismatch` 等）行为不得回退：本 sprint 只改 3a（freshness 非 fresh）分支的 reason 透传与 retryable 语义。

## 范围限定

**在范围内**：`diff-gate.js` 步骤 3a 分支——透传 `freshness.reason_code`；按 `status` 区分 `stale`(retryable=true) 与 `unknown`(retryable=false / fail-closed)；orchestrator 消费透传后的 reason_code 生成 `deny:impact:<reason_code>` 且确定性结论不再进入基础设施重试。
**不在范围内**：Mapper（`radius.js`）reason_code 取值本身；`structure-gate.js`（虽同构，另行处理）；contract schema、gap ledger、drift 仲裁逻辑。

## 假设

- [ASSUMPTION: `freshness.status === 'unknown'` 恒代表确定性 Map 结论（重试不自愈），`'stale'` 恒代表瞬时滞后（可重试）——依据 `map/radius.js` 现有 reason_code 分类。]
- [ASSUMPTION: orchestrator loop 依据 gate 返回的 `retryable` 决定是否重发，`retryable: false` 会终止而非无限重试——依据 `orchestrator/__tests__/loop.test.js` 现有 `deny:impact:*` 消费路径。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 步骤 3a 透传 reason_code + fail-closed 出口的核心改动。
- `packages/brain/src/impact-contract/__tests__/harness-gates.test.js`: 新增确定性 `unknown` → 非重试、瞬时 `stale` → 可重试的红转绿回归。
- `packages/brain/src/orchestrator/__tests__/loop.test.js`: 断言 `deny:impact:<reason_code>` 透传且确定性结论不再重试（可能需补充）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + feature 两源均空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用现有 Mapper 10s 超时不变）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 确定性 fail-closed 终止必须携带真实 reason_code，供 orchestrator 写入 decision log（不得再以泛化 mapper_stale 掩盖根因）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 两源空；area 源 1 条 + 模块合同铁律 -->
- [fail-closed] Mapper 任何不可判定情形绝不假绿；确定性结论必须终止而非无限重试（来源: 模块合同 diff-gate.js 头注）
- [reason 透传] 不得用泛化 mapper_stale 掩盖 Mapper 真实 reason_code（来源: 本 sprint 根因 r19）
- [nightly-red 归因] nightly-red issue 连续 ≥3 晚同 job 红时贴失败 step 最后 20 行原始 stdout（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史：journey 已验收 ability 均为 planned 态，无 done/working 记录）

## E2E 验收

> Planner 初稿留空，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + node 单测）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1) mapClient 返回 freshness.status='unknown'/reason_code='impact_anchor_missing' 时，
#    evaluateDiffGate 返回 { gate:'impact_unknown', reason:'impact_anchor_missing', retryable:false }（透传 + fail-closed）
# 2) mapClient 返回 freshness.status='stale'/reason_code='fact_snapshot_stale' 时，
#    返回 { reason:'fact_snapshot_stale', retryable:true }（瞬时可重试）
# 3) freshness 缺失时兜底 { reason:'mapper_stale', retryable:false }（保守 fail-closed）
# 4) orchestrator loop 收到确定性结论后不再重发 deny:impact:mapper_stale（空转终结）
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端影响合同/编排逻辑，无 UI、无远端 agent 协议、非 engine hooks
## target_environment: local_api
## target_environment_reason: payload.target_environment 显式指定 local_api，本地 evaluator 走 curl localhost:5221 + node 单测复算 Gate
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
