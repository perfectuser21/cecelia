# Sprint PRD — Diff Impact Gate 透传 reason_code 并 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类确定性结论被折叠成 `mapper_stale` 无限重试的空转，让 Harness kernel 遇到 Map 确定性覆盖缺口时快速 fail-closed 而非跑到 deadline）

## 背景

08-15 起两条生产 run（f62c7e87 / d1360a48）Generator 均已产出本地候选，但 `spawn:evaluator` 前的 Diff Impact Gate 持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试到 deadline（分别空转 130+/80+ 跳）。真因：Map 本身新鲜（GET /api/brain/map?scope=cecelia 全部 snapshots fresh），但 `diff-gate.js:201-207` 只看 `freshness.status !== 'fresh'` 就一律标 `mapper_stale, retryable:true`，把 `radius.js` 写出的**确定性**结论（`impact_anchor_missing` / `capability_assertion_coverage_missing` 等，重试永不改变）也当作可重试的新鲜度问题，丢掉了 `reason_code`。运维在日志里永远只看到 “mapper_stale”，无从判因。

## Golden Path（核心场景）

系统从 [Diff Impact Gate 消费 mapper 结论] → 经过 [按 reason_code 三分类判定] → 到达 [确定性缺口 fail-closed 并路由到正确恢复出口，不再无限重试]

具体：
1. **触发条件**：Generator 候选已就绪，kernel 在 `spawn:evaluator` 前调用 Diff Impact Gate；mapper 返回 `freshness.status !== 'fresh'`。
2. **系统处理**：`diff-gate.js` 按 `freshness.reason_code` 三分类——
   - (a) **真新鲜度问题**（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护，仍可重试）。
   - (b) **确定性结论**（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，并把 `unclaimed_files` 与缺覆盖的 `capability_ids` 放进结果 `detail`。
   - (c) **其余未知 reason_code** → fail-closed `gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
   `harness-gates.js` beforeEvaluate 的 gateReceipt 透传 `reason/retryable/detail`；`loop.js` 对 `retryable:false` 的 impact 结论不再按 `infrastructure_blocked` 退避重试，改走确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 补上述 reason，`failure_class=impact_contract_invalid`）；`derive.js` 按 reason 路由——`impact_anchor_missing` → `spawn:generator_fix`（携带 `unclaimed_files` 清单）一次，仍失败 → `wait:human_review`；`capability_assertion_coverage_missing` → 直接 `wait:human_review`。
3. **可观测结果**：orchestrator_decision_log 出现 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`、`detail.impact_gate.unclaimed_files` 非空；kernel 不再对该结论 90s 重试到 deadline。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- 同一候选同时命中多个确定性 reason_code：以 radius 返回的单一 `freshness.reason_code` 为准（radius 不变，消费方不聚合）。
- `unclaimed_files` 为空但 reason 为 `impact_anchor_missing`：detail 仍带空数组字段（下游 generator-fix 判空即转 human_review）。
- generator-fix 修一次仍返回同 reason：走既有 no-progress / human_review 出口，不无限循环。

## 范围限定

**在范围内**：`packages/brain/src/impact-contract/diff-gate.js`（三分类 + reason_code 透传 + detail）、`packages/brain/src/impact-contract/harness-gates.js`（gateReceipt 透传）、`packages/brain/src/orchestrator/loop.js`（retryable:false 不退避）、`packages/brain/src/orchestrator/derive.js`（DETERMINISTIC_IMPACT_ERROR_CODES + failure_class=impact_contract_invalid + reason→出口路由）。Brain semver 四处同步 + DevGate 三项。
**不在范围内**：放宽 radius 的无主文件/断言覆盖规则；给能力 G1 补断言（另立 Map 覆盖任务）；复活已死 run；改 `map-client.js`（assertMapperContract 不变）与 `radius.js`（结论本身正确）。

## 假设

- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 不再触发 `impact_anchor_missing`；本 sprint 用 run d1360a48 录制件作回归夹具复现旧/新行为，不依赖线上 Map 现状。]
- [ASSUMPTION: 合同冻结测试文件放在 `sprints/08171301-kernel-5f49d642/tests/`（kernel 采集冻结产物只认此路径）；永久回归测试由 Generator 复制到 `packages/brain/src/**/__tests__/`。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：mapper 结论三分类，透传 reason_code + detail（unclaimed_files / capability_ids），确定性结论 fail-closed。
- `packages/brain/src/impact-contract/harness-gates.js`：beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail。
- `packages/brain/src/orchestrator/loop.js`：retryable:false 的 impact 结论不再按 infrastructure_blocked 退避重试。
- `packages/brain/src/orchestrator/derive.js`：DETERMINISTIC_IMPACT_ERROR_CODES 补齐 + failure_class=impact_contract_invalid + reason→(generator_fix|human_review) 路由。
- `packages/brain/package.json` 等四处：semver bump 同步。

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl scratch Brain + psql 查 orchestrator_decision_log）
# 期望验收点（自然语言）：对 scratch Brain POST 一条 evaluator 前置闸调用（mapper 返回
#   freshness.status=unknown/reason_code=impact_anchor_missing + unclaimed_files=['DoD.md']），
#   psql 查 orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'，
#   且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain semver 四处同步 + DevGate 三项（facts-check / check-version-sync / check-dod-mapping）必过
- 可观测: 确定性 impact 结论必须把 reason_code / retryable / unclaimed_files / capability_ids 落进 orchestrator_decision_log 的 detail.impact_gate，供运维判因

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step + journey_feature 两源空，area 级共多条，此处列与本 sprint 同域的 harness/kernel 铁律；android/wechat/nightly 等他域略 -->
- [重试身份] Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator-fix（来源: area）
- [已有PR时钟] 保留 validation_clock_required 默认 fail-closed；缺失或不一致一律拒绝（来源: area）
- [Fleet Brain URL] 本地 Dispatcher 与 Fleet Worker 必须同时注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁止单 Attempt 手工绕过（来源: area）
- [Planner分支] Planner workspace 必须停在服务端签发的 planner_branch；Provider 可校验但不得 checkout/switch（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 golden-paths 返回空 -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 全部改动落在 packages/brain/（diff-gate/harness-gates/loop/derive），纯后端 kernel 调度逻辑，无 UI/agent 协议/engine 触及。
## target_environment: local_api
## target_environment_reason: 验收为对本地 scratch Brain（curl localhost:5221）POST 前置闸调用 + psql 查 orchestrator_decision_log，纯后端 API 验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
