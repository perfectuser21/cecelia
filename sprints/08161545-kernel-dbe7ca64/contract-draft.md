# Sprint Contract Draft (Round 1)

**journey_type**: autonomous
**target_environment**: local_api
**范围**: `packages/brain/src/impact-contract/diff-gate.js`（freshness 消费处三分类）、`packages/brain/src/impact-contract/harness-gates.js`（gateReceipt 透传 detail）、`packages/brain/src/orchestrator/loop.js`（DETERMINISTIC_IMPACT_ERROR_CODES 补齐 + 确定性 impact 出口路由）+ Brain semver 四处 + DevGate 三项。**不改** radius.js / map-client.js。

> 锚定父路声明：独立小路（无父路）。journey e6f803f2 golden-paths 现仅 planned 态 ability，无 done/working 父路可挂；本 sprint 为 Diff Impact Gate 消费方修复的独立内部路径。

> contract-gate: cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在 → 代码层 Contract Gate 生效，验证命令按 gate-clean 惯用法书写。

> Unified Map：task.payload.map_scope=['F1']，但 map_repo 缺失 → 无法调 `/api/brain/map/radius` 求半径，标 `[MAP_NOT_CONFIGURED]`（must_run_assertions 空）。本 sprint 改动全在消费方逻辑，回归约束由下方「已知约束」+ 冻结测试覆盖。

---

## Response Schema（推导来源: PRD 字面 + 现有 diff-gate.js 返回结构）

本 sprint 无新增 HTTP 端点；「Response Schema」指被改函数的返回契约（下游 loop.js/harness-gates 按此消费）。

### 契约 1: `evaluateDiffGate(...)` 返回值（diff-gate.js）

三类裁决（由 mapper freshness.reason_code 决定）：

**(b) 确定性结论 → blocked**：
```json
{ "gate": "blocked", "reason": "<原 reason_code>", "retryable": false,
  "detail": { "unclaimed_files": ["DoD.md"], "capability_ids": [] } }
```
- `gate` (string 字面 `"blocked"`, 必填)：确定性拒绝
- `reason` (string, 必填)：原样透传 mapper reason_code —— `impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous` 之一
- `retryable` (boolean 字面 `false`, 必填)：不可重试
- `detail.unclaimed_files` (string[], 必填)：来自 `mapperResult.unclaimed_files`（`impact_anchor_missing` 时非空）
- `detail.capability_ids` (string[], 必填)：来自 `mapperResult.affected_nodes[].capability_id`（`capability_assertion_coverage_missing` 时非空）

**(a) 真新鲜度问题 → impact_unknown/mapper_stale（回归保护，保持原样）**：
```json
{ "gate": "impact_unknown", "reason": "mapper_stale", "retryable": true }
```
- 触发 reason_code：`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`

**(c) 未知 reason_code → fail-closed**：
```json
{ "gate": "impact_unknown", "reason": "mapper_contract_invalid", "retryable": false }
```

**禁用字段名**（不得作为正向断言字段出现）：`stale`（作 reason 值时仅 mapper_stale 合法）、把确定性 reason_code 折叠成 `mapper_stale`。

### 契约 2: gateReceipt / impact_gate 受理单（harness-gates.js beforeEvaluate → loop.js 落库）

```json
{ "stage": "diff", "gate": "blocked", "reason": "impact_anchor_missing", "retryable": false,
  "contract_id": "<uuid|null>", "contract_hash": "<hash|null>",
  "detail": { "unclaimed_files": ["DoD.md"], "capability_ids": [] },
  "unclaimed_files": ["DoD.md"] }
```
- `detail` (object, 必填新增)：gateReceipt 必须**透传** `result.detail`（当前实现丢弃 → 本 sprint 补）
- `unclaimed_files` (string[], 必填新增)：从 `result.detail.unclaimed_files` 上提到受理单顶层，供运维按 `detail.impact_gate.unclaimed_files` 直接查询（PRD 可观测出口字面路径）

---

## Golden Path

[kernel beforeEvaluate 以候选 changed_files 调 mapper] → [diff-gate 按 reason_code 三分类] → [gateReceipt 透传 reason/retryable/detail] → [loop 对 retryable:false 走确定性出口路由 generator-fix/human_review，日志可判因]

### Step 1: kernel 以候选 changed_files 调 mapper，mapper 因确定性原因返回 unknown+reason_code
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步

**可观测行为**: mapper 在快照新鲜前提下，因候选含 Map 无主文件返回 `freshness={status:'unknown',reason_code:'impact_anchor_missing'}` 且 `unclaimed_files` 非空；或受影响能力零断言覆盖返回 `capability_assertion_coverage_missing`。

**验证命令**（冻结测试注入 mapper 录制响应，真实跑 diff-gate 分类）:
```bash
node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/diff-gate-classify.test.ts
```
**硬阈值**: 测试文件全绿（4 用例）。

### Step 2: diff-gate 三分类裁决
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 (a)/(b)/(c)

**可观测行为**:
- (b) 确定性结论 → `gate:'blocked', reason:<原 reason_code>, retryable:false`，`detail.unclaimed_files`/`detail.capability_ids` 携带证据。
- (a) 真新鲜度问题（`fact_snapshot_stale` 等五类）→ 保持 `impact_unknown/mapper_stale/retryable:true`。
- (c) 未知 reason_code → `impact_unknown/mapper_contract_invalid/retryable:false`。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/diff-gate-classify.test.ts sprints/08161545-kernel-dbe7ca64/tests/d1360a48-regression.test.ts
```
**硬阈值**: 5 用例全绿；`fact_snapshot_stale` 用例保持 mapper_stale/retryable:true（回归保护）。

### Step 3: gateReceipt 透传 reason/retryable/detail
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步

**可观测行为**: beforeEvaluate 返回的受理单含 `reason`/`retryable`/`detail`，且 `unclaimed_files` 上提到受理单顶层。当前实现只保留 reason/retryable、**丢弃 detail** → 修复后受理单含 detail。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/harness-gates-receipt.test.ts
```
**硬阈值**: 受理单 `detail.unclaimed_files=['DoD.md']` 且 `receipt.unclaimed_files=['DoD.md']`。

### Step 4: loop 对 retryable:false 走确定性出口路由
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步

**可观测行为**: `DETERMINISTIC_IMPACT_ERROR_CODES` 补齐六个确定性 reason；`routeDeterministicImpact` 按 reason 路由——`impact_anchor_missing` 首次 → `spawn:generator-fix`（detail 带 unclaimed_files），已试过一次仍同结论 → `wait:human_review`；`capability_assertion_coverage_missing` → 直接 `wait:human_review`；`retryable:true` 的真新鲜度结论 → 返回 null（不走确定性出口，交既有重试）。不再对确定性结论做 90s 无限重试。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run sprints/08161545-kernel-dbe7ca64/tests/loop-impact-route.test.ts
```
**硬阈值**: 5 用例全绿；动作字面量 `spawn:generator-fix` / `wait:human_review` 与系统既有常量一致。

### Step 5（出口）: 确定性拒绝写进 orchestrator_decision_log，运维可判因
**来源**: `[FROM_PRD]` — PRD「可观测出口」+ NFR「可观测」

**可观测行为**: orchestrator_decision_log 新增行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.unclaimed_files` 非空。

**验证命令**: 见 `## E2E 验收`（local_api scratch 库）。
**硬阈值**: 命中行存在且字段满足。

---

## 已知约束（来自回归测试 + 累积 FR + 铁律）

- [radius.js baseFreshness] fact_snapshot_stale / projection_revision_missing / projection_revision_mismatch 属真新鲜度 → 必须保持 retryable:true（回归保护）。
- [radius.js 派生] impact_anchor_missing / capability_not_in_active_projection / unsafe_assertion_ref / assertion_identity_ambiguous / capability_assertion_coverage_missing 是确定性结论（status:'unknown'），本 sprint 不改其产出，只改消费方分类。
- [diff-gate.js 现有] mapper 不可达（`mapper_unavailable`）、revision/digest mismatch 保持现有 retryable:true fail-closed，本 sprint 不动。
- [累积FR] 本 line（journey e6f803f2）golden-paths 现仅 planned 态 ability，无 done/working 历史行为可回退（context-manifest: 无历史累积 FR）。
- [MAP_NOT_CONFIGURED] map_repo 缺失，must_run_assertions 空。

### 铁律 → INV 映射（三源之一，见 contract-dod.md INV 条目）

- [fail-closed] → INV-1（未知/无法判定 impact 结论 fail-closed，禁静默放行/无限重试）
- [不放宽规则] → INV-2（不改 radius 结论，只改消费方分类）
- [回归保护] → INV-3（fact_snapshot_stale 等五类保持 mapper_stale/retryable:true）
- [可判因] → INV-4（确定性拒绝透传 reason_code + unclaimed_files/capability_ids 进日志）

---

## 禁 mock 边清单

本单改动涉及**跨模块数据传递**（diff-gate → harness-gates 受理单 → loop 路由）与**状态机/生命周期钩子**（beforeEvaluate 前置闸 → 出口路由），故：

- diff-gate.js freshness 消费处 ↔ 其分类返回值：`diff-gate-classify.test.ts` / `d1360a48-regression.test.ts` 真实执行 `evaluateDiffGate`，只注入 mapClient（= radius.js HTTP 客户端，本 sprint 不改的外层边界，注入其录制响应合法）。
- harness-gates.js gateReceipt ↔ diff-gate 返回值透传：`harness-gates-receipt.test.ts` 真实执行 `beforeEvaluate`→`gateReceipt`，仅注入 getActiveContract（DB 读，未改）与 diffGate 返回值（分类逻辑另由 diff-gate 测试真实覆盖，此处只验受理单转发字段）。
- loop.js DETERMINISTIC_IMPACT_ERROR_CODES / routeDeterministicImpact：`loop-impact-route.test.ts` 真实 import 真实调用，不 mock。
- **无 DB 写路径被改**：本 sprint 改的是决策/路由逻辑，不新增/改写任何表写入，故单测层不需真 Postgres；DB 可观测出口（orchestrator_decision_log 行）由 E2E 在 scratch 真库上验（见下）。

---

## 真实调用方请求 shape

N/A —— 本 sprint 无「设备/agent 调服务端」链路，改动全在 Brain 内部 orchestrator 决策路径（mapper 由 diff-gate 内部调用，非外部调用方）。

## 未覆盖真实链路清单

- diff-gate/harness-gates/loop 三处单测注入 mapClient / diffGate 返回值 / getActiveContract（均为**未改的外层边界**，符合规则 C：radius.js、DB 读、diff-gate 分类逻辑分别由 radius 现有测试 / E2E / diff-gate 冻结测试真实覆盖，无一是被改边被 mock 顶替）。
- **接缝（logic-done-pending）**：orchestrator_decision_log 行在**真实 loop 派发**下产出——单测覆盖到「diff-gate 产出正确受理单 + 路由函数正确决策」，而「真实 loop 一次运行实际选中 generator-fix/human_review 并落库该行」由 E2E 在 scratch Brain 上验证（见 `## E2E 验收`）。E2E 通过前，Step 4→5 的真实 loop 落库标 `logic-done-pending`。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | diff-gate 按 mapper reason_code 三分类；确定性结论 blocked/retryable:false 携证据；受理单透传 detail；loop 对 retryable:false 走确定性出口而非无限重试 |
| **NFR（做得多好）** | | retryable:false 结论必须立即退出重试循环，不等 deadline；kernel 90s 重试节律不变但确定性结论一拍即出 |
| **Invariant（永不违反）** | | 见 INV-1..4：fail-closed / 不放宽 radius / 回归保护 / 可判因 |
| **判定点（怎么知道）** | | 见判定点登记表 |
| **保质期（何时过期）** | | DETERMINISTIC_IMPACT_ERROR_CODES 集合随 radius reason_code 演进；新增 radius reason_code 时须同步登记，否则走 (c) fail-closed（安全默认） |
| **死亡告警（停了谁知道）** | | 若分类回退（确定性结论又被折叠成 mapper_stale），表现为 run 再次 90s 空转到 deadline → run failed，kernel 监控可见；回归测试 fact_snapshot_stale 用例守住反向 |
| **失败语义（挂了怎么办）** | | 见失败语义声明：未知 reason_code fail-closed（拦截，不放行）；确定性结论不重试 |
| **效果确认（已发≠已生效）** | | orchestrator_decision_log 行 gate_verdict + detail.impact_gate.retryable/unclaimed_files 为回执；E2E psql 查得即生效 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ impact 结论是否可重试 | A. 一律按 freshness.status!=='fresh' 判 retryable:true; B. 按 mapper reason_code 分类，只有真新鲜度五类 retryable:true | B（按 reason_code 分类） | 确定性结论（无主文件/断言覆盖缺）重试不可能改变，A 会导致无限空转到 deadline | 误判 A→确定性结论被无限重试空转（本 bug）；误判 B→真新鲜度问题被过早 fail-closed 不重试。⚠️ 折叠确定性为可重试会静默烧掉整个 run deadline |
| 未知/新 reason_code 如何处置 | A. 静默放行; B. 当 mapper_stale 重试; C. fail-closed retryable:false | C（fail-closed） | 未知结论不可假绿也不可无限重试 | 误判 A→假绿漏过真实 impact 漂移；误判 B→无限空转 |

> ⚠️ 行「impact 结论是否可重试」误判后果严重（烧 run deadline），属升拍板级；但本 sprint 判定方法（按 reason_code 分类）由 PRD 与 radius.js 既有 reason_code 直接推导，PrepPRD 已明确，无需二次请教。judgment-pending-user: 无。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| mapper 返回未知 reason_code | fail-closed：impact_unknown/mapper_contract_invalid/retryable:false，拦截不派发 | 否（确定性，不重试） | 走确定性出口→human_review |
| mapper 不可达 | 保持现状 impact_unknown/mapper_unavailable/retryable:true | 是 | 既有退避重试 |
| impact_anchor_missing 首次 | spawn:generator-fix（带 unclaimed_files 让候选删/挪无主文件） | 否（仅一次） | 二次仍同结论 → human_review |
| capability_assertion_coverage_missing | 直接 wait:human_review（需人补断言，另立 Map 覆盖任务） | 否 | human_review |

### 输入对抗面

N/A —— 无对外暴露 agent；mapper reason_code 来自内部 radius.js 可信投影，非外部不可信输入。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，scratch 库）

> 本段全部命令按序拼接执行（evaluator 1.22.0）。单 bash 块。
> Fleet 注入 attempt 级空库 `DB_URL`；先跑仓库真实 migration bootstrap，再验 orchestrator_decision_log 出口行。
> 接缝声明：本 E2E 验证「diff-gate 真实分类产出确定性受理单」+「orchestrator_decision_log schema 真实落库该出口行（gate_verdict + detail.impact_gate.retryable/unclaimed_files）」。真实 loop 一次运行端到端选中 generator-fix/human_review 属 logic-done-pending，由路由单测（loop-impact-route.test.ts）在逻辑层锁定。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
RECEIPT_JSON=$(mktemp)
cleanup() { rm -f "$RECEIPT_JSON"; }
trap cleanup EXIT

# 1. 空库跑仓库真实 migration bootstrap，机检目标表存在
node packages/brain/src/migrate.js
psql "$DB_URL" -tAc "SELECT to_regclass('orchestrator_decision_log') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT to_regclass('initiative_runs') IS NOT NULL" | grep -qx t

# 2. 真实跑 evaluateDiffGate（注入确定性 impact_anchor_missing 录制响应），产出受理单 JSON
node --input-type=module -e '
import { evaluateDiffGate } from "./packages/brain/src/impact-contract/diff-gate.js";
import { writeFileSync } from "node:fs";
const r = await evaluateDiffGate({
  taskId: "e2e-anchor",
  headRevision: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  changedFiles: ["DoD.md"],
  mapClient: async () => ({ freshness:{status:"unknown",reason_code:"impact_anchor_missing"}, affected_nodes:[], required_assertions:[], unclaimed_files:["DoD.md"] }),
});
if (r.gate !== "blocked" || r.reason !== "impact_anchor_missing" || r.retryable !== false) {
  console.error("FAIL: diff-gate 未产出确定性 blocked 受理单", JSON.stringify(r)); process.exit(1);
}
const receipt = { stage:"diff", gate:r.gate, reason:r.reason, retryable:r.retryable, detail:r.detail, unclaimed_files:r.detail?.unclaimed_files ?? [] };
writeFileSync(process.env.RECEIPT_JSON, JSON.stringify(receipt));
console.log("OK receipt", JSON.stringify(receipt));
'

# 3. 用真实受理单把确定性拒绝写进 orchestrator_decision_log（scratch 真库，append-only 真表）
RID=$(psql "$DB_URL" -tAc "INSERT INTO initiative_runs(initiative_id) VALUES(gen_random_uuid()) RETURNING id" | tr -d ' ')
psql "$DB_URL" -v receipt="$(cat "$RECEIPT_JSON")" -v rid="$RID" <<'SQL'
INSERT INTO orchestrator_decision_log(run_id, hop, observed, derived_phase, gate_verdict, action, detail)
VALUES (
  :'rid', 1, '{}'::jsonb, 'evaluate',
  'deny:impact:' || ((:'receipt')::jsonb ->> 'reason'),
  'wait:human_review',
  jsonb_build_object('reason','impact_gate_deterministic','impact_gate',(:'receipt')::jsonb)
);
SQL

# 4. psql 断言：出口行存在且字段满足（gate_verdict / retryable=false / unclaimed_files 非空）
psql "$DB_URL" -tAc "SELECT 1 FROM orchestrator_decision_log WHERE run_id='$RID' AND gate_verdict='deny:impact:impact_anchor_missing' AND (detail->'impact_gate'->>'retryable')='false' AND jsonb_array_length(detail->'impact_gate'->'unclaimed_files') > 0" | grep -qx 1 || { echo "FAIL: orchestrator_decision_log 出口行缺失或字段不符"; exit 1; }

echo "✅ local_api E2E：确定性 impact 拒绝出口行落库且可判因"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapper 返回 `freshness` 缺失 / `freshness.status` 为 `undefined` / reason_code 为 null → 应走 (a) 保持 mapper_stale（不得崩溃或漏成 blocked）
- 重复提交: 同一确定性结论连续两轮 → 第二轮不得再次 spawn:generator-fix，须收敛 human_review（无二次抖动）
- 中途中断: routeDeterministicImpact 传入 retryable:true + 确定性 reason（矛盾输入）→ 以 retryable 为准返回 null，不误路由
- 边界值: unclaimed_files 为空数组的 impact_anchor_missing（理论上不该发生）→ detail.unclaimed_files=[]，仍 blocked/retryable:false，不崩
发现分级: P0/P1（把确定性折叠回可重试 / fail-closed 失效放行）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 三分类 | `tests/diff-gate-classify.test.ts` | `impact_anchor_missing 分类为 blocked` / `capability_assertion_coverage_missing 分类为 blocked` / `fact_snapshot_stale 保持 impact_unknown` / `未知 reason_code fail-closed` | 3 failed（stale 用例 1 passed 回归保护） |
| harness-gates 受理单 | `tests/harness-gates-receipt.test.ts` | `gateReceipt 含 reason retryable detail` | receipt.detail undefined → FAIL |
| loop 确定性出口路由 | `tests/loop-impact-route.test.ts` | `DETERMINISTIC_IMPACT_ERROR_CODES 覆盖新确定性 reason` / `impact_anchor_missing retryable false 首次路由到 spawn generator-fix` / `二次仍失败收敛到 wait human_review` / `capability_assertion_coverage_missing 直接路由到 wait human_review` / `retryable true 的真新鲜度结论不走确定性出口` | routeDeterministicImpact is not a function → FAIL |
| d1360a48 回归夹具 | `tests/d1360a48-regression.test.ts` | `录制件经新代码判为 blocked impact_anchor_missing` | 现返回 mapper_stale → FAIL |
