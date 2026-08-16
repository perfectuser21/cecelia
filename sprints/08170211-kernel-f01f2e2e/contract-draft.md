# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传 reason_code + fail-closed 出口（r8）

> 锚定父路声明：**独立小路（无父路）** — kernel 编排层缺陷修复；journey e6f803f2 现存 ability 均 planned 态，无已验收父路可锚定。
> gp-anchor: skipped (product-map.json not found) — 当前仓库 cecelia 无 `product-map/generated/product-map.json`。
> contract-gate: present (cecelia) — `packages/brain/src/lib/contract-gate.js` 存在，代码层 Contract Gate 生效；本合同断言按速查表惯用法书写（curl 均带 -f、psql 计数带时间窗/定点读、无 `|| true` 吞错）。

## Unified Map 半径（Step 1.0）

- [MAP_NOT_CONFIGURED]：本 proposer 会话为 fleet-worker，Brain API `localhost:5221` 不可达，未能拉取 `payload.map_scope` / radius。本单为 kernel 编排层内部缺陷修复，影响半径即被改的 `diff-gate.js` / `harness-gates.js` / `loop.js` / `derive.js` 四模块本身（见"预期受影响文件"）；`radius.js` 结论正确不改。`must_run_assertions` 未知，按本合同 B-01..B-05 覆盖。

## Response Schema（推导来源: PRD 明确 + 现有 diff-gate.js 返回体）

本单无 HTTP 端点，Response Schema 指 `evaluateDiffGate()` 的返回对象契约（内部合同）与 `beforeEvaluate` 的 gateReceipt 契约。

### evaluateDiffGate() 返回（freshness.status !== 'fresh' 分支）

三类结论（按 `mapperResult.freshness.reason_code` 分类）：

```json
// (a) 真新鲜度问题（可重试）
{"gate": "impact_unknown", "reason": "mapper_stale", "retryable": true}
// (b) 确定性结论（不可重试，带 detail）
{"gate": "blocked", "reason": "<reason_code>", "retryable": false,
 "detail": {"unclaimed_files": ["..."], "capability_ids": ["..."]}}
// (c) 未知 reason_code（fail-closed，不可重试）
{"gate": "impact_unknown", "reason": "mapper_contract_invalid", "retryable": false}
```

- `gate` (string, 必填): (a)/(c)=`impact_unknown`；(b)=`blocked`
- `reason` (string, 必填): (a)=`mapper_stale`；(b)=原 `reason_code` 字面（`impact_anchor_missing` 等）；(c)=`mapper_contract_invalid`
- `retryable` (boolean, 必填): (a)=`true`；(b)/(c)=`false`
- `detail` (object, (b) 必填): `unclaimed_files`(string[]) + `capability_ids`(string[])

**分类集合（字面 ground truth，禁改名）**：
- STALE（→ mapper_stale/retryable:true）: `fact_snapshot_stale` `projection_revision_missing` `projection_revision_mismatch` `manifest_projection_mismatch` `graph_projection_revision_mismatch`
- DETERMINISTIC（→ blocked/retryable:false）: `impact_anchor_missing` `capability_assertion_coverage_missing` `capability_not_in_active_projection` `unsafe_assertion_ref` `assertion_identity_ambiguous`
- 其余任意 reason_code 或缺失 → (c) `mapper_contract_invalid`/retryable:false

**禁用字段名**：`stale`（不得把 (b) 的 reason 写成 `mapper_stale`）；`retry`（用 `retryable` 布尔）。

### beforeEvaluate() gateReceipt 契约（新增 detail 透传）

```json
{"stage": "diff", "gate": "blocked", "reason": "impact_anchor_missing",
 "retryable": false, "detail": {"unclaimed_files": ["DoD.md"], "capability_ids": []},
 "contract_id": "...", "contract_hash": "...", "head_revision": "..."}
```

- 新增 `detail` 字段：`gateReceipt()` 必须透传 `result.detail`（现状缺失 → `undefined`）。

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → Mapper 不可判定情形 fail-closed 返回 impact_unknown（本单在此基础上细分 reason_code，不得回退 fail-closed 原则）
- [packages/brain/src/impact-contract/__tests__/harness-gates.test.js] → beforeEvaluate/beforeMerge 各 gate 的 receipt 形态（本单只新增 detail 透传，不得破坏既有 stage/gate/reason 字段）
- [packages/brain/src/orchestrator/__tests__/derive.test.js] → derive 纯函数分支语义（新增 routeDeterministicImpact 纯函数，不得改动既有分支返回）
- [累积FR] context-manifest: unavailable（Brain API 不可达，本单为独立小路，无累积 FR 冲突）
- 回归保护硬条款：STALE 集合与 `manifest_projection_mismatch` 仍返回 `mapper_stale/retryable:true`（B-01 覆盖，防误伤真新鲜度重试路径）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR** | 系统对外承诺 | Diff Impact Gate 对确定性 Map 结论返回 blocked/retryable:false 并透传 reason_code+detail；确定性结论按 reason 路由 generator-fix/human_review，不再无限重试到 deadline |
| **NFR** | 性能/可靠性 | 确定性结论一次定谳（消除 90s×N 无限重试）；沿用 kernel 既有 gate 调用时延，无新增延迟预算 |
| **Invariant** | 永不违反 | fail-closed：任何未知/无法判定情形不得放行（(c) 分支）；append-only 决策日志不得 UPDATE/DELETE |
| **判定点** | 对模糊现实的判断 | 见"判定点登记表" |
| **保质期** | 何时过期 | 分类集合随 radius.js reason_code 枚举演进；新增 reason_code 未登记时由 (c) fail-closed 兜底，不静默放行 |
| **死亡告警** | 停了谁知道 | 确定性结论写 orchestrator_decision_log（gate_verdict + detail.impact_gate），运维可从决策日志判因；无独立告警渠道（N/A，日志即证据） |
| **失败语义** | 挂了怎么办 | 见"失败语义声明" |
| **效果确认** | 已发≠已生效 | orchestrator_decision_log 落行即生效证据（B-05 psql 回读断言 gate_verdict/retryable/unclaimed_files） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 某 reason_code 属"确定性结论"还是"真新鲜度问题" | A. 按 freshness.status; B. 按 reason_code 白名单分集 | B. reason_code 白名单分集（STALE / DETERMINISTIC / 其余 fail-closed） | status 粒度太粗（现状 bug 根因），reason_code 才是确定性 vs 可重试的真信号 | 误判为可重试 → 无限重试到 deadline（本单要修的现象）；误判为确定性 → 真新鲜度问题被过早 fail |
| 确定性结论后是否值得再派 generator-fix | A. 一律 human_review; B. 按 reason 分（anchor 可自愈→fix 一次） | B. impact_anchor_missing→generator-fix 一次（删/挪无主文件），coverage→直接 human_review | anchor 缺失候选可自修，coverage 需人补断言 | fix 无限重试 → 空转；一律 human_review → 可自愈的也惊动人 |

> judgment-pending-user: 无（两判定点均由 PRD/对齐会拍定，见 PRD 修法 A/B）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| mapper 返回未登记新 reason_code | (c) impact_unknown/mapper_contract_invalid/retryable:false，不放行 | 否（确定性，重试不改变结果） | fail-closed，交人工/上报，禁静默放行 |
| impact_anchor_missing 第二次仍失败 | wait:human_review（不回退避重试） | 是（generatorFixAttempts 计数幂等） | 一次 generator-fix 后落人审 |
| appendHop 写 orchestrator_decision_log 失败 | 抛错，run 由既有 deadline/blocked-streak 收敛 | 是（UNIQUE(run_id,hop) 幂等，重算同 hop 不双写） | 既有 append-only 约束保护 |

### 输入对抗面

N/A — 本单为 kernel 内部编排逻辑，无对外暴露 agent、无外部用户可写入接口；mapper 响应来自内部 radius/录制夹具，非对外输入面。

## Golden Path

[Generator 产出本地候选，kernel 调 Diff Impact Gate] → [gate 按 reason_code 三分类 + gateReceipt 透传 + loop/derive 确定性路由] → [确定性结论走 fail-closed 出口，不再无限重试；决策日志可判因]

---

### Step 1: diff-gate 按 reason_code 三分类
**来源**: `[FROM_PRD]` — PRD 第 19-22 行（修法 A）+ 第 91-94 行验收点 1 直接定义。

**可观测行为**: mapper 在快照新鲜前提下返回 `freshness.status !== 'fresh'` 时，`evaluateDiffGate` 不再一律 `mapper_stale`：确定性 reason_code → `blocked/retryable:false` + detail；真新鲜度 reason_code → `mapper_stale/retryable:true`；未知 reason_code → `mapper_contract_invalid/retryable:false`。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08170211-kernel-f01f2e2e/tests/diff-gate-reason-code.test.ts --config vitest.config.js --reporter=basic
# 期望：7 用例全过（含 impact_anchor_missing / coverage 的 blocked、fact_snapshot_stale/manifest 的回归、未知 reason 的 fail-closed、run d1360a48 夹具）
```

**硬阈值**: 该文件 7 用例全 PASS；exit 0。
**验证命令（硬阈值）**: 见 B-01 Test（带 false-green 守卫）。

---

### Step 2: harness-gates beforeEvaluate 透传 reason/retryable/detail
**来源**: `[FROM_PRD]` — PRD 第 23 行（修法 B 前半）+ 第 95 行验收点 2。

**可观测行为**: `beforeEvaluate` 对 blocked 结果产出的 gateReceipt 含 `reason` / `retryable:false` / `detail`（`detail.unclaimed_files` 或 `detail.capability_ids`）。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08170211-kernel-f01f2e2e/tests/harness-gates-receipt.test.ts --config vitest.config.js --reporter=basic
# 期望：2 用例全过（anchor / coverage 的 receipt.detail 透传）
```

**硬阈值**: 2 用例全 PASS；exit 0。

---

### Step 3: loop/derive 确定性路由（不再无限重试）
**来源**: `[FROM_PRD]` — PRD 第 23 行（修法 B 后半）+ 第 96-97 行验收点 3。
`[AI_ADDED]` 附加：新增 `derive.routeDeterministicImpact` 纯函数作为可单测接缝（理由：把"按 reason 路由 generator-fix/human_review"从 loop.js 副作用链里抽成纯函数，便于确定性验证，不改变 loop 既有 failure_class 语义）。

**可观测行为**: `loop.js` 的 `DETERMINISTIC_IMPACT_ERROR_CODES` 含 5 个确定性 reason（failure_class=impact_contract_invalid，retryable:false 不走 infrastructure_blocked 退避）；`routeDeterministicImpact` 把 `impact_anchor_missing` 首次路由 `spawn:generator-fix`（detail 带 unclaimed_files）、再失败与 `capability_assertion_coverage_missing` 等 → `wait:human_review`。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08170211-kernel-f01f2e2e/tests/impact-route.test.ts --config vitest.config.js --reporter=basic
# 期望：5 用例全过（DETERMINISTIC 集合成员 + 4 条路由）
```

**硬阈值**: 5 用例全 PASS；exit 0。

---

### Step 4: 确定性结论落 orchestrator_decision_log（可判因出口）
**来源**: `[FROM_PRD]` — PRD 第 23 行末 + 第 99-101 行验收点 5（数据写入类）。

**可观测行为**: 真实 diff-gate + harness-gates 产出确定性结论后，orchestrator_decision_log 落行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.detail.unclaimed_files` 非空。

**验证命令**: 见 ## E2E 验收（需 ${DB_URL} scratch 库）。
**硬阈值**: 决策日志新增 1 行且三字段满足；node 助手 exit 0。

---

## 禁 mock 边清单

本单改动涉及【状态机（gate 三分类判定）+ 跨模块数据传递（diff-gate→harness-gates→loop 决策日志）+ DB 写路径（orchestrator_decision_log）】，逐条列禁 mock 的边：

- **diff-gate 分类逻辑 ↔ mapper freshness 输出**：B-01/B-04 用真实 `evaluateDiffGate`，仅注入 mapper 响应（`radius.js` 不在本单改动范围，属"更外层无关依赖"——被改的分类逻辑真实执行，未被 mock）。
- **harness-gates gateReceipt ↔ diff-gate 结果**：B-05 E2E 用真实 `evaluateDiffGate` + 真实 `beforeEvaluate`（两条被改的边端到端真实执行，不 mock）；B-02 单测仅为隔离验证 receipt 透传，注入 diff-gate 结果（隔离层，端到端由 B-05 兜底）。
- **loop/derive 决策 ↔ orchestrator_decision_log（DB 写路径）**：B-05 用真 Postgres（${DB_URL}）+ 真实 `appendHop` 写真读，不 mock 该边。

> generator 实现测试中，命中以上边的 `vi.mock`/`stub` 即违约（CONTRACT IS LAW）。需真 PG 的 B-05 由 local_api evaluator（DB_URL 注入）执行。

## 未覆盖真实链路清单（mock 豁免登记）

- **radius/mapper HTTP 真调**：本单不测 radius.js（明确不改，结论正确）。B-01/B-04/B-05 用会话独享录制夹具 `tests/fixtures/run-d1360a48-radius.json` 注入 mapper 响应替代真调 radius。真验证补位：radius 自身行为由 `packages/brain/src/map/__tests__` 既有测试覆盖，非本单 scope。
- **loop.js 完整编排真跑**：B-05 用真实 diff-gate+harness-gates+appendHop 覆盖"确定性结论→决策日志"数据写入，但未拉起完整 runLoop 编排循环（gateVerdict 字符串按 loop.js 口径 `deny:impact:<reason>` 在 E2E 助手内复算）。真验证补位：generator 实现阶段把 loop.js 分支变更补进 `packages/brain/src/__tests__/integration/impact-contract-loop.integration.test.js`（永久回归，brain-integration 真 PG 跑）。

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 验证口径声明（INV local_api判定死锁 a0bac43b）：本单无 UI、无对外 smoke 端点，主 oracle 为 B-01..B-04 的真实代码路径冻结单测（不 mock 被改的边）+ 本 E2E 的真 Postgres 数据写入回读。judge 机械闸⑤（meta_verification_gap）对本 local_api/无 UI 任务应以本段声明的 DB 写入回读为验证依据。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 空库 bootstrap：跑仓库真实迁移，机检目标表存在（append-only 决策日志表）
node packages/brain/src/migrate.js
psql "$DB_URL" -tAc "SELECT to_regclass('public.orchestrator_decision_log') IS NOT NULL" | grep -qx t

# 2. 真实 diff-gate + harness-gates + 真 appendHop 写 orchestrator_decision_log，node 助手内回读断言
#    （gate_verdict='deny:impact:impact_anchor_missing' 且 detail.impact_gate.retryable=false 且 unclaimed_files 非空）
node sprints/08170211-kernel-f01f2e2e/tests/e2e/impact-decision-log.mjs

# 3. psql 复核同一行（防助手自证）：定点读该 run 的决策行三字段
LAST_RUN=$(psql "$DB_URL" -tAc "SELECT run_id FROM orchestrator_decision_log WHERE gate_verdict='deny:impact:impact_anchor_missing' ORDER BY id DESC LIMIT 1" | tr -d '[:space:]')
[ -n "$LAST_RUN" ] || { echo "FAIL: 无 deny:impact:impact_anchor_missing 决策行"; exit 1; }
psql "$DB_URL" -tAc "SELECT (detail->'impact_gate'->>'retryable') FROM orchestrator_decision_log WHERE run_id='$LAST_RUN' AND gate_verdict='deny:impact:impact_anchor_missing' ORDER BY id DESC LIMIT 1" | grep -qx false || { echo "FAIL: retryable != false"; exit 1; }
psql "$DB_URL" -tAc "SELECT jsonb_array_length(detail->'impact_gate'->'detail'->'unclaimed_files') FROM orchestrator_decision_log WHERE run_id='$LAST_RUN' AND gate_verdict='deny:impact:impact_anchor_missing' ORDER BY id DESC LIMIT 1" | grep -qE '^[1-9]' || { echo "FAIL: unclaimed_files 为空"; exit 1; }

echo "✅ Final E2E: orchestrator_decision_log 落确定性 impact 结论通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapper 返回 `freshness.status='unknown'` 但 `reason_code` 缺失/为 null → 必须走 (c) fail-closed `mapper_contract_invalid`，禁静默放行
- 边界值: `unclaimed_files` 为空但 `reason_code='impact_anchor_missing'` → detail.unclaimed_files 落 `[]`，仍 blocked/retryable:false（PRD 边界情况第 2 条）
- 重复触达: 同一 impact 结论重复进 gate + generator-fix 只重试一次 → 第二次确定性失败必须落 human_review，不得回退避重试（PRD 边界第 3 条）
- 中途中断: STALE 集合任一 reason（fact_snapshot_stale 等）必须仍 retryable:true（回归保护，防误伤真新鲜度）
发现分级: P0/P1（确定性结论被误判可重试 → 复现无限重试 / fail-closed 被绕过 → 静默放行）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 三分类 + 回归夹具 | `tests/diff-gate-reason-code.test.ts` | impact_anchor_missing → blocked、capability_assertion_coverage_missing、fact_snapshot_stale、mapper_contract_invalid、run d1360a48 | 已实测 RED：现状一律 mapper_stale/retryable:true（7 用例中 5 断言失败，2 回归守卫通过） |
| harness-gates receipt 透传 | `tests/harness-gates-receipt.test.ts` | receipt 含 reason / retryable:false / detail.unclaimed_files、detail.capability_ids | 已实测 RED：gateReceipt 不含 detail → detail undefined |
| loop/derive 路由 | `tests/impact-route.test.ts` | DETERMINISTIC 集合成员、impact_anchor_missing → spawn:generator-fix、wait:human_review | 已实测 RED：集合缺成员 + routeDeterministicImpact 未定义 |
| Final E2E 决策日志 | `tests/e2e/impact-decision-log.mjs` | orchestrator_decision_log 落 deny:impact:impact_anchor_missing | 需 ${DB_URL}（evaluator 执行） |

> RED 实测：`npx vitest run <三文件> --config vitest.config.js` → Tests 11 failed | 2 passed（2 passed = STALE 回归守卫）。
