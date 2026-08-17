# Sprint PRD — Diff Impact Gate 透传 reason_code 并 fail-closed 出口（r16）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness kernel 一类无限重试死循环，减少 run 空转到 deadline）

## 背景

08-15 20:08 起两条生产 run（f62c7e87 / d1360a48）同病：Generator 已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 却持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试到 deadline（130+/80+ 跳空转）。但 Map 本身是新鲜的（`GET /api/brain/map?scope=cecelia` 全 snapshots fresh）。根因：`radius.js` 在快照新鲜前提下也会产出**确定性**结论（`impact_anchor_missing` / `capability_assertion_coverage_missing`），而 `diff-gate.js:201-206` 只判 `freshness.status !== 'fresh'` 就一律折叠成 `mapper_stale, retryable:true`，丢掉 `reason_code`，把不可能靠重试改变的确定性结论标成可重试。本 sprint 让 gate 区分「真新鲜度问题」「确定性结论」「未知 reason_code」，透传 reason_code 并对确定性/未知走 fail-closed 出口。

## Golden Path（核心场景）

系统从 [Generator 产出本地候选] → 经过 [Diff Impact Gate 按 reason_code 分类裁决] → 到达 [确定性结论走生成器修复或人工评审，不再无限重试]

具体：
1. **触发**：Generator 产出本地候选，kernel 在 `spawn:evaluator` 前经 `harness-gates.js` beforeEvaluate 调用 `diff-gate.js` 评估 impact。
2. **系统处理**：diff-gate 读 mapper 返回的 `freshness.reason_code`，分三类裁决——
   - (a) **真新鲜度问题**（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护，不变）。
   - (b) **确定性结论**（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，`detail` 带 `unclaimed_files` 与缺覆盖的 `capability_ids`。
   - (c) **其余未知 reason_code** → fail-closed：`gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
3. **可观测结果**：beforeEvaluate 的 gateReceipt 透传 `reason`/`retryable`/`detail`；`loop.js`/`derive.js` 对 `retryable:false` 的 impact 结论不再按 `infrastructure_blocked` 退避重试，而走确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 补上述 reason，`failure_class='impact_contract_invalid'`）：`impact_anchor_missing` → `spawn:generator_fix`（detail 带 `unclaimed_files`）一次，仍失败 → `wait:human_review`；`capability_assertion_coverage_missing` → `wait:human_review`。`orchestrator_decision_log` 落 `gate_verdict='deny:impact:<reason_code>'` 且 `detail.impact_gate.retryable=false`。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **混合改动**：候选同时含无主文件与真新鲜度信号——以 radius 产出的单一 `freshness.reason_code` 分类为准，(a)/(b) 归属由 reason_code 唯一决定，不做启发式合并。
- **generator_fix 后仍未认领**：删除/挪走无主文件后再次过闸仍 `impact_anchor_missing` → 转 `wait:human_review`，不无限 fix（generator_fix 仅一次）。
- **radius 未来新增枚举**：未知 reason_code 一律 fail-closed（retryable:false），既不静默放行也不无限重试。
- **已死 run**：不复活历史 run，仅对新 run 生效。

## 范围限定

**在范围内**：`packages/brain/src/impact-contract/diff-gate.js`（三类分类 + reason_code 透传 + detail）、`packages/brain/src/impact-contract/harness-gates.js`（gateReceipt 透传 reason/retryable/detail）、`packages/brain/src/orchestrator/loop.js` + `derive.js`（`DETERMINISTIC_IMPACT_ERROR_CODES` 补集 + retryable:false 路由到 generator_fix / human_review）。

**不在范围内**：不放宽 radius 的无主文件/断言覆盖规则（`radius.js` 不动，结论本身正确）；不给能力 G1 补断言（另立 Map 覆盖任务）；不复活已死 run；`map-client.js` `assertMapperContract` 不变。

## 假设

- [ASSUMPTION: `radius.js` 产出的 `freshness.reason_code` 枚举稳定为已列出集合，未列出者视为未知走 fail-closed。]
- [ASSUMPTION: mapper 结果携带 `unclaimed_files`（无主文件清单）与受影响 `capability_ids`，diff-gate 可直接读取放入 detail。]
- [ASSUMPTION: `orchestrator_decision_log.detail` 为 JSON 列，可写入 `impact_gate.{retryable,unclaimed_files,reason_code}` 子对象。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 3a 分支（:201-206）由「只判 status!=='fresh'」改为按 reason_code 三类裁决 + 透传 detail。
- `packages/brain/src/impact-contract/harness-gates.js`: beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/orchestrator/loop.js`: `DETERMINISTIC_IMPACT_ERROR_CODES`（:84）补新 reason；retryable:false 不走 infrastructure_blocked 退避。
- `packages/brain/src/orchestrator/derive.js`: 按 reason 路由 generator_fix / human_review。
- `packages/brain/package.json` 等四处: semver bump（当前 1.273.71）。
- `sprints/08171726-kernel-3b150c01/tests/`: 合同冻结测试（本单硬要求：合同测试落此目录，非 `src/**/__tests__/`）。

## E2E 验收

> Planner 初稿此区块留占位。可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 将填入真实脚本（local_api → 对 scratch Brain POST 一条 evaluator 前置闸调用 + psql 查库）
# 期望验收点（自然语言）：
#   1. 对 scratch Brain POST 一条会触发 impact_anchor_missing 的 evaluator 前置闸调用；
#   2. psql 查 orchestrator_decision_log 新增一行：
#      gate_verdict='deny:impact:impact_anchor_missing'
#      AND detail.impact_gate.retryable = false
#      AND detail.impact_gate.unclaimed_files 非空；
#   3. 回归：freshness.status='stale' 的调用仍落 gate_verdict='deny:impact:mapper_stale' 且 retryable=true。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step/journey_feature 级查询为空，area 级现有 invariant 属 capture-triage 域与本 sprint 无关，不注入；下列为本 sprint 确立、供下游 GAN 消费的 impact-contract 铁律 -->
- [fail-closed] 无法判定/未知 reason_code 的 impact 结论必须 fail-closed（retryable=false），禁止折叠成可无限重试（来源: 本 sprint 确立）
- [确定性不重试] Map 快照新鲜前提下的确定性结论（无主文件/断言覆盖缺口）不得标 retryable=true（来源: 本 sprint 确立）
- [reason 保真] gate 结果必须透传原始 reason_code，不得覆写成 mapper_stale（来源: 本 sprint 确立）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journeys/:id/golden-paths 返回空 -->
- （本 line 暂无历史）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + feature 双源查询均为空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；gate 为同步判定，不引入新等待）
- 频控: 待定（本 sprint 目标即消除无限重试，retryable:false 结论不再进入 90s 重试节拍）
- 版本要求: Brain semver bump 四处同步（当前 1.273.71）
- 可观测: 确定性 blocked 结论必须写入 orchestrator_decision_log（gate_verdict + detail.impact_gate.reason_code/retryable/unclaimed_files）

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain（impact-contract + orchestrator 纯后端），无 UI/agent 协议/engine 介入。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端，Final E2E 走本地 evaluator 对 scratch Brain curl localhost:5221 + psql 查 orchestrator_decision_log；payload 亦显式指定 local_api。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
