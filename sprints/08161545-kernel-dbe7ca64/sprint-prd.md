# Sprint PRD — Diff Impact Gate 透传 reason_code 并 fail-closed 出口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类把确定性结论折叠成 mapper_stale 的无限重试空转）

## 背景

08-15 20:08 起两条生产 run（f62c7e87 / d1360a48）同病：Generator 已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 却持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline 空转 80~130+ 跳。而 Map 本身新鲜（snapshots fresh、fact_revisions=origin/main）。根因是 `diff-gate.js` 只看 `freshness.status !== 'fresh'` 就一律判 `mapper_stale/retryable:true`，丢掉了 `radius.js` 给出的确定性 `reason_code`（如 `impact_anchor_missing` / `capability_assertion_coverage_missing`）——这类结论不可能靠重试改变，却被标成可重试。本 sprint 让消费方按 reason_code 分类，确定性结论 fail-closed 走确定性出口，运维日志能看到真实原因。

## Golden Path（核心场景）

系统从 [kernel 在 spawn:evaluator 前调用 Diff Impact Gate] → 经过 [按 mapper reason_code 分类裁决] → 到达 [确定性结论 fail-closed 路由到修复/人工出口，日志可判因]

具体：
1. Generator 产出本地候选后，kernel（harness-gates.js beforeEvaluate）以候选 changed_files 调用 mapper（resolveImpactRadius）。Map 快照新鲜。
2. mapper 因确定性原因返回 `freshness.status='unknown'` 且带 `reason_code`（如候选含 Map 无主文件 → `impact_anchor_missing`，`unclaimed_files` 非空；受影响能力零断言覆盖 → `capability_assertion_coverage_missing`）。
3. diff-gate 按三类裁决：
   - (a) **真新鲜度问题**（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护）。
   - (b) **确定性结论**（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，`detail` 携带 `unclaimed_files` 与缺覆盖的 `capability_ids`。
   - (c) **未知 reason_code** → fail-closed `gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
4. harness-gates beforeEvaluate 的 gateReceipt 透传 `reason/retryable/detail`，写进 orchestrator_decision_log。
5. loop.js/derive 对 `retryable:false` 的 impact 结论不再按 `infrastructure_blocked` 退避重试，而走确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 补齐上述 reason，`failure_class='impact_contract_invalid'`）：`impact_anchor_missing` → `spawn:generator_fix` 一次（detail 带 `unclaimed_files` 清单），仍失败 → `wait:human_review`；`capability_assertion_coverage_missing` → 直接 `wait:human_review`。

**可观测出口**：orchestrator_decision_log 新增行 `gate_verdict='deny:impact:<reason_code>'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.unclaimed_files` 非空；kernel 不再对该结论做 90s 无限重试。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **mapper 不可达**：保持现有 fail-closed（diff-gate.js:191-193，`impact_unknown`），本 sprint 不改。
- **revision mismatch / digest mismatch**：属真新鲜度/对齐问题，保持 `retryable:true`（回归保护）。
- **mapper 返回全新未知 reason_code**：走 (c) 分支 fail-closed `mapper_contract_invalid, retryable:false`，禁止静默放行或无限重试。
- **generator-fix 修复后候选仍触发同一确定性结论**：不再二次 generator-fix，收敛到 `wait:human_review`。

## 范围限定

**在范围内**：
- `diff-gate.js`：freshness 消费处按 reason_code 三分类（a/b/c）。
- `harness-gates.js` beforeEvaluate：gateReceipt 透传 reason/retryable/detail。
- `loop.js`（derive/路由）：`DETERMINISTIC_IMPACT_ERROR_CODES` 补齐确定性 reason，retryable:false 走确定性出口而非退避重试。
- Brain semver 四处同步 + DevGate 三项。

**不在范围内**：
- 不放宽 radius 的无主文件/断言覆盖规则（`radius.js` 结论本身正确，不改）。
- `map-client.js` assertMapperContract 不改。
- 不给能力 G1 补断言（另立 Map 覆盖任务）。
- 不复活已死 run。

## 假设

- [ASSUMPTION: 合同冻结测试必须落在 `sprints/08161545-kernel-dbe7ca64/tests/`（r2 实证：放到 `packages/brain/src/**/__tests__/` 会导致 kernel 采集失败、run 终态 force_approve_but_contract_artifacts_missing）；永久回归测试由 Generator 在实现阶段复制到 `packages/brain/src/**/__tests__/`。]
- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 本身不再触发 impact_anchor_missing；回归夹具用 run d1360a48 录制件复现旧/新行为，不依赖当前 live Map。]
- [ASSUMPTION: r2 合同/测试/候选方向可原样复用（cp-harness-propose-r1-f9f943fc-r3cd1072a-a18），仅需将冻结测试搬到正确目录。]

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 本 sprint 确定性出口原则（area 级 88 条均为 capture-triage/nightly-CI 学习项，与 Diff Impact Gate 无关，不注入） -->
- [fail-closed] 未知/无法判定的 impact 结论一律 fail-closed，禁止静默放行或标成可重试无限空转（来源: sprint）
- [不放宽规则] 不放宽 radius 无主文件/断言覆盖规则，错在消费方分类而非 radius 结论（来源: sprint）
- [回归保护] 真新鲜度问题（fact_snapshot_stale 等五类）必须保持 impact_unknown/mapper_stale/retryable:true（来源: sprint）
- [可判因] 确定性拒绝必须把 reason_code + unclaimed_files/capability_ids 透传进 orchestrator_decision_log（来源: sprint）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 已完成 ability 的 golden_path -->
- （本 line 暂无历史：journey golden-paths 现仅 planned 态 ability，无 done/working 可沉淀）

## NFR 约束

<!-- 来源: decisions 表 category=nfr 无活跃项；以下取自 PrepPRD 显式描述 -->
- 超时/重试节律: kernel 重试节律 90s；retryable:false 结论必须立即退出重试循环，不等 deadline
- 频控: 无
- 版本要求: Brain semver bump 四处同步
- 可观测: 确定性拒绝必须写 orchestrator_decision_log（gate_verdict + detail.impact_gate.reason/retryable/unclaimed_files）

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: freshness 消费处（约 201-207）按 reason_code 三分类
- `packages/brain/src/impact-contract/harness-gates.js`: beforeEvaluate gateReceipt 透传 reason/retryable/detail
- `packages/brain/src/orchestrator/loop.js`: DETERMINISTIC_IMPACT_ERROR_CODES 补齐 + retryable:false 走确定性出口
- `sprints/08161545-kernel-dbe7ca64/tests/`: 合同冻结测试（diff-gate 三分类 / harness-gates gateReceipt / loop derive 路由 / d1360a48 回归夹具）
- Brain semver 四处（package.json / server.js / selfcheck.js 等版本锚点）: bump 同步

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql scratch 库）。

```bash
# 占位：proposer 将填入 local_api 脚本（curl scratch Brain 前置闸调用 + psql 查 orchestrator_decision_log）
# 期望验收点（自然语言）：
#   对 scratch Brain POST 一条 evaluator 前置闸调用（mapper 返回确定性 impact_anchor_missing + unclaimed_files）
#   → psql 查 orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'
#   → 且 detail.impact_gate.retryable=false，detail.impact_gate.unclaimed_files 非空
#   → 且该结论未触发 90s 无限重试（下一动作为 generator_fix / human_review）
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain/（diff-gate/harness-gates/loop），纯后端调度决策逻辑，无 UI/远端 agent/engine 介入
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；验收为本地 evaluator 对 scratch Brain（curl localhost:5221 + psql 查 orchestrator_decision_log）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
