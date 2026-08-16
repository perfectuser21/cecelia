# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传 reason_code + fail-closed 出口

> **锚定父路声明**：独立小路（无父路）——kernel/harness 基础设施修复，非业务 Golden Path 步骤推进。
> **contract-gate**: cecelia worktree（`packages/brain/src/lib/contract-gate.js` 存在），本合同断言按 Contract Gate 惯用法速查表写 gate-clean。
> **gp-anchor**: skipped (product-map.json not found)

## Unified Map 影响半径

`[MAP_NOT_CONFIGURED]` — 本角色 checkout 运行时 `runtime_resources.postgres=false`，无法在 proposer 阶段调 `localhost:5221/api/brain/map`。影响半径以 PRD「预期受影响文件」+ 真实源码二分实证为准（radius.js:381-397 判定 + diff-gate.js:201-207 折叠点），`must_run_assertions` 由本合同冻结测试（tests/）承载。

## Response Schema（推导来源: PRD 字面 + 真实源码 radius.js/diff-gate.js/decision-log.js 核对）

本 sprint 无 HTTP 端点，Response Schema 指三处内部数据契约：

### 1. `evaluateDiffGate(...)` 返回对象（packages/brain/src/impact-contract/diff-gate.js）

**确定性 blocked（新增分支）**:
```json
{"gate": "blocked", "reason": "<deterministic_reason_code>", "retryable": false, "detail": {"unclaimed_files": ["<path>"], "capability_ids": ["<cap>"]}}
```
- `gate` (string 字面 `"blocked"`, 必填): 来源——PRD 修法 A(b)
- `reason` (string, 必填): 字面等于 mapper `freshness.reason_code`（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）
- `retryable` (boolean 字面 `false`, 必填): 确定性结论不可重试
- `detail.unclaimed_files` (string[], `impact_anchor_missing` 时): 透传 `mapperResult.unclaimed_files`
- `detail.capability_ids` (string[], `capability_assertion_coverage_missing` 时): 取自 `mapperResult.affected_nodes[].capability_id`

**真新鲜度可重试（回归保护，语义不变）**:
```json
{"gate": "impact_unknown", "reason": "mapper_stale", "retryable": true}
```
- 触发码：`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`

**未知 reason_code fail-closed（新增兜底）**:
```json
{"gate": "impact_unknown", "reason": "mapper_contract_invalid", "retryable": false}
```

**禁用字段名**（不得出现在正向断言里）: `mapper_stale`（用于确定性分支时属误分类）、`retryable:true`（用于确定性分支时属回退可重试）。

### 2. `beforeEvaluate(...)` gateReceipt（packages/brain/src/impact-contract/harness-gates.js）
```json
{"stage": "diff", "gate": "blocked", "reason": "impact_anchor_missing", "retryable": false, "detail": {"unclaimed_files": ["DoD.md"]}, "contract_id": "<uuid>", "contract_hash": "<sha256>"}
```
- 关键新增字段 `detail`（透传 `result.detail`，缺省 `null`）；`reason` / `retryable` 已有但确定性分支值必须来自 diff-gate 结果。

### 3. `orchestrator_decision_log` 行 detail（packages/brain/migrations/312）
```json
{"gate_verdict": "deny:impact:impact_anchor_missing", "detail": {"impact_gate": {"reason": "impact_anchor_missing", "retryable": false, "detail": {"unclaimed_files": ["DoD.md"]}}}}
```

## 已知约束（来自回归测试 + 累积 FR）

- [tests/diff-gate-reason-code.test.ts] → 真新鲜度 5 码仍 mapper_stale/retryable:true（回归保护，不得回退）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → FR-4 pass/extend/drift/fail-closed 语义不得破坏（mapper 不可达 → impact_unknown/retryable:true）
- [packages/brain/src/impact-contract/__tests__/harness-gates.test.js] → beforeEvaluate/beforeMerge 既有 receipt 字段（stage/gate/reason/retryable/contract_id/contract_hash）不得删除，只增 detail
- [累积FR] （本 line 暂无 done/working 历史，PRD 已声明）
- context-manifest: unavailable（postgres:false，proposer 阶段不可达 T3 端点）

---

## Golden Path

[Generator 产出本地候选，kernel 在 spawn:evaluator 前调 Diff Impact Gate] → [diff-gate 按 freshness.status/reason_code 分三类裁决 + harness-gates 透传 receipt + loop/derive 按 retryable 路由] → [确定性结论一次落 blocked 并路由 generator-fix 或 human_review，不再无限重试；决策日志可判因]

### Step 1: 候选含 Map 无主文件 → 确定性 blocked（impact_anchor_missing）
**来源**: `[FROM_PRD]` — PRD Golden Path 具体 1 + 修法 A(b)

**可观测行为**: mapper 返回 `freshness.status:'unknown', reason_code:'impact_anchor_missing', unclaimed_files:['DoD.md']` 时，diff-gate 返回 `gate:'blocked', reason:'impact_anchor_missing', retryable:false`，`detail.unclaimed_files=['DoD.md']`（不再折叠成 mapper_stale/retryable:true）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170326-kernel-a2ffdf00/tests/diff-gate-reason-code.test.ts --reporter=basic 2>&1 | grep -E "Test Files|passed|failed"
# 期望：Test Files 1 passed，无 failed
```
**硬阈值**: 该测试文件全绿（含 impact_anchor_missing 断言 + 空 unclaimed_files 边界不降级）；验证命令：`OUT=$(cd /workspace && npx vitest run sprints/08170326-kernel-a2ffdf00/tests/diff-gate-reason-code.test.ts --reporter=basic 2>&1); echo "$OUT" | grep -qE "Test Files +[0-9]+ passed" && ! echo "$OUT" | grep -qE "Tests +[0-9]+ failed"`

---

### Step 2: 受影响能力零断言 → 确定性 blocked（capability_assertion_coverage_missing）
**来源**: `[FROM_PRD]` — PRD Golden Path 具体 2 + 修法 A(b)

**可观测行为**: mapper 返回 `reason_code:'capability_assertion_coverage_missing'`（受影响能力如 G1 零断言）时，diff-gate 返回 `gate:'blocked', reason:'capability_assertion_coverage_missing', retryable:false`，`detail.capability_ids` 带受影响 capability_ids。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170326-kernel-a2ffdf00/tests/diff-gate-reason-code.test.ts -t "capability_assertion_coverage_missing" --reporter=basic 2>&1 | grep -E "passed|failed"
# 期望：1 passed
```
**硬阈值**: capability_assertion_coverage_missing 断言全绿；`capability_not_in_active_projection`/`unsafe_assertion_ref`/`assertion_identity_ambiguous` 同类落 blocked/retryable:false。

---

### Step 3: 真新鲜度问题 → impact_unknown/mapper_stale/retryable:true（回归保护）
**来源**: `[FROM_PRD]` — PRD Golden Path 具体 3

**可观测行为**: mapper 返回真新鲜度码（`fact_snapshot_stale` 等 5 码）时，diff-gate 仍返回 `impact_unknown/mapper_stale/retryable:true`（可重试语义不变，防误伤重试路径）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170326-kernel-a2ffdf00/tests/diff-gate-reason-code.test.ts -t "回归保护" --reporter=basic 2>&1 | grep -E "passed|failed"
# 期望：5 passed（当前基线即绿 = 回归护栏，实现后不得转红）
```
**硬阈值**: 5 个真新鲜度码全部保持 mapper_stale/retryable:true。

---

### Step 4: 未知 reason_code → fail-closed（mapper_contract_invalid/retryable:false）
**来源**: `[FROM_PRD]` — PRD Golden Path 具体 4 + 边界情况「未在既有集合内的新 reason_code 一律 fail-closed」

**可观测行为**: mapper 返回集合外新 reason_code → diff-gate 返回 `impact_unknown/mapper_contract_invalid/retryable:false`（禁止默认可重试）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170326-kernel-a2ffdf00/tests/diff-gate-reason-code.test.ts -t "fail-closed" --reporter=basic 2>&1 | grep -E "passed|failed"
# 期望：1 passed
```
**硬阈值**: 未知码 retryable=false 且 reason=mapper_contract_invalid。

---

### Step 5: gateReceipt 透传 reason/retryable/detail → 决策日志可判因
**来源**: `[FROM_PRD]` — PRD Golden Path 具体 5 + 修法 B

**可观测行为**: harness-gates beforeEvaluate 的 gateReceipt 对确定性 blocked 结果透传 `reason/retryable/detail`（detail 含 unclaimed_files / capability_ids）；orchestrator_decision_log 新增行 `gate_verdict='deny:impact:impact_anchor_missing'` 且 `detail.impact_gate.retryable=false` 且 `detail.impact_gate.detail.unclaimed_files` 非空。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170326-kernel-a2ffdf00/tests/harness-gates-receipt-detail.test.ts --reporter=basic 2>&1 | grep -E "Test Files|passed|failed"
# 期望：Test Files 1 passed
```
**硬阈值**: receipt.detail.unclaimed_files/capability_ids 非空透传；E2E psql 命中带 5 分钟时间窗的日志行（见 ## E2E 验收）。

---

### Step 6: retryable:false 走确定性出口（DETERMINISTIC_IMPACT_ERROR_CODES 集合），不再无限重试
**来源**: `[FROM_PRD]` — PRD 修法 B（`DETERMINISTIC_IMPACT_ERROR_CODES` 集合补齐 + `failure_class=impact_contract_invalid`）；`[AI_ADDED]` 常量集合从 loop.js 局部升为 constants.js 导出——理由：Invariant [同语义同策略] 要求判变端（diff-gate）与消费端（loop 路由）共用同一确定性码集合，禁止跨脚本分叉出假绿面。

**可观测行为**: `DETERMINISTIC_IMPACT_ERROR_CODES` 由 constants.js 导出，含全部确定性 reason（含新增 `mapper_contract_invalid`）；loop.js 据此对 `retryable:false` 的 impact 结论归 `failure_class=impact_contract_invalid`，走确定性出口（`impact_anchor_missing`→generator-fix 一次带 unclaimed_files，仍失败→human_review；`capability_assertion_coverage_missing`→直接 human_review），不再按 infrastructure_blocked 每 90s 退避重试到 deadline。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08170326-kernel-a2ffdf00/tests/deterministic-impact-codes.test.ts --reporter=basic 2>&1 | grep -E "Test Files|passed|failed"
# 期望：Test Files 1 passed
```
**硬阈值**: 集合含 6 个确定性码、不含 3 个可重试码；loop.js `import { DETERMINISTIC_IMPACT_ERROR_CODES } from './constants.js'`（不再局部定义）。路由端到端由 ## E2E 验收 的 orchestrator_decision_log 行（gate_verdict=deny:impact:impact_anchor_missing、retryable=false）作接缝验证。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | diff-gate 按 reason_code 分三类裁决（确定性 blocked / 可重试 mapper_stale / fail-closed 未知）；receipt+决策日志透传 reason/retryable/detail；retryable:false 走确定性出口路由 generator-fix/human_review |
| **NFR（做得多好）** | 非功能 | 确定性 impact 结论一次落定，禁 90s×N 重试到 deadline；决策日志可判因 |
| **Invariant（永不违反）** | 不变量 | INV-1 同一语义（确定性 vs 可重试）判变端与消费端同一处理策略（[同语义同策略]）；INV-2 未知 reason_code 一律 fail-closed（禁默认可重试）；INV-3 真新鲜度 5 码 mapper_stale/retryable:true 语义不回退 |
| **判定点（怎么知道）** | 见判定点登记表 | 见下 |
| **保质期（何时过期）** | 失效 | reason_code 集合随 radius.js 演进；新增确定性码须同步 DETERMINISTIC_IMPACT_ERROR_CODES（[枚举全仓grep]）|
| **死亡告警（停了谁知道）** | 告警 | 确定性 blocked 未落 orchestrator_decision_log = 判因失效；由决策日志缺行体现，运维可查 gate_verdict |
| **失败语义（挂了怎么办）** | 失败 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | E2E psql 查 orchestrator_decision_log 新增行（带 5 分钟时间窗）确认 gate_verdict/detail 真落库 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ 某 reason_code 是「确定性」还是「可重试」 | A. 按 freshness.status; B. 按 reason_code 集合成员 | B（reason_code 集合成员，确定性优先） | status 无法区分 anchor_missing 与 snapshot_stale；A 正是本 bug 根因 | 误判为可重试 → kernel 无限重试到 deadline（本 bug）；误判可重试为确定性 → 真新鲜度问题被永久 blocked 不重试 |
| ⚠️ 集合外新 reason_code 如何处置 | A. 默认可重试; B. fail-closed 不可重试 | B（fail-closed） | 未知契约不得静默放行/无限重试 | A → 新增确定性码漏进集合时退化回本 bug 无限重试 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| mapper 不可达（异常） | impact_unknown/mapper_unavailable/retryable:true（既有，不改） | 是 | 退避复探，deadline 收敛 |
| 确定性 reason_code | blocked/retryable:false 一次落定 | 否（确定性，重试无意义） | 路由 generator-fix（候选可修）或 human_review（Map 覆盖缺口） |
| 未知 reason_code | impact_unknown/mapper_contract_invalid/retryable:false | 否 | fail-closed，走确定性出口（human_review） |
| 真新鲜度 stale | impact_unknown/mapper_stale/retryable:true（既有语义） | 是 | 退避复探 |

### 输入对抗面

N/A — 本 sprint 为 kernel 内部判决逻辑，无对外暴露 agent 输入面（mapper 结论来自可信内部 radius.js）。

---

## 禁 mock 边清单

本单改动涉及**状态机（三类裁决状态迁移）** + **跨模块数据传递（diff-gate→harness-gates receipt→loop 决策日志）**，禁 mock 被改的边：

- diff-gate.js ↔ mapperResult 契约边（本单改 diff-gate 对 mapper `freshness.reason_code`/`unclaimed_files` 的消费判决）：冻结测试**真调** `evaluateDiffGate` 全路径分类逻辑，只允许注入 `mapClient`（更外层的 Map HTTP 边界，本单不改）返回确定性录制响应，**禁止** stub/spy 掉 diff-gate 内部分类函数。
- harness-gates.js beforeEvaluate ↔ diff-gate 结果 → gateReceipt 边（本单改 receipt 透传 detail）：冻结测试真调 `createHarnessImpactGates(...).beforeEvaluate`，注入 `diffGate` 返回值（相邻模块契约），**真跑 gateReceipt 构造**，禁止直接断言内部函数。
- constants.js ↔ loop.js 集合消费边：冻结测试真读 `DETERMINISTIC_IMPACT_ERROR_CODES` 导出，禁止 mock 常量。
- 代码 ↔ orchestrator_decision_log 表（E2E，本单验证 detail 写路径）：E2E 用**真 Postgres**（scratch `DB_URL`）真跑 `appendHop` 写行 + psql 读回，禁止 mock DB。

> 说明：diff-gate 无 db 分支（`db` 不传）是本单被测判决逻辑的合法直调入口，非 mock 被改的边——被改的边是「对 mapper reason_code 的消费」，该边真跑；`mapClient` 注入的是 Map HTTP 传输层（更外层无关依赖），符合「只许 mock 更外层」。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（kernel 判决逻辑，中风险）
高风险面:
- 错输入: mapper 返回 `freshness` 缺失 / `freshness.status='fresh'` 但带 reason_code（矛盾态）→ 应走 fresh 正常对账，不误落 blocked
- 错输入: reason_code 为 `null` 但 status !== 'fresh' → 归 fail-closed（mapper_contract_invalid），不得当可重试
- 重复提交: 同一 reason_code 连续两次调 diff-gate → 结果稳定确定（幂等，retryable:false 恒定）
- 边界值: `unclaimed_files` 为空数组 + impact_anchor_missing → 仍 blocked（已覆盖）；`affected_nodes` 为空 + capability_assertion_coverage_missing → detail.capability_ids=[] 不崩
- 中途中断: E2E 写 orchestrator_decision_log 时 append-only trigger 生效，重复 hop 写入抛 SingletonConflictError（不静默双写）
发现分级: P0/P1（确定性结论被误判为可重试 / fail-closed 失效 / 真新鲜度被永久 blocked）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 数据写入类验收：scratch Brain（Fleet 注入 `DB_URL` 全新空库）跑仓库真实 migration bootstrap，真跑受影响代码（diff-gate + harness-gates）产出确定性 blocked receipt，经真实 `appendHop` 写入 `orchestrator_decision_log`，psql 带 5 分钟时间窗读回验证。规避 [local_api闸]：本 E2E 产出可机检的 DB 数据 smoke（decision_log 行），非无产物 UI smoke。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DB_URL
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 空库跑仓库真实 migration，机检 orchestrator_decision_log 表存在
node -e '
  (async () => {
    const pg = (await import("pg")).default;
    const m = await import("./packages/brain/src/migrate.js");
    const pool = new pg.Pool({ connectionString: process.env.DB_URL });
    await m.runMigrations(pool);
    await pool.end();
  })().catch((e) => { console.error(e); process.exit(1); });
'
psql "$DB_URL" -tAc "SELECT to_regclass('orchestrator_decision_log') IS NOT NULL" | grep -qx t || { echo "FAIL: orchestrator_decision_log 表缺失"; exit 1; }

# 2. 真跑 diff-gate + harness-gates 受影响代码，经真实 appendHop 写决策日志行
node -e '
  (async () => {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString: process.env.DB_URL });
    const { evaluateDiffGate } = await import("./packages/brain/src/impact-contract/diff-gate.js");
    const { createHarnessImpactGates } = await import("./packages/brain/src/impact-contract/harness-gates.js");
    const { appendHop } = await import("./packages/brain/src/orchestrator/decision-log.js");
    const HEAD = "b".repeat(40);
    const active = { id: "c1", task_id: "0ca4b234", repo: "perfectuser21/cecelia", base_revision: "a".repeat(40), contract_hash: "c".repeat(64) };
    const recorded = { freshness: { status: "unknown", reason_code: "impact_anchor_missing" }, fact_revisions: { cecelia: "bc4e8644" }, affected_nodes: [], required_assertions: [], unclaimed_files: ["DoD.md"] };
    const gates = createHarnessImpactGates({
      db: pool,
      getActiveContract: async () => active,
      getGap: async () => null,
      diffGate: (args) => evaluateDiffGate(Object.assign({}, args, { db: null, mapClient: async () => recorded })),
    });
    const receipt = await gates.beforeEvaluate({
      task: { id: "0ca4b234", payload: {} },
      pr: { head_sha: HEAD, type: "git_candidate", verification_status: "verified", changed_files: ["DoD.md"] },
      run: { id: "seed", impact_contract_policy: "required" },
    });
    if (receipt.gate !== "blocked" || receipt.reason !== "impact_anchor_missing" || receipt.retryable !== false) {
      console.error("FAIL: receipt", JSON.stringify(receipt)); process.exit(1);
    }
    if (!receipt.detail || !Array.isArray(receipt.detail.unclaimed_files) || receipt.detail.unclaimed_files.length === 0) {
      console.error("FAIL: receipt.detail.unclaimed_files 缺失", JSON.stringify(receipt)); process.exit(1);
    }
    const gateVerdict = "deny:impact:" + receipt.reason;
    const runRow = await pool.query("INSERT INTO initiative_runs (initiative_id) VALUES (gen_random_uuid()) RETURNING id");
    const runId = runRow.rows[0].id;
    await appendHop(pool, {
      runId, hop: 1,
      observed: { task: { id: "0ca4b234" }, candidate: { head_sha: HEAD } },
      derivedPhase: "evaluate", gateVerdict, action: "spawn:evaluator",
      detail: { reason: "impact_gate_deny", impact_gate: receipt },
    });
    console.log("WROTE run", runId, "verdict", gateVerdict);
    await pool.end();
  })().catch((e) => { console.error(e); process.exit(1); });
'

# 3. psql 验证 orchestrator_decision_log 新增行（带 5 分钟时间窗防造假）
ROW=$(psql "$DB_URL" -tAc "SELECT gate_verdict FROM orchestrator_decision_log WHERE gate_verdict='deny:impact:impact_anchor_missing' AND detail->'impact_gate'->>'retryable'='false' AND jsonb_array_length(COALESCE(detail->'impact_gate'->'detail'->'unclaimed_files','[]'::jsonb)) > 0 AND created_at > NOW() - interval '5 minutes'")
[ -n "$ROW" ] || { echo "FAIL: orchestrator_decision_log 无 deny:impact:impact_anchor_missing/retryable=false/unclaimed_files 非空 的时窗内行"; exit 1; }
echo "OK E2E: $ROW"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 三类裁决 | `tests/diff-gate-reason-code.test.ts` | detail.unclaimed_files 透传 / detail.capability_ids / fail-closed: impact_unknown/mapper_contract_invalid/retryable false | 基线：确定性码全返 mapper_stale/retryable:true → 18 failing |
| receipt 透传 | `tests/harness-gates-receipt-detail.test.ts` | blocked 结果的 gateReceipt 含 reason/retryable/detail（unclaimed_files 透传） | 基线：gateReceipt 无 detail → red |
| 确定性码集合 | `tests/deterministic-impact-codes.test.ts` | 由 constants.js 导出且为 Set / 包含确定性 reason | 基线：constants 无此导出 → red |
| d1360a48 回归 | `tests/diff-gate-d1360a48-regression.test.ts` | 录制 radius 响应 → blocked/impact_anchor_missing/retryable false/detail.unclaimed_files 带 DoD.md | 基线：录制件返 mapper_stale → red |
