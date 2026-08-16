# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 出口（r8）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 Diff Impact Gate 确定性结论被折叠成 mapper_stale 无限重试的死循环，止血在跑 run 的空转到 deadline）

## 背景

08-15 20:08 起两条生产 run（f62c7e87 / d1360a48）同病：Generator 已产出本地候选，`spawn:evaluator` 前的 Diff Impact Gate 却持续返回 `deny:impact:mapper_stale`（retryable:true），kernel 每 90s 重试到 deadline（130+/80+ 跳空转）。而 Map 本身新鲜（GET /api/brain/map?scope=cecelia 全部 snapshots fresh）。根因是 `diff-gate.js:201-207` 只判 `freshness.status !== 'fresh'` 就一律标 `mapper_stale/retryable:true`，把 radius.js 写进 freshness 的**确定性**结论（`impact_anchor_missing` / `capability_assertion_coverage_missing`）也当可重试，丢掉 reason_code，重试永远不可能改变结果。

## Golden Path（核心场景）

系统从 [Generator 产出本地候选，kernel 调 Diff Impact Gate] → 经过 [gate 按 reason_code 三分类 + gateReceipt 透传 + loop/derive 确定性路由] → 到达 [确定性结论走 fail-closed 出口，不再无限重试；决策日志可判因]

具体：
1. [触发条件] kernel 在 `spawn:evaluator` 前调用 `diff-gate.js`，mapper 在快照新鲜前提下返回 `freshness:{status:'unknown', reason_code:'impact_anchor_missing'}, unclaimed_files:['DoD.md']`（或 `capability_assertion_coverage_missing` + 缺覆盖 capability_ids）。
2. [系统处理] `diff-gate.js` 区分三类：
   - (a) 真新鲜度问题（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ 保持 `gate:'impact_unknown', reason:'mapper_stale', retryable:true`（回归保护）。
   - (b) 确定性结论（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `gate:'blocked', reason:<原 reason_code>, retryable:false`，并把 `unclaimed_files` 与缺覆盖 `capability_ids` 放进结果 `detail`。
   - (c) 其余未知 reason_code → fail-closed `gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false`。
3. [可观测结果] `harness-gates.js` beforeEvaluate 的 gateReceipt 透传 `reason/retryable/detail`；`loop.js` 把上述确定性 reason 补进 `DETERMINISTIC_IMPACT_ERROR_CODES`（failure_class=`impact_contract_invalid`），对 retryable:false 的 impact 结论不再按 infrastructure_blocked 退避重试，交 `derive.js` 路由：`impact_anchor_missing` → `spawn:generator_fix` 一次（detail 携带 unclaimed_files 清单），仍失败 → `wait:human_review`；`capability_assertion_coverage_missing` → 直接 `wait:human_review`。`orchestrator_decision_log` 落行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.unclaimed_files` 非空。

## 边界情况

- radius 返回未在白名单内的新 reason_code → 走 (c) fail-closed，禁止静默放行。
- unclaimed_files 为空但 reason_code=impact_anchor_missing → detail.unclaimed_files 落 `[]`，仍 blocked/retryable:false。
- 同一 impact 结论重复触达：generator_fix 只重试一次，第二次确定性失败必须落 human_review，不得回到退避重试。
- 并发 sprint 共用录制夹具时须落会话独享路径，禁止共享 /tmp 固定文件名。

## 范围限定

**在范围内**：`packages/brain/src/impact-contract/diff-gate.js`（三分类）、`harness-gates.js`（gateReceipt 透传）、`orchestrator/loop.js`（DETERMINISTIC_IMPACT_ERROR_CODES 补集 + 不退避）、`orchestrator/derive.js`（generator_fix / human_review 路由）；Brain semver 四处同步；DevGate 三项。
**不在范围内**：不放宽 radius 的无主文件/断言覆盖规则（radius.js 结论正确，不改）；不给能力 G1 补断言（另立 Map 覆盖任务）；`map-client.js::assertMapperContract` 不变；不复活已死 run。

## 假设

- [ASSUMPTION: 合同冻结测试文件必须放在 `sprints/08170211-kernel-f01f2e2e/tests/`（r2 硬要求；kernel 采集冻结产物只认此目录，放 `packages/brain/src/**/__tests__/` 会以 force_approve_but_contract_artifacts_missing 终态）。永久回归测试由 Generator 在实现阶段复制到 `packages/brain/src/**/__tests__/`。可原样复用上一单 f9f943fc 合同与测试内容。]
- [ASSUMPTION: Map manifest 已升 v3（F1 认领仓库根 DoD.md），DoD.md 不再触发 impact_anchor_missing；回归夹具用 run d1360a48 录制的旧 radius 响应件复现，而非实时 Map。]
- [ASSUMPTION: sprints/** 路径在 vitest include 范围外时绿态也可能是 exit 0 假绿，合同验证命令须实跑确认 exit code 语义（本 line invariant 052e10a0/c906dd6c）。]

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 双源均空）+ PrepPRD；无显式 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用 kernel 既有 gate 调用时延）
- 频控: 待定（本次修复即消除 90s 无限重试，确定性结论一次定谳）
- 版本要求: Brain semver bump 四处同步
- 可观测: 确定性 impact 结论必须写 `orchestrator_decision_log`，含 reason_code / retryable / unclaimed_files / capability_ids

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 ability 无 step/feature 级 invariant）-->
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [多租户] 测试默认多租户（来源: area）
- [凭据安全] API Key/Token/密钥不入 git（来源: area）
- [日志脱敏] 日志脱敏（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [租户隔离] 记忆/数据按租户隔离（来源: area）
- [枚举全仓grep] status/枚举硬编码断言在 GAN 新增状态值时须做一次全仓库 grep 核对（来源: area 052e10a0，本单新增 gate/reason 枚举直接命中）
- [exit语义实跑] 合同验证命令必须实跑确认 exit code 语义；vitest 对 include 范围外路径（sprints/**）绿态也 exit 0，须显式核验（来源: area c906dd6c）
- [local_api判定死锁] judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 任务会死锁，此类任务须在合同侧显式声明验证口径（来源: area a0bac43b）
- [judge结果结构] Brain judge `.brain-result.json` 必须有顶层 exit_code + log_tail + behavior_tests[]，每条含 exit_code + log_tail（来源: area de6a2ee1）
- [Red精确add] Red commit 只 git add 精确路径（*.test.*），禁止 git add . / git add .harness（来源: area 755fb846）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无已验收历史；journey e6f803f2 现存 ability 均为 planned 态）

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 步骤 3 三分类，确定性 reason_code → blocked/retryable:false + detail 透传（现 201-207 一律 mapper_stale/retryable:true）
- `packages/brain/src/impact-contract/harness-gates.js`: beforeEvaluate gateReceipt 透传 reason/retryable/detail 进决策日志
- `packages/brain/src/orchestrator/loop.js`: DETERMINISTIC_IMPACT_ERROR_CODES 补上述 reason，failure_class=impact_contract_invalid，retryable:false 不走 infrastructure_blocked 退避
- `packages/brain/src/orchestrator/derive.js`: 按 reason 路由 spawn:generator_fix（带 unclaimed_files）/ wait:human_review
- `packages/brain/src/map/radius.js`: 不变（结论正确，仅作参考）
- `packages/brain/src/impact-contract/map-client.js`: 不变
- `packages/brain/package.json`（+ 版本四处同步点）: semver bump
- `sprints/08170211-kernel-f01f2e2e/tests/`: 合同冻结测试（proposer 落此目录）

## E2E 验收

> Planner 初稿此区块留空占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + psql）写入 contract-draft.md。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql scratch 库）
# 期望验收点（自然语言）：
# 1) 单测 diff-gate：mapper 返回 {freshness:{status:'unknown',reason_code:'impact_anchor_missing'}, unclaimed_files:['DoD.md']}
#    → gate='blocked'、reason='impact_anchor_missing'、retryable=false、detail.unclaimed_files=['DoD.md']；
#    返回 capability_assertion_coverage_missing → reason 同名、retryable=false、detail 带缺覆盖 capability_ids；
#    返回 status:'stale',reason_code:'fact_snapshot_stale' → 仍 impact_unknown/mapper_stale/retryable=true（回归保护）。
# 2) 单测 harness-gates beforeEvaluate：blocked 结果 gateReceipt 含 reason/retryable/detail。
# 3) loop.js/derive 单测：impact retryable=false + reason=impact_anchor_missing → 下一动作 spawn:generator_fix（detail 带 unclaimed_files），
#    不再 wait/退避；reason=capability_assertion_coverage_missing → wait:human_review。
# 4) 回归夹具：run d1360a48 真实 changed_files（含 DoD.md）+ 真实 radius 响应录制件 → 旧代码 mapper_stale / 新代码 blocked:impact_anchor_missing。
# 5) Final E2E（数据写入类，scratch 库）：对 scratch Brain POST 一条 evaluator 前置闸调用，
#    psql 查 orchestrator_decision_log 新增行 gate_verdict='deny:impact:impact_anchor_missing'
#    且 detail.impact_gate.retryable=false 且 detail.impact_gate.unclaimed_files 非空。
```

## journey_type: autonomous
## journey_type_reason: 改动全部在 packages/brain（kernel 编排层 diff-gate/loop/derive），无 UI、无远端 agent 协议、非 engine hooks，纯后端自治链路
## target_environment: local_api
## target_environment_reason: payload.target_environment 显式指定 local_api；验证走本地 evaluator（curl localhost:5221 + psql scratch 库）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
