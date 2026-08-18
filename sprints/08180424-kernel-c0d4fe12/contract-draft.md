# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传 reason_code + fail-closed 出口（r19）

**锚定父路声明**: 独立小路（无父路）——本 sprint 修 orchestrator/impact-contract 内部 gate 决策，非某条业务 Golden Path 步骤推进。

**journey_type**: autonomous
**target_environment**: local_api
**contract-gate**: skipped 判定见 notes（cecelia worktree，contract-gate.js 存在→原逻辑适用）
**gp-anchor**: skipped (product-map.json not found)
**Unified Map**: [MAP_NOT_CONFIGURED] — payload 未提供 map_repo（map_scope=["F1"]），scope 锚定改用 task.anchor(journey_id=e6f803f2 / step_id=aad25bdb) + issue_ref（runs f62c7e87/d1360a48）。must_run_assertions 为空。

---

## Response Schema（推导来源: PRD 字面 + 现有 diff-gate 返回体）

本 sprint **无新增 HTTP 端点**。被改的是内部函数 `evaluateDiffGate(...)` 的返回体契约（既有对象，新增/透传字段），以及其经 `harness-gates.gateReceipt` 抵达 `loop.js` 的 receipt 形态。

### 函数返回体: `evaluateDiffGate({ db, taskId, mapClient, headRevision, changedFiles, repo })`（步骤 3a 分支）

当 `mapperResult.freshness.status !== 'fresh'` 时返回：

```json
{"gate": "impact_unknown", "reason": "<string>", "reason_code": "<string|null>", "retryable": <boolean>}
```

- `gate` (string, 必填): 恒为 `"impact_unknown"`（3a 分支不变）。来源——PRD 明确（步骤 3a）。
- `reason` (string, 必填): 终态时 = 真实 `reason_code`；`reason_code` 缺失(null)时回退 `"mapper_stale"`。来源——PRD 步骤 3「gateVerdict 变为 deny:impact:<真实 reason_code>」（loop 由 receipt.reason 构造 gateVerdict）。
- `reason_code` (string|null, 必填): 透传 `mapperResult.freshness.reason_code`，缺失为 `null`。来源——PRD 步骤 2「透传 mapperResult.freshness.reason_code 到返回体 reason_code 字段」。
- `retryable` (boolean, 必填): 终态(`status==='unknown'` 或 `reason_code∈终态集合`)→ `false`；瞬态 stale / `reason_code=null` → `true`。来源——PRD 步骤 2 + 边界情况。

**禁用字段名**（不得改写既有 key）: `retry`（须用 `retryable`）、`code`（须用 `reason_code`）、`gate_verdict`（返回体不含，由 loop 派生）。

**gateReceipt 抵达 loop 的 receipt（harness-gates.js:26-35，本单不改，透传保证）**:
```json
{"stage": "diff", "gate": "impact_unknown", "reason": "<真实 reason_code>", "retryable": <boolean>}
```
- `reason: result.reason ?? result.reason_code`（既有）→ 真实 code 抵达 loop.js:1454 → `gateVerdict = deny:impact:<真实 reason_code>`。
- `retryable: result.retryable ?? false`（既有）→ loop.js:1542 `retryable===false ? 'impact_contract_invalid' : 'infrastructure_blocked'`。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`：既有 12+ 例覆盖 pass/extend/drift/revision_mismatch/revision_evidence_missing/manifest_digest_mismatch/mapper 超时 fail-closed；本单**不得回退**这些断言（步骤 3b 及以后不变）。
- [回归测试] `packages/brain/src/impact-contract/__tests__/harness-gates.test.js:395/409`：beforeMerge 对 `diffGate` **mock** 返回 `mapper_stale/retryable:true` 时阻断——该处 diffGate 被 mock，本单改真实 evaluateDiffGate，**不影响**（已实跑确认 124 例全绿）。
- [回归测试] `packages/brain/src/orchestrator/__tests__/loop.test.js:340-348`：mock `beforeEvaluate` 返回 `reason:'mapper_stale'` → `gateVerdict==='deny:impact:mapper_stale'`——mock 整个 impactGate，本单不影响。
- [回归测试] `packages/brain/src/impact-contract/__tests__/structure-gate.test.js:148`：structure-gate 的 `mapper_stale` 语义——**structure-gate 明确不在本次范围**，不动。
- [累积FR] 本 line 暂无历史（context-manifest: 未配置本地图，[MAP_NOT_CONFIGURED]）。
- [事实来源] freshness reason_code 由 `packages/brain/src/map/radius.js` 产出：
  - `status:'stale'`（瞬态、可自愈刷新）：`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch`。
  - `status:'unknown'`（确定性终态）：`graph_projection_revision_mismatch` / `capability_not_in_active_projection` / `impact_anchor_missing` / `unsafe_assertion_ref` / `assertion_identity_ambiguous` / `capability_assertion_coverage_missing`。

---

## Golden Path

[orchestrator loop 调 evaluateDiffGate] → [Mapper 返回确定性非-fresh 结论] → [diff-gate 透传 reason_code 并按确定性判 retryable] → [gateReceipt 携真实 code+retryable 抵达 loop] → [loop 命中 retryable===false → impact_contract_invalid → 任务 blocked 终态，run 不再空转]

### Step 1: loop 在 beforeEvaluate 调用 evaluateDiffGate，Mapper 返回确定性 unknown 结论
**来源**: `[FROM_PRD]` — Golden Path 第 1-2 条 + 步骤 2。

**可观测行为**: 给定 `mapperResult.freshness = { status:'unknown', reason_code:'impact_anchor_missing' }`，`evaluateDiffGate` 步骤 3a 命中，返回 `gate:'impact_unknown'`、`reason_code:'impact_anchor_missing'`、`retryable:false`（而非旧的 `reason:'mapper_stale', retryable:true`）。

**验证命令**:
```bash
(cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const r = await evaluateDiffGate({ db:null, taskId:"t", repo:"cecelia", headRevision:"h",
  mapClient: async () => ({ freshness:{status:"unknown",reason_code:"impact_anchor_missing"},
    affected_nodes:[], required_assertions:[], fact_revisions:{cecelia:"base"} }) });
if (r.gate!=="impact_unknown"||r.reason_code!=="impact_anchor_missing"||r.retryable!==false) { console.error("FAIL",r); process.exit(1);} 
console.log("OK", JSON.stringify(r));')
```
**硬阈值**: `reason_code==='impact_anchor_missing'` 且 `retryable===false`。

---

### Step 2: 瞬态 stale（reason_code 缺失）保留可重试语义
**来源**: `[FROM_PRD]` — 边界情况「reason_code 为 null/缺失但 status 非 fresh → 保持 retryable:true 的瞬态 mapper_stale 语义」。

**可观测行为**: 给定 `freshness = { status:'stale', reason_code:null }`，返回 `reason:'mapper_stale'`、`reason_code:null`、`retryable:true`（不因缺 code 误判假 block）。

**验证命令**:
```bash
(cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const r = await evaluateDiffGate({ db:null, taskId:"t", repo:"cecelia", headRevision:"h",
  mapClient: async () => ({ freshness:{status:"stale",reason_code:null},
    affected_nodes:[], required_assertions:[], fact_revisions:{cecelia:"base"} }) });
if (r.reason!=="mapper_stale"||r.reason_code!==null||r.retryable!==true) { console.error("FAIL",r); process.exit(1);} 
console.log("OK", JSON.stringify(r));')
```
**硬阈值**: `reason==='mapper_stale'` 且 `reason_code===null` 且 `retryable===true`。

---

### Step 3: reason_code/retryable 经真实 gateReceipt 抵达 loop（跨模块接力）
**来源**: `[FROM_PRD]` — 范围限定「保证 reason_code/retryable 经 harness-gates.js gateReceipt 正确抵达 loop」。
**`[AI_ADDED]` 补强理由**: 单测 evaluateDiffGate 返回体不足以证明接力不断裂——必须真跑 `createHarnessImpactGates().beforeEvaluate → gateReceipt`，防「返回体对但 receipt 丢字段」的假绿。

**可观测行为**: 真实 `evaluateDiffGate`（注入 Mapper unknown 结论）经真实 `beforeEvaluate/gateReceipt`，receipt 得 `reason:'impact_anchor_missing'`、`retryable:false`——loop.js:1542 据此判 `impact_contract_invalid`（终态）。

**验证命令**: 见 `## E2E 验收` 段与 sprint 测试 B-05。
**硬阈值**: `receipt.reason==='impact_anchor_missing'` 且 `receipt.retryable===false`。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | diff-gate 步骤 3a 透传 `freshness.reason_code` 到返回体 `reason_code`；`status==='unknown'` 或 code∈终态集合 → `retryable:false`；瞬态 stale/`code=null` → `retryable:true` |
| **NFR（做得多好）** | | 无新增延迟（纯分支判断，无额外 IO）；沿用 Mapper 既有 timeout（PrepPRD 未指定超时/频控） |
| **Invariant（永不违反）** | | [fail-closed] Mapper 任何不可判定情形绝不假绿——只 blocked/impact_unknown，绝不 pass/extend；终态绝不 retryable:true 造成空转 |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | 终态集合随 `map/radius.js` 的 unknown 分支演进；因判定主信号是 `status==='unknown'`，新增 unknown 码自动走终态，集合仅作显式登记 |
| **死亡告警（停了谁知道）** | | 若该逻辑回退，`deny:impact:mapper_stale` 空转会被 nightly-red 铁律捕获（≥3 晚同 job 红贴 issue）；run deadline 兜底收敛 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 回归测试 B-01..B-05 exit 0 + 真实 gateReceipt receipt 字段断言；无对外动作（内部 gate 决策） |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ freshness 结论是「确定性终态」还是「瞬态可重试」 | A. 只按 `status==='unknown'`; B. 只按 `reason_code` 白名单; C. 两者结合(`status==='unknown'` 或 `reason_code∈终态集合`) | C（主信号 status==='unknown'，辅以显式终态码集合防御） | radius.js 中所有终态 code 恒带 `status:'unknown'`，所有 stale code 均可自愈刷新；C 对 Mapper 新增 unknown 码鲁棒且显式登记码集（PRD ASSUMPTION 授权 proposer 定码集） | 误判终态为瞬态 → 无限空转（原 bug #f62c7e87）；误判瞬态为终态 → 假 block 可自愈任务、丢工作 |

> ⚠️ 判定点误判后果严重（空转 / 假 block）。PRD ASSUMPTION 已显式授权「由 proposer 在合同阶段确定具体码集合；status==='unknown' 恒为终态」——已在 PrepPRD/对齐阶段拍板，非 pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| freshness=unknown（确定性终态） | 返回 retryable:false → loop 判 impact_contract_invalid → 任务 blocked 终态 | 是（纯函数，同输入同输出） | 无重试；blocked 待人工/上游修 Map 数据 |
| freshness=stale（瞬态） | 返回 retryable:true → loop 判 infrastructure_blocked → 退避复探 | 是 | 由 Mapper 刷新自愈 + run deadline 兜底 |
| freshness 缺失 / reason_code=null | 保持 mapper_stale/retryable:true（不误判假 block） | 是 | 同瞬态路径 |

### 输入对抗面

N/A — 本单为内部 orchestrator gate 决策，无对外暴露 agent / 用户可写入接口；输入来自受信的内部 Mapper（`/map/radius`）与合同存储。

---

## 禁 mock 边清单

本单涉及**跨模块数据传递**（reason_code/retryable 在 diff-gate → harness-gates.gateReceipt → loop 间接力）与 **gate 决策逻辑**，故：

- **diff-gate.js `evaluateDiffGate` 的 freshness → 返回体决策边**：failing test 必须调**真实** `evaluateDiffGate`（禁 `vi.mock('../diff-gate.js')`、禁 stub 本体）。只允许注入 `mapClient`（Mapper 外部依赖，本 sprint 无真实 Mapper 配置，且是模块文档化的测试注入点）与 fake 合同 `db`（更外层 contract-store，非本单改动边）。
- **diff-gate 返回 → `harness-gates.gateReceipt` → loop 的 reason_code/retryable 接力边**：至少一条 test（B-05）经**真实** `createHarnessImpactGates().beforeEvaluate` 跑**真实** gateReceipt（注入真实 `evaluateDiffGate` + `mapClient`），断言 receipt.reason/retryable 抵达。禁止 mock `gateReceipt` / `beforeEvaluate` / 注入假 diffGate 结果替代真实决策。

> 说明：3a 分支短路发生在任何 DB **写**路径之前，故 fake `db.query`（只回 contract 行）不构成「mock 被改的 DB 写边」——本单不改 DB 写路径（步骤 5 的 gap/block 不动）。runtime_resources.postgres=false，接力验证用 fake 合同 db + 真实 gateReceipt 完成，无需真 Postgres。

---

## 未覆盖真实链路清单

- **无第三方 API**：本单纯内部逻辑，规则 B（第三方真调）N/A。
- **Mapper 注入替身**：测试注入 `mapClient` 构造 freshness 形态（`status:'unknown'|'stale'` + reason_code）。理由：payload 未配置 map_repo（[MAP_NOT_CONFIGURED]），本机无真实 `/map/radius` 投影可复算出确定性 unknown 结论；`mapClient` 是模块既有测试注入点，且 freshness 形态与 `radius.js` 产出的真实 code **逐字一致**（`impact_anchor_missing` / `capability_not_in_active_projection` / `fact_snapshot_stale` 均取自 radius.js 源码）。真验证补位计划：impact-contract 集成层已有 `src/__tests__/integration/impact-contract-loop.integration.test.js`（brain-integration job 起真 Postgres + 真 Map），本 gate 逻辑修复合并后由该集成 job 覆盖端到端；本 sprint local_api 层用真实 evaluateDiffGate+真实 gateReceipt 逻辑闭环（logic-done），真 Map 复算接缝标 `logic-done-pending`（由 brain-integration job 覆盖）。
- **Kernel 身份**：本单 E2E 为纯逻辑 vitest/node 断言，无 attempt/capability 运行时身份消费，无 UUID 字面值。N/A。

---

## 真实调用方请求 shape

N/A — 本单无「设备/agent 调服务端」链路。真实调用方是内部 `loop.js`（beforeEvaluate/beforeMerge）→ `harness-gates` → `evaluateDiffGate`，调用形态即 `beforeEvaluate({task, pr, run})`，已由 B-05 用真实 `createHarnessImpactGates().beforeEvaluate` 逐字段覆盖。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，无 Postgres）

**journey_type**: autonomous
**target_environment**: local_api

> 本单为 orchestrator/impact-contract 内部 gate 逻辑修复，**无新增 HTTP 端点**、**不写 DB**（3a 短路在写路径前），故 oracle = 真实模块逻辑的 vitest/node 断言（非 curl/psql）。领域：无视频/发布/DB写/UI/RPA，无对应 oracle 要求。
> vitest 工作目录死规则：brain 包测试用子 shell `(cd packages/brain && npx vitest run --no-cache ./src/...)`（走 brain 自己的 vitest.config.js）；sprint 测试落 `sprints/**` 由仓库根 vitest include 覆盖，从根跑。

```bash
#!/bin/bash
set -euo pipefail

# 1. sprint 层 failing→green 回归（根 vitest，include sprints/**）——真实 evaluateDiffGate + 真实 gateReceipt
npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-fail-closed.test.ts

# 2. brain 层永久回归（brain vitest.config.js，必须 cd 进包根）——含本单新增确定性断言 + 既有全部不回退
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js)

# 3. 邻接 gate/loop 无回归（gateReceipt 接力方 + loop 消费方）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/harness-gates.test.js ./src/orchestrator/__tests__/loop.test.js)

# 4. 直接 oracle：真实 evaluateDiffGate 终态出口（无框架，node 直断）
(cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const term = await evaluateDiffGate({ db:null, taskId:"t", repo:"cecelia", headRevision:"h",
  mapClient: async () => ({ freshness:{status:"unknown",reason_code:"impact_anchor_missing"},
    affected_nodes:[], required_assertions:[], fact_revisions:{cecelia:"base"} }) });
if (term.reason_code!=="impact_anchor_missing" || term.retryable!==false) { console.error("FAIL terminal", term); process.exit(1); }
const trans = await evaluateDiffGate({ db:null, taskId:"t", repo:"cecelia", headRevision:"h",
  mapClient: async () => ({ freshness:{status:"stale",reason_code:null},
    affected_nodes:[], required_assertions:[], fact_revisions:{cecelia:"base"} }) });
if (trans.reason!=="mapper_stale" || trans.retryable!==true) { console.error("FAIL transient", trans); process.exit(1); }
console.log("OK e2e oracle: terminal fail-closed + transient retryable");')

echo "✅ Diff Impact Gate 透传 reason_code + fail-closed 验证通过"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `freshness` 整体缺失（`mapperResult.freshness===undefined`）→ 应走 3a 且 `reason_code:null`、`retryable:true`（不得抛异常）
- 错输入: `reason_code` 为空串 `""` 或非白名单 stale 码 → 应 `retryable:true`（仅 status==='unknown' 或白名单 code 才终态）
- 边界值: `status:'unknown'` 但 `reason_code:null` → 应仍终态 `retryable:false`（status 是主信号，不因缺 code 退回瞬态）
- 中途中断: 3a 返回后不得继续走步骤 3b~5（不得对 unknown 结论做 revision/对账/写库）
发现分级: P0/P1（终态被误判为瞬态致空转 / 瞬态被误判终态致假 block）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## notes

- contract-gate: cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在 → 走代码层 Contract Gate 原逻辑（非第三方 repo，不跳过）。本合同 [BEHAVIOR] 命令均为 `node`/`vitest` 真执行 exit-code 断言，无裸 curl-no-jq / or-true 吞错。
- judgment-pending-user: 无（终态码集判定已由 PRD ASSUMPTION 授权 proposer 定，非 pending）。
- Kernel identity: 本 E2E 无运行时 attempt/capability 身份消费，无 UUID 字面值（late-binding N/A）。
