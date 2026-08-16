# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 确定性出口

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类会烧穿 validation deadline 的无限重试假象，提升 harness 可信度）

## 背景

08-15 20:08 起两条生产 run（f62c7e87 / d1360a48）同病：Generator 已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（空转 130+/80+ 跳）。但 Map 本身新鲜（`GET /api/brain/map?scope=cecelia` 全部 snapshots fresh）。根因是 `diff-gate.js` 只判 `freshness.status !== 'fresh'` 就折叠成 `mapper_stale`，丢掉 `reason_code`——把 radius 给出的**确定性**结论（无主文件 `impact_anchor_missing`、能力无断言覆盖 `capability_assertion_coverage_missing`）误标为可重试，人看到的永远是 mapper_stale。关联失败终态：run 92ba4ae5「validation_clock_expired_before_evaluate」即同源。

## Golden Path（核心场景）

系统从 [kernel 在 spawn:evaluator 前调用 Diff Impact Gate] → 经过 [按 reason_code 三分类判定] → 到达 [确定性结论走 fail-closed 出口，不再无限重试]

具体：
1. [触发] Generator 已产出本地候选，kernel `beforeEvaluate` 调用 Diff Impact Gate，mapper 返回 `freshness`（含 `status` + `reason_code`）及 `unclaimed_files` / 受影响 capability。
2. [系统处理] diff-gate 区分三类：
   - (a) **真新鲜度问题**（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护，可重试）。
   - (b) **确定性结论**（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，并把 `unclaimed_files` 与缺覆盖的 `capability_ids` 放进结果 `detail`。
   - (c) **其余未知 reason_code** → fail-closed：`gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
3. [系统处理] `harness-gates.js` beforeEvaluate 的 gateReceipt 透传 `reason` / `retryable` / `detail`（含 unclaimed_files、缺覆盖 capability_ids）进决策日志。
4. [系统处理] `loop.js` / `derive.js` 对 `retryable:false` 的 impact 结论不再按 infrastructure_blocked 退避重试，走既有确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 补上述 reason，`failure_class=impact_contract_invalid`）：`impact_anchor_missing` → `spawn:generator_fix` 一次（detail 携带 unclaimed_files 清单），仍失败 → `wait:human_review`；`capability_assertion_coverage_missing` → `wait:human_review`。
5. [可观测结果] `orchestrator_decision_log` 新增行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.unclaimed_files` 非空；kernel 不再重试到 deadline。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 同一候选同时命中确定性结论与真新鲜度问题：真新鲜度优先按 (a) 可重试（新鲜度修好后 reason_code 可能自然消失），确定性判定不吞真新鲜度。
- mapper 返回未在任一集合内的新 reason_code：走 (c) fail-closed，不静默放行、不无限重试。
- `impact_anchor_missing` 的 generator_fix 兜底只允许一次；第二次仍 blocked → human_review，避免 fix↔gate 新循环。
- 空 `unclaimed_files` / 空 `capability_ids`：detail 字段存在但为空数组，不得因缺字段崩溃。

## 范围限定

**在范围内**：`packages/brain` 内 `impact-contract/diff-gate.js`（三分类）、`impact-contract/harness-gates.js`（gateReceipt 透传）、`orchestrator/loop.js` + `orchestrator/derive.js`（retryable:false 确定性出口路由）、Brain semver 四处同步、DevGate 三项。

**不在范围内**：放宽 radius 的无主文件/断言覆盖规则；给能力 G1 补断言（另立 Map 覆盖任务）；复活已死 run；改 `radius.js` / `map-client.js`（结论本身正确，错在消费方）。

## 假设

- [ASSUMPTION: task payload 无 thin_prd，以 task.description 作为 PrepPRD 主源锚定 scope。]
- [ASSUMPTION: F1 Map（map_scope=["F1"]，map_repo 缺失）当前 `GET /api/brain/map?scope=F1` 返回空，非本 sprint 阻塞项；实现验证以 scope=cecelia 的新鲜 Map 与录制件为准。]
- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 不再触发 impact_anchor_missing；回归夹具用 run d1360a48 录制的真实 radius 响应复现旧/新行为。]
- [ASSUMPTION: 合同冻结测试放 `sprints/08162246-kernel-e16b60d2/tests/`（r2 硬要求）；永久回归测试由 Generator 复制进 `packages/brain/src/**/__tests__/`。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 三分类判定，透传 reason_code / retryable / detail。
- `packages/brain/src/impact-contract/harness-gates.js`: beforeEvaluate gateReceipt 透传 reason / retryable / detail。
- `packages/brain/src/orchestrator/loop.js`: `DETERMINISTIC_IMPACT_ERROR_CODES` 补充确定性 reason；retryable:false 不退避重试。
- `packages/brain/src/orchestrator/derive.js`: 按 reason 路由 spawn:generator_fix / wait:human_review。
- `packages/brain/package.json`（+ 版本四处同步）: Brain semver bump。
- `sprints/08162246-kernel-e16b60d2/tests/`: 合同冻结测试（diff-gate / harness-gates / loop / derive 单测 + d1360a48 回归夹具）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task/ability 均空）+ task.description 显式约束，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；本 sprint 目标即消除 validation deadline 被无限重试烧穿）
- 频控: 确定性结论 retryable:false，禁止 90s 循环重试
- 版本要求: Brain semver 四处同步（package.json / DEFINITION 等），DevGate 三项必过
- 可观测: 闸决策必须写入 `orchestrator_decision_log`（`gate_verdict` + `detail.impact_gate.{reason,retryable,unclaimed_files,capability_ids}`），运维可从日志直接判因

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本 task 为空）；全量注入核心系统铁律 + 与本 sprint 直接相关的 harness 铁律 -->
- [真环境验证才算done] 功能验收必须验证真实产出效果，不能仅凭"测试通过"收尾（来源: area）
- [禁写死环境假设] 禁止写死环境假设值（来源: area）
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [测试默认多租户] 测试默认多租户（来源: area）
- [凭据安全] API Key/Token/密钥不入 git（来源: area）
- [日志脱敏] 日志脱敏（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [租户隔离] 记忆/数据按租户隔离（来源: area）
- [planner分支] planner 使用服务端签发的 PLANNER_BRANCH，禁止自行 checkout（来源: area）
- [合同测试落位] 合同冻结测试必须落 sprints/<sprint_dir>/tests/，vitest 对 include 范围外路径绿态也 exit 0，合同验证命令须实跑确认 exit code 语义（来源: area）
- [fail-closed语义一致] 同一语义（如判变/新鲜度）在判变端与消费端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史：journey e6f803f2 下 ability 均为 planned，无 done/working 已验收行为）

## E2E 验收

> Planner 初稿此区块留占位 + 期望验收点自然语言描述；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost + psql）填入 contract-draft.md。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl scratch Brain + psql scratch 库）
# 期望验收点（自然语言）：
#  1. 对 scratch Brain POST 一条 evaluator 前置闸调用，命中 impact_anchor_missing 场景（候选含无主文件）。
#  2. psql 查 orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'。
#  3. 该行 detail.impact_gate.retryable = false。
#  4. 该行 detail.impact_gate.unclaimed_files 非空。
#  5. 对照旧代码同输入返回 mapper_stale/retryable=true（回归夹具复现新旧差异）。
```

## journey_type: autonomous
## journey_type_reason: 改动仅在 packages/brain/（impact-contract + orchestrator），纯后端调度/决策链路，无 UI/agent 协议/engine hooks。
## target_environment: local_api
## target_environment_reason: 仅 packages/brain 纯后端，E2E 为 curl localhost:5221 + psql scratch 库验证 orchestrator_decision_log 落行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定 step_id）
