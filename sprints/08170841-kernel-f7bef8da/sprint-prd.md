# Sprint PRD — Diff Impact Gate 确定性结论透传 reason_code 并 fail-closed 出口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类把 kernel 空转到 deadline 的 Harness 无限重试根因）

## 背景

08-15 20:08 起两条生产 run（f62c7e87 / d1360a48）同病：Generator 已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 在 Map 快照全部新鲜的前提下持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（130+/80+ 跳空转）。根因：`radius.js` 把**确定性**结论（无主文件 `impact_anchor_missing`、能力零断言 `capability_assertion_coverage_missing`）也写进 freshness，而 `diff-gate.js:201-207` 只判 `freshness.status !== 'fresh'` 就折叠成 `mapper_stale/retryable:true`，丢掉 reason_code → 把不可能靠重试改变的确定性结论标成可重试。

## Golden Path（核心场景）

系统从 [Generator 已产出本地候选] → 经过 [Diff Impact Gate 按 reason_code 分类] → 到达 [确定性结论走 fail-closed 出口，不再无限重试]

具体：
1. 触发：kernel 在 `spawn:evaluator` 前调用 Diff Impact Gate；Map 快照新鲜，但候选命中确定性结论（如候选在仓库根新建无主文件 → `unclaimed_files`，或改动能力零断言覆盖）。
2. 系统处理：`diff-gate.js` 区分三类 —
   - (a) 真新鲜度问题（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `impact_unknown` / `mapper_stale` / `retryable:true`（回归保护）。
   - (b) 确定性结论（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked'`、`reason:<原 reason_code>`、`retryable:false`，并把 `unclaimed_files` 与缺覆盖 `capability_ids` 放进结果 `detail`。
   - (c) 其余未知 reason_code → fail-closed `impact_unknown` / `mapper_contract_invalid` / `retryable:false`。
3. 可观测结果：
   - `harness-gates.js` beforeEvaluate 的 gateReceipt 透传 `reason` / `retryable` / `detail`。
   - `loop.js` / `derive.js` 对 `retryable:false` 的 impact 结论不再按 `infrastructure_blocked` 退避重试，而走既有确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 补齐上述 reason，`failure_class=impact_contract_invalid`）：`impact_anchor_missing` → 一次 `spawn:generator_fix`（detail 携 `unclaimed_files`），仍失败 → `wait:human_review`；`capability_assertion_coverage_missing` → 直接 `wait:human_review`。
   - `orchestrator_decision_log` 新增行 `gate_verdict='deny:impact:impact_anchor_missing'`、`detail.impact_gate.retryable=false`、`detail.impact_gate.unclaimed_files` 非空。

## 边界情况

- 同一候选同时命中多个 reason_code：按确定性 > 真新鲜度优先级取确定性结论（fail-closed，不回退可重试）。
- `mapperResult.freshness` 缺失 / 结构异常 → 归入 (c) 未知，fail-closed `mapper_contract_invalid`。
- `unclaimed_files` 为空但 reason=`impact_anchor_missing`：仍 blocked，detail 记录空清单（不崩）。

## 范围限定

**在范围内**：`packages/brain/src/impact-contract/diff-gate.js`、`harness-gates.js` beforeEvaluate、`orchestrator/loop.js`、`orchestrator/derive.js` 的确定性出口路由；Brain semver 四处同步 + DevGate 三项。
**不在范围内**：不放宽 `radius.js` 的无主文件/断言覆盖判定规则（radius 结论本身正确）；不改 `map-client.js assertMapperContract`；不给 G1 补断言（另立 Map 覆盖任务）；不复活已死 run。

## 假设

- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 本身不再触发 `impact_anchor_missing`；回归夹具用 d1360a48 历史录制件复现旧行为，不依赖当前 manifest。]
- [ASSUMPTION: `DETERMINISTIC_IMPACT_ERROR_CODES` 集合在 orchestrator 侧已存在或可新增，用于 derive 路由判定。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：201-207 三类分流 + detail 透传（核心）
- `packages/brain/src/impact-contract/harness-gates.js`：beforeEvaluate gateReceipt 透传 reason/retryable/detail
- `packages/brain/src/orchestrator/loop.js`：retryable:false 不退避重试
- `packages/brain/src/orchestrator/derive.js`：DETERMINISTIC_IMPACT_ERROR_CODES 补集合 + 路由 generator_fix / human_review
- `packages/brain/package.json` 等版本四处：semver bump

## Response Schema

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空；以下为 PrepPRD（task 描述）显式值 -->
- 超时/延迟: 确定性结论必须 fail-closed（retryable:false），禁止把不可重试结论折叠成 90s 无限重试
- 频控: 无
- 版本要求: Brain semver 四处同步 + DevGate 三项（facts-check / check-version-sync / check-dod-mapping）
- 可观测: 确定性 blocked 必须写入 `orchestrator_decision_log`，含 gate_verdict + detail.impact_gate（retryable / unclaimed_files / capability_ids）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 line step/journey_feature 级暂无） -->
- [Kernel evaluator clock] 保留 validation_clock_required 默认 fail-closed；缺失或不一致一律拒绝（来源: area）
- [generator retry identity] 基础设施失败必须重试原始服务端派发动作，首次 generator 重派 generator、generator-fix 重派 generator-fix（来源: area）
- [planner role branch] Planner workspace 必须停在服务端签发的 planner_branch，Provider 不得 checkout/switch 分支（来源: area）
- [Fleet Brain URL] 本地 Dispatcher 与 Fleet Worker 必须注入服务端权威 HARNESS_BRAIN_URL，预检 fail-closed，禁手工绕过（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将按 local_api 填入 curl + psql 脚本
# 期望验收点（自然语言）：
# 1. 单测 diff-gate：mapper 返回 freshness.status='unknown'+reason_code='impact_anchor_missing'+unclaimed_files=['DoD.md']
#    → gate='blocked' / reason='impact_anchor_missing' / retryable=false / detail.unclaimed_files=['DoD.md']；
#    reason_code='capability_assertion_coverage_missing' → reason 同名 / retryable=false；
#    status='stale'+reason_code='fact_snapshot_stale' → 仍 impact_unknown / mapper_stale / retryable=true（回归）。
# 2. 单测 harness-gates beforeEvaluate：上述 blocked 结果 gateReceipt 含 reason/retryable/detail。
# 3. 单测 loop.js/derive：impact retryable=false + reason=impact_anchor_missing → 下一动作 spawn:generator_fix（detail 带 unclaimed_files）；
#    reason=capability_assertion_coverage_missing → wait:human_review。
# 4. 回归夹具：run d1360a48 真实 changed_files（含 DoD.md）+ 真实 radius 录制件 → 旧码 mapper_stale / 新码 blocked:impact_anchor_missing。
# 5. Final E2E（数据写入类，scratch 库）：对 scratch Brain POST 一条 evaluator 前置闸调用 →
#    psql 查 orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'
#    且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空。
# 注：合同冻结测试必须落在 sprints/08170841-kernel-f7bef8da/tests/（kernel 只认此目录采集冻结产物）；
#    永久回归测试由 Generator 复制到 packages/brain/src/**/__tests__/。
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain（kernel/orchestrator/impact-contract 后端），无 UI/agent 协议/engine。
## target_environment: local_api
## target_environment_reason: 后端闸门逻辑，E2E 走本地 evaluator（curl localhost:5221 + psql scratch orchestrator_decision_log）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
