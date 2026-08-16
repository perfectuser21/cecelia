# Sprint Contract Draft (Round 1)

锚定父路声明: 独立小路（无父路）—— 本 sprint 是 kernel 内部调度决策修复，不隶属任何 user-facing Golden Path。

contract-gate: present (cecelia worktree, packages/brain/src/lib/contract-gate.js 存在，走代码层 Contract Gate)
gp-anchor: skipped (product-map.json not found)
map: [MAP_NOT_CONFIGURED]（task.payload.map_scope=["F1"] 但 map_repo=null、expected_files=null → 未配置影响半径，不回退领域硬编码；must_run_assertions 为空）

## Response Schema（推导来源: 从 diff-gate.js / harness-gates.js / loop.js 实现推导 + PRD 明确枚举）

本 sprint 无对外 HTTP 响应新增字段属于纯 kernel 内部数据结构；同时增强一条既有内部路由 `POST /api/brain/tasks/:taskId/impact-contract/diff-evaluate` 的状态码映射。逐个数据结构：

### 1. `evaluateDiffGate()` 返回（packages/brain/src/impact-contract/diff-gate.js）
三类分流（步骤 3a freshness 判定处按 `freshness.reason_code` 分派）：

**(a) 真新鲜度问题**（reason_code ∈ {`fact_snapshot_stale`,`projection_revision_missing`,`projection_revision_mismatch`,`manifest_projection_mismatch`,`graph_projection_revision_mismatch`}）：
```json
{"gate":"impact_unknown","reason":"mapper_stale","retryable":true}
```
- `gate` (string): 字面 `"impact_unknown"` — 来源 PRD Golden Path 第2步(a) + 现状回归保护
- `reason` (string): 字面 `"mapper_stale"` — 来源 PRD
- `retryable` (boolean): `true` — 来源 PRD（真新鲜度可靠重试收敛）

**(b) 确定性结论**（reason_code ∈ {`impact_anchor_missing`,`capability_assertion_coverage_missing`,`capability_not_in_active_projection`,`unsafe_assertion_ref`,`assertion_identity_ambiguous`}）：
```json
{"gate":"blocked","reason":"<原 reason_code>","retryable":false,"detail":{"unclaimed_files":["DoD.md"],"capability_ids":["G1"]}}
```
- `gate` (string): 字面 `"blocked"` — 来源 PRD Golden Path 第2步(b)
- `reason` (string): **字面等于原 reason_code**（不改名，PRD 硬要求）
- `retryable` (boolean): `false` — 来源 PRD（确定性结论重试不可能改变）
- `detail` (object): `{unclaimed_files?: string[], capability_ids?: string[]}` — `impact_anchor_missing` 带 `unclaimed_files`（mapper 的 `unclaimed_files`）；`capability_assertion_coverage_missing` 带 `capability_ids`（mapper 缺覆盖能力，读 `uncovered_capability_ids`/`affected_nodes` 兜底）

**(c) 未知/新增 reason_code**（不在上述两集合内）：
```json
{"gate":"impact_unknown","reason":"mapper_contract_invalid","retryable":false}
```
- `reason` (string): 字面 `"mapper_contract_invalid"` — 来源 PRD Golden Path 第2步(c) fail-closed
- `retryable` (boolean): `false` — 来源 PRD（禁止默认 retryable:true）

**禁用字段名**: `reason` 值禁止把确定性 reason_code 改写为 `mapper_stale`（根因即此折叠）；`retryable` 禁止对确定性结论写 `true`。

### 2. `gateReceipt()` 增量（packages/brain/src/impact-contract/harness-gates.js:26-36）
现状 receipt = `{stage, gate, reason, retryable, contract_id, contract_hash, ...extra}`。新增：
```json
{"...":"（既有字段不变）","detail": {"unclaimed_files":["DoD.md"]}}
```
- `detail` (object|null): 透传 `result.detail ?? null` — 来源 PRD Golden Path 第3步（gateReceipt 透传 reason/retryable/detail）

### 3. `routeDeterministicImpactGate({reason, detail, decisionLog})` 新增（packages/brain/src/orchestrator/derive.js，`[NEW_PATTERN]`）
纯函数，loop.js 在 impact 闸 `retryable:false` 时调用（替代现状 line 1661 无脑 `failRun`）：
```json
{"phase":"generate","action":"spawn:generator-fix","reason":"impact_anchor_missing","detail":{"unclaimed_files":["DoD.md"]}}
```
- `action` (string): 枚举 `"spawn:generator-fix"` | `"wait:human_review"`（字面等于 ACTION.SPAWN_GENERATOR_FIX / ACTION.WAIT_HUMAN_REVIEW 常量值）
- 路由规则（来源 PRD 第3步 + 边界情况）：
  - `impact_anchor_missing` 且 decisionLog 无本 reason 的既往 `spawn:generator-fix` → `spawn:generator-fix`（`detail.unclaimed_files` 携带）
  - `impact_anchor_missing` 且已 generator-fix 过一次 → `wait:human_review`（不二次重试）
  - `capability_assertion_coverage_missing` → 直接 `wait:human_review`
  - 其余确定性 reason → 保守 `wait:human_review`

### 4. `POST /tasks/:taskId/impact-contract/diff-evaluate` 状态码映射增量（routes/impact-contracts.js:266-273）
现状仅 `impact_unknown→503` / `drift→409` / else→200。新增：
- `gate:'blocked'` → HTTP `409`（deny，非 200，非 503；确定性拒绝不可重试），body 含 `detail`
- `reason` (string): 字面等于 diff-gate 的确定性 reason_code

### 5. orchestrator_decision_log 落行（loop.js 现有 append 路径）
```json
{"gate_verdict":"deny:impact:impact_anchor_missing","detail":{"impact_gate":{"gate":"blocked","reason":"impact_anchor_missing","retryable":false,"detail":{"unclaimed_files":["DoD.md"]}}}}
```
- `gate_verdict` (text): 字面 `deny:impact:<reason>`（loop.js 现有 `deny:impact:${reason}` 拼接，reason 现在是确定性 reason_code 而非 mapper_stale）
- `detail.impact_gate.retryable` (boolean): `false`
- `detail.impact_gate.detail.unclaimed_files` (string[]): 非空

---

## Golden Path

[Generator 已出本地候选] → [kernel spawn:evaluator 前调 Diff Impact Gate（beforeEvaluate）] → [diff-gate 按 freshness.reason_code 三类分流] → [gateReceipt 透传 reason/retryable/detail] → [loop 对 retryable:false 走 routeDeterministicImpactGate 确定性出口，不再退避重试到 deadline] → [orchestrator_decision_log 落 deny:impact:<reason>，运维可判因]

### Step 1: kernel 在 spawn:evaluator 前调用 Diff Impact Gate，mapper 在快照新鲜下返回确定性结论
**来源**: `[FROM_PRD]` — PRD Golden Path 第1步

**可观测行为**: mapper（radius.js）返回 `{freshness:{status:'unknown', reason_code:'impact_anchor_missing'}, unclaimed_files:['DoD.md']}`（或 `capability_assertion_coverage_missing`）。diff-gate 消费该 reason_code。

**验证命令**:
```bash
npx vitest run sprints/08162257-kernel-7589808e/tests/diff-gate-reason-code.test.js --reporter=basic
# 期望：impact_anchor_missing / capability_assertion_coverage_missing 用例 gate==='blocked'
```

**硬阈值**: 新代码下 `gate==='blocked' && retryable===false`；验证命令 `npx vitest run sprints/08162257-kernel-7589808e/tests/diff-gate-reason-code.test.js` exit 0。

---

### Step 2: diff-gate 三类分流 + reason_code 透传 + detail 载荷
**来源**: `[FROM_PRD]` — PRD Golden Path 第2步 (a)/(b)/(c)

**可观测行为**:
- (a) 真新鲜度（fact_snapshot_stale 等 5 种）→ `impact_unknown/mapper_stale/retryable:true`（回归保护）
- (b) 确定性结论（impact_anchor_missing 等 5 种）→ `blocked/<reason_code>/retryable:false` + detail
- (c) 未知 reason_code → fail-closed `impact_unknown/mapper_contract_invalid/retryable:false`

**验证命令**:
```bash
npx vitest run sprints/08162257-kernel-7589808e/tests/diff-gate-reason-code.test.js --reporter=basic
# 期望：5 用例（含 fact_snapshot_stale 回归 + 未知 reason fail-closed + d1360a48 夹具）全过
```

**硬阈值**: 5 个 diff-gate 用例全 PASS；fact_snapshot_stale 用例仍 `retryable:true`（回归不破）。

---

### Step 3: gateReceipt 透传 detail + loop 对 retryable:false 走确定性出口路由
**来源**: `[FROM_PRD]` — PRD Golden Path 第3步；`routeDeterministicImpactGate` 函数为 `[AI_ADDED]`（理由：现状 loop.js:1661 对 impact_contract_invalid 直接 failRun，无法实现 PRD 要求的 impact_anchor_missing→generator-fix 一次→human_review / coverage_missing→human_review 的差异路由，需提取纯函数承载此路由决策，供 loop.js 调用 + 单测直接验）

**可观测行为**:
- beforeEvaluate 的 gateReceipt 对 blocked 结果含 `reason/retryable/detail`
- `routeDeterministicImpactGate({reason:'impact_anchor_missing', detail:{unclaimed_files}, decisionLog:[]})` → `spawn:generator-fix`（detail 带 unclaimed_files）
- 已 generator-fix 过一次 → `wait:human_review`
- `capability_assertion_coverage_missing` → `wait:human_review`

**验证命令**:
```bash
npx vitest run sprints/08162257-kernel-7589808e/tests/impact-gate-receipt-and-routing.test.js --reporter=basic
# 期望：gateReceipt.detail.unclaimed_files 存在；routeDeterministicImpactGate 三种路由正确
```

**硬阈值**: 4 用例全 PASS；`route.action` 严格等于 `spawn:generator-fix` / `wait:human_review`。

---

### Step 4: orchestrator_decision_log 落 deny:impact:<reason> 且 detail 可判因（出口）
**来源**: `[FROM_PRD]` — PRD Golden Path 第3步末（可观测结果）+ NFR 可观测约束

**可观测行为**: 经过确定性 impact 闸后，orchestrator_decision_log 新增一行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.detail.unclaimed_files` 非空。旧代码此处会写 `deny:impact:mapper_stale` + retryable:true（无限重试根因）。

**验证命令**: 见 `## E2E 验收`（scratch 库 psql 断言）

**硬阈值**: 落行 gate_verdict 精确 `deny:impact:impact_anchor_missing`；detail.impact_gate.retryable=false；unclaimed_files jsonb 数组长度 ≥ 1。

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」真实外部调用方。改动全在 kernel 内部：mapper（radius.js，进程内/内部 map service）、diff-gate、harness-gates、loop/derive 之间的函数调用与 DB 写。无 Android/Windows agent、无外部 webhook 参与本改动路径。

## 未覆盖真实链路清单

- **mapper（radius.js）确定性结论的真实产出被录制件/注入 mapClient 顶替**｜原因：PRD [ASSUMPTION] 明确 Map manifest 已升 v3（F1 认领仓库根 `DoD.md`），`DoD.md` 不再触发 `impact_anchor_missing`；生产环境已无法用 `DoD.md` 从真实 Map 复现该确定性结论，故单测与 E2E 用 `radius-d1360a48-impact-anchor-missing.json` 录制件 + 注入 mapClient 复现 reason_code。本单**不改 radius.js**（结论本身正确，见范围限定），radius 产出 reason_code 的逻辑由 radius 自身既有测试覆盖；本单只验 diff-gate 对 reason_code 的**消费/分流**正确——消费逻辑（被改的边）全程真跑不 mock。｜真验证补位计划：radius 侧无本单改动，无需补位；下游若要对真实 Map 复现，另立「Map 覆盖缺口」任务（PRD 范围外）。
- **E2E 对 active impact contract 的 DB 读取用内存桩顶替**｜原因：只为让 evaluateDiffGate 走到 freshness 判定，harness_impact_contracts 的读非本单改动边；被改的边（diff-gate 三类分流 + gateReceipt detail 透传 + decision_log 真实写）全程真跑真 Postgres。｜真验证补位计划：decision_log 写 = 真 Postgres 写行 + psql 验（本单接缝断言，已覆盖）。

## 禁 mock 边清单

本单涉及**状态机/路由决策**（impact 闸判定 + derive 路由）与 **DB 写路径**（orchestrator_decision_log），故：

- diff-gate.js ↔ mapper freshness.reason_code（本单改判逻辑本体，测试真跑 `evaluateDiffGate` 三类分流，**不 mock diff-gate 内部**；只注入 mapper 返回值 shape，因 mapper 非本单被改的边）
- harness-gates.js gateReceipt ↔ diff-gate result（本单加 detail 透传，测试真跑 `createHarnessImpactGates().beforeEvaluate` + 真 gateReceipt，只注入 diffGate 返回值）
- loop.js/derive `routeDeterministicImpactGate` ↔ decisionLog（本单新增路由纯函数，测试真跑该函数，不 mock）
- 代码 ↔ orchestrator_decision_log 表（本单 impact 闸落行的可观测出口，E2E **真 Postgres** 写行 + psql 验，禁 mock DB 写）

## 已知约束（来自回归测试 + 累积FR）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → Mapper 抛异常 fail-closed impact_unknown/retryable:true；revision mismatch → impact_unknown/revision_mismatch/retryable:true；无 active contract → impact_unknown/contract_missing/retryable:false（本单不得回退这些既有行为）
- [packages/brain/src/impact-contract/__tests__/harness-gates.test.js] → beforeEvaluate 对 diffGate `impact_unknown/mapper_stale/retryable:true` 仍产出 `gate:'blocked'/reason:'mapper_stale'/retryable:true`（merge fence 场景）；本单只对确定性结论改判，真新鲜度 mapper_stale 语义不动
- [累积FR] （本 line 暂无历史）
- [context-manifest] unavailable（journey_id=e6f803f2 端点本地未验证，记录一行不静默跳过）

## 铁律映射（历史约束三源 — Invariant → INV 覆盖）

- INV-1 [基础设施重试身份]：本单只对**确定性 impact 结论**改判 retryable:false（走 routeDeterministicImpactGate），不触碰真基础设施失败（`impact_gate_error`/`mapper_unavailable`/`git_diff_unavailable` 等 retryable:true 路径原样保留）→ 由 diff-gate 回归用例 fact_snapshot_stale 仍 retryable:true + 未知 reason 才 fail-closed 双向守卫。covered。
- INV-2 [Planner 分支]：N/A — 本单不涉及 planner workspace/checkout。
- INV-3 [Fleet Brain URL 权威]：N/A — 本单不涉及 dispatcher/fleet worker 注入。
- INV-4 [Evaluator 校验时钟]：N/A — 本单不改 validation_clock 逻辑。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | diff-gate 按 freshness.reason_code 三类分流并透传 reason_code/detail；gateReceipt 透传 detail；loop 对 retryable:false 走 routeDeterministicImpactGate 确定性出口（impact_anchor_missing→generator-fix 一次→human_review；coverage_missing→human_review），落 orchestrator_decision_log |
| **NFR（做得多好）** | | 确定性结论必须 retryable:false，禁止空转到 deadline（现状 130+/80+ 跳空转即回归）；真 retryable 情形保留 90s 节流；决策必写 decision_log 可判因 |
| **Invariant（永不违反）** | | 真基础设施失败的重试身份不被误改（INV-1）；未知 reason_code 一律 fail-closed retryable:false（禁默认可重试）；新鲜度真问题与确定性结论同现时新鲜度优先仍 retryable:true |
| **判定点（怎么知道）** | | 见判定点登记表 |
| **保质期（何时过期）** | | reason_code 集合随 radius.js 演进；新增 radius reason_code 未登记进 diff-gate 两集合 → 自动落 (c) fail-closed（保质期到点即安全降级，非静默放行） |
| **死亡告警（停了谁知道）** | | 若 diff-gate 又把确定性结论折叠成 mapper_stale → run 空转到 deadline → automation_deadline_exceeded 失败上报 + 本 sprint 冻结回归测试常驻 CI 捕获回退 |
| **失败语义（挂了怎么办）** | | 见失败语义声明 |
| **效果确认（已发≠已生效）** | | orchestrator_decision_log 落行即回执：gate_verdict + detail.impact_gate.retryable/unclaimed_files，psql 可查（E2E 断言）|

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ freshness.reason_code 是「真新鲜度」还是「确定性结论」 | A. 只看 status!=='fresh'（现状,错）; B. 按 reason_code 归入两个显式白名单集合,未知落 fail-closed | B. reason_code 白名单集合分派 | status 无法区分二者(确定性结论也是 unknown/stale);reason_code 是 radius 唯一确定性信号 | 误判为真新鲜度→retryable:true→空转 deadline(现状根因);误判为确定性→retryable:false→真新鲜度问题不再重试被过早拒（故未知一律 fail-closed 而非猜） |
| impact_anchor_missing 是否已重试过一次 | A. 扫 decisionLog 找本 reason 的既往 spawn:generator-fix; B. 计数器 | A. decisionLog 扫描（fallback_reason/impact_gate.reason 命中） | decisionLog 是既有权威事实源,无需新增状态 | 漏判→二次重试(违反边界情况「不得二次重试」);误判→该修的没修就升人审 |

> ⚠️ 行为「主动请教用户」级别：`judgment-pending-user: freshness reason_code 分类白名单是否完整`（PrepPRD 已在 PRD「范围限定/边界情况」拍板三集合划分，本单按 PRD 枚举实现，无新增待确认判定点；此行留痕供账本保鲜）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写库 | 是(幂等键=task_id) | 客户端重试 |
| diff-gate 遇未知 reason_code | fail-closed：impact_unknown/mapper_contract_invalid/retryable:false | 是（纯判定，无副作用） | 拒绝放行 + 走确定性出口人审，绝不假绿 |
| mapper 不可达/DB 读失败/git diff 不可用 | 保留既有 retryable:true（真基础设施失败） | 是 | 退避复探由 deadline 收敛（INV-1 不动） |
| impact_anchor_missing generator-fix 一次仍失败 | 升级 wait:human_review | 否（不二次重试） | 人工补 Map 认领/挪走无主文件 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 为 kernel 内部调度决策，无对外暴露 agent、无外部用户可写入接口。freshness.reason_code 来自内部 mapper（radius.js），非不可信外部输入。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapper 返回 `freshness` 缺字段（如 `{status:'unknown'}` 无 reason_code）→ diff-gate 应落 (c) fail-closed，不得 crash 或默认 retryable:true
- 重复提交: 同一 run 连续两跳都命中 impact_anchor_missing，第二跳必须 wait:human_review（decisionLog 已有 generator-fix），不得再 spawn:generator-fix
- 中途中断: 新鲜度真问题与确定性结论同现（freshness.status==='stale' 且带 impact_anchor_missing 兼容字段）→ 新鲜度优先仍 mapper_stale/retryable:true
- 边界值: reason_code 为 `null`/空串/未知新增值 → 一律 (c) fail-closed retryable:false
发现分级: P0/P1（确定性结论仍 retryable:true 空转 / 未知 reason 默认可重试）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 数据写入类：对 scratch 库 Brain 真实代码路径产出一条 evaluator 前置 Diff Impact Gate 决策，落 orchestrator_decision_log，psql 验。驱动脚本复用 radius 录制件注入 mapper（见未覆盖真实链路清单），真跑被改的边（diff-gate 三类分流 + gateReceipt detail 透传 + decision_log 真 Postgres 写），旧代码落 `deny:impact:mapper_stale`/retryable:true（断言 FAIL），新代码落 `deny:impact:impact_anchor_missing`/retryable:false（断言 PASS）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped scratch DB_URL}"
export DATABASE_URL="$DB_URL"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd || echo /workspace)"
cd "$REPO_ROOT"
DRIVER="$(mktemp /tmp/impact-e2e-XXXXXX.mjs)"
cleanup() { rm -f "$DRIVER"; }
trap cleanup EXIT

# 1. 空库 bootstrap：跑仓库真实 migration，机检目标表存在
node -e 'import("./packages/brain/src/migrate.js").then(async (m)=>{const {default:pg}=await import("pg");const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});await m.runMigrations(pool);await pool.end();}).catch(e=>{console.error(e);process.exit(1);})'
psql "$DB_URL" -tAc "SELECT to_regclass('orchestrator_decision_log') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT to_regclass('initiative_runs') IS NOT NULL" | grep -qx t

# 2. 驱动真实被改代码路径，落一条确定性 impact 闸决策到 orchestrator_decision_log
cat > "$DRIVER" <<'MJS'
import pg from 'pg';
import { evaluateDiffGate } from './packages/brain/src/impact-contract/diff-gate.js';
import { createHarnessImpactGates } from './packages/brain/src/impact-contract/harness-gates.js';
import { appendHop, nextHop } from './packages/brain/src/orchestrator/decision-log.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const HEAD = 'b'.repeat(40);
const active = { id: 'contract-e2e', repo: 'cecelia', base_revision: 'bc4e8644', contract_hash: 'c'.repeat(64), contract_body: { affected_capabilities: [{ capability_id: 'impact-contract' }], required_assertions: [] } };
// 注入 mapClient（录制件 shape：确定性 impact_anchor_missing + unclaimed_files）——mapper 非本单被改的边
const recordedMapper = async () => ({ freshness: { status: 'unknown', reason_code: 'impact_anchor_missing' }, fact_revisions: { cecelia: 'bc4e8644' }, affected_nodes: ['impact-contract'], required_assertions: [], unclaimed_files: ['DoD.md'] });
// diffGate 走真实 evaluateDiffGate（本单被改的边），只注入 mapper 返回值与 contract 读
const diffGate = (args) => evaluateDiffGate({ ...args, db: { query: async () => ({ rows: [active] }) }, mapClient: recordedMapper });
const gates = createHarnessImpactGates({ db: {}, getActiveContract: async () => active, diffGate, readChangedFiles: async () => ['DoD.md'] });
const receipt = await gates.beforeEvaluate({ task: { id: 'task-e2e', payload: {} }, pr: { head_sha: HEAD } });
if (receipt.gate !== 'blocked' || receipt.retryable !== false) { console.error('FAIL: receipt 非确定性 blocked', receipt); process.exit(1); }
// loop.js 现有拼接语义：gateVerdict = deny:impact:${receipt.reason}；detail.impact_gate = receipt
const gateVerdict = `deny:impact:${receipt.reason}`;
const client = await pool.connect();
try {
  const { rows } = await client.query("INSERT INTO initiative_runs (initiative_id, phase) VALUES (gen_random_uuid(), 'B_task_loop') RETURNING id");
  const runId = rows[0].id;
  const hop = await nextHop(pool, runId);
  await appendHop(pool, { runId, hop, observed: {}, derivedPhase: 'evaluate', gateVerdict, action: 'spawn:evaluator', detail: { reason: 'diff_impact_gate', impact_gate: receipt } });
  process.stdout.write(runId);
} finally { client.release(); await pool.end(); }
MJS
RUN_ID="$(DATABASE_URL="$DB_URL" node "$DRIVER")"
[ -n "$RUN_ID" ] || { echo "FAIL: driver 未返回 run_id"; exit 1; }

# 3. psql 验证：新增行 gate_verdict + detail.impact_gate.retryable=false + unclaimed_files 非空（带时间窗防伪）
VERDICT=$(psql "$DB_URL" -tAc "SELECT gate_verdict FROM orchestrator_decision_log WHERE run_id='$RUN_ID' AND detail->'impact_gate'->>'retryable'='false' AND jsonb_array_length(COALESCE(detail->'impact_gate'->'detail'->'unclaimed_files','[]'::jsonb)) >= 1 AND created_at > NOW() - interval '5 minutes'" | tr -d '[:space:]')
[ "$VERDICT" = "deny:impact:impact_anchor_missing" ] || { echo "FAIL: 期望 deny:impact:impact_anchor_missing 且 retryable=false 且 unclaimed_files 非空，实得 gate_verdict='$VERDICT'"; exit 1; }

echo "✅ Golden Path 验证通过：orchestrator_decision_log 落 deny:impact:impact_anchor_missing / retryable=false / unclaimed_files 非空"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 三类分流 + reason_code 透传 | `tests/diff-gate-reason-code.test.js` | impact_anchor_missing 折叠成 blocked；capability_assertion_coverage_missing 折叠成 blocked；fact_snapshot_stale 仍维持 impact_unknown；未知 reason_code 走 fail-closed；回归夹具 | impact_anchor_missing/coverage/未知/夹具 → FAIL（现状折叠成 mapper_stale） |
| gateReceipt detail 透传 + 确定性出口路由 | `tests/impact-gate-receipt-and-routing.test.js` | blocked 确定性结论的 gateReceipt 含；impact_anchor_missing 首遇；已 generator-fix 过一次仍失败；capability_assertion_coverage_missing | detail 未透传 + routeDeterministicImpactGate 未定义 → FAIL |
