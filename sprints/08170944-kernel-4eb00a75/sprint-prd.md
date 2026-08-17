# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 出口（确定性 Map 结论不再折叠成 mapper_stale 无限重试）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类无限重试到 deadline 的空转，止血两条生产 run 同病）

## 背景

08-15 20:08 起两条生产 run 同病（run f62c7e87 / task 93cbbb32 OWNERS，run d1360a48 / task 0ca4b234 有头签发口）：Generator 已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 却持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试直到 deadline（分别空转 130+/80+ 跳）。而 Map 本身新鲜（`GET /api/brain/map?scope=cecelia` 全 snapshots fresh）。根因：mapper 在快照新鲜前提下写出的**确定性**结论（`impact_anchor_missing` / `capability_assertion_coverage_missing`）被消费方只按 `freshness.status !== 'fresh'` 一刀切标成 `mapper_stale, retryable:true`，丢掉 `reason_code`，把不可能靠重试改变的结论标成可重试。

## Golden Path（核心场景）

kernel 从 [Generator 产出本地候选] → 经过 [Diff Impact Gate 按 reason_code 分类判定] → 到达 [确定性结论走 fail-closed 出口并路由到 generator-fix 或 human_review，不再无限重试]

具体：
1. Generator 产出本地候选后，kernel 在 `spawn:evaluator` 前调用 Diff Impact Gate（`harness-gates.js` beforeEvaluate → `impact-contract/diff-gate.js`）。
2. mapper（`map/radius.js` resolveImpactRadius，快照新鲜）返回带 `reason_code` 的结论。diff-gate 按三类分流：
   - (a) 真新鲜度问题（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护，可重试改变）。
   - (b) 确定性结论（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，并把 `unclaimed_files` 与缺覆盖的 `capability_ids` 放进结果 `detail`。
   - (c) 其余未知 reason_code → fail-closed `gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
3. `harness-gates.js` beforeEvaluate 的 gateReceipt 透传 `reason` / `retryable` / `detail`；`loop.js` 对 `retryable:false` 的 impact 结论不再按 `infrastructure_blocked` 退避重试，而走既有确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 集合补入上述 reason，`failure_class=impact_contract_invalid`）。
4. derive 按 reason 二选一路由：`impact_anchor_missing` → `spawn:generator_fix` 一次（detail 携带 `unclaimed_files` 清单），仍失败 → `wait:human_review`；`capability_assertion_coverage_missing` → `wait:human_review`。
5. 可观测出口：`orchestrator_decision_log` 新增行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.unclaimed_files` 非空；kernel 不再 90s 空转到 deadline。

## 边界情况

- mapper 返回未在 (a)/(b) 枚举内的新 reason_code → 走 (c) fail-closed（`mapper_contract_invalid, retryable:false`），不得静默放行、不得回退可重试。
- 同一候选既触发无主文件又触发缺覆盖能力 → 以 reason 优先级确定单一 derive 动作（`impact_anchor_missing` 先走 generator-fix；`capability_assertion_coverage_missing` 走 human_review）。
- Map manifest 已升 v3（F1 认领仓库根 `DoD.md`），生产上 `DoD.md` 不再触发 `impact_anchor_missing`；回归夹具用 run d1360a48 真实 changed_files + 真实 radius 响应**录制件**复现，不依赖 live manifest。

## 范围限定

**在范围内**：仅 `packages/brain` 的消费方修复——`impact-contract/diff-gate.js` 三类分流、`harness-gates.js` beforeEvaluate gateReceipt 透传、`loop.js`/derive 对 `retryable:false` 的确定性出口与路由、Brain semver 四处同步 + DevGate 三项。
**不在范围内**：不放宽 `radius.js` 的无主文件/断言覆盖规则（结论本身正确）；不改 `map-client.js` assertMapperContract；不给能力 G1 补断言（另立 Map 覆盖任务）；不复活已死 run。

## 假设

- [ASSUMPTION: 合同冻结测试文件放在 `sprints/08170944-kernel-4eb00a75/tests/`（r2 硬要求：前一单因放 `packages/brain/src/**/__tests__/` 致 `force_approve_but_contract_artifacts_missing`）；永久回归测试由 Generator 在实现阶段复制到 `packages/brain/src/**/__tests__/`。]
- [ASSUMPTION: derive/路由逻辑与 `DETERMINISTIC_IMPACT_ERROR_CODES` 集合位于 `loop.js` 或其同目录 derive 模块；Proposer 在 Step 1 核对真实文件位置后锚定。]
- [ASSUMPTION: gate 结果对象字段名（`gate` / `reason` / `retryable` / `detail.unclaimed_files` / `detail.capability_ids`）由 Proposer 读现有 diff-gate.js 契约后 codify 成机检 oracle。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 三类 reason_code 分流（原只判 `freshness.status !== 'fresh'`）
- `packages/brain/src/harness-gates.js`: beforeEvaluate gateReceipt 透传 reason/retryable/detail
- `packages/brain/src/loop.js`（含 derive 路由）: `retryable:false` 确定性出口 + `DETERMINISTIC_IMPACT_ERROR_CODES` + 按 reason 路由 generator-fix / human_review
- `packages/brain/package.json` 及版本四处同步点: Brain semver bump
- `sprints/08170944-kernel-4eb00a75/tests/`: 合同冻结测试（diff-gate / harness-gates / loop-derive 单测 + 回归夹具）

## Response Schema

<!-- gate 结果对象为下游 kernel 消费的确定性契约；由 Proposer 在 Step 1.1 读现有 diff-gate.js/impact 契约后 codify 成机检 oracle（字段名/枚举值锁死）。Planner 只框定需固化的字段：gate ∈ {impact_unknown, blocked}，reason（原 reason_code 或 mapper_stale/mapper_contract_invalid），retryable(bool)，detail.impact_gate.{unclaimed_files[], capability_ids[]}。 -->

## NFR 约束

<!-- 来源: decisions 表 category=nfr 双源查询均为空数组；以下取自 PrepPRD 显式约束 -->
- 超时/延迟: 不新增；本 sprint 目标是消除现有 90s×N 无限重试到 deadline 的空转
- 失败语义: fail-closed —— 未知 reason_code 一律 `retryable:false`，禁止静默放行或回退可重试
- 可观测: gate 决策必须写 `orchestrator_decision_log`（gate_verdict + detail.impact_gate.reason/retryable/unclaimed_files/capability_ids），运维可从日志判因
- 版本要求: Brain semver 四处同步 + DevGate 三项（facts-check / check-version-sync / check-dod-mapping）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将填入 local_api 真实脚本（curl localhost:5221 前置闸调用 + psql 查 orchestrator_decision_log）
# 期望验收点（自然语言）：对 scratch 库 Brain POST 一条 evaluator 前置闸调用，模拟 mapper 返回
#   {freshness:{status:'unknown',reason_code:'impact_anchor_missing'}, unclaimed_files:['DoD.md']} →
#   psql 查 orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'，
#   且 detail.impact_gate.retryable=false，detail.impact_gate.unclaimed_files 非空；
#   kernel 不再对该结论按 infrastructure_blocked 退避重试。
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain/（kernel 消费方后端逻辑），无 UI/agent 协议/engine 路径 → autonomous
## target_environment: local_api
## target_environment_reason: payload 显式 local_api；Brain 内部纯后端，Final E2E 用 curl localhost:5221 + psql 查 scratch 库 orchestrator_decision_log
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 两源为空；以下为 area 级中与本 Brain 修复直接相关者（area 级另有大量 capture-triage learning 未逐条注入） -->
- [真环境验证] 真环境验证才算 done——E2E 必须实查 orchestrator_decision_log 真行，不凭"测试通过"收尾（来源: area）
- [禁写死环境] 禁止写死环境假设值（DB_NAME/端口/reason 集合等来自同一解析逻辑）（来源: area）
- [失败写库看语义] 通知/写库成功判定看语义字段（retryable/gate_verdict），不只 grep ok:true（来源: area）
- [status枚举全仓核对] DoD/测试里 status/枚举硬编码断言，GAN 新增值（如 gate='blocked'、新 reason_code）时做一次全仓库核对（来源: area）
- [vitest范围外绿态] 合同验证命令必须实跑确认 exit code：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 0，冻结测试须确认真被收集执行（来源: area）
- [Test Contract格式] Test Contract 表格固定 4 列，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [Red commit精确add] Red commit 必须只 git add 精确 test 路径（*.test.*），禁止 git add . / git add .harness（来源: area）
- [evaluator脚本会话独享] evaluator/E2E 临时脚本落会话独享路径（含 session id），禁共享 /tmp 固定文件名（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [租户隔离] 记忆/数据按租户隔离，测试默认多租户（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths，done/working 过滤后为空（返回 ability 均为 planned 状态） -->
- （本 line 暂无历史）
