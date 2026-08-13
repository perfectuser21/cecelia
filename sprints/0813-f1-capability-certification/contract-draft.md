# Sprint Contract Draft (Round 1) — F1 Capability 可信认证闭环

> journey_type: autonomous ｜ target_environment: local_api
> 锚定父路声明：**独立小路（无父路）** —— 本 sprint 是 Brain 侧认证基础设施加固（Mapper 投影 fail-closed 认证闸），
> PRD step_id=none、无 product-map golden_path 可锚定；属独立小路。
> gp-anchor: skipped (product-map.json not found)
> contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），代码层 Contract Gate 生效。

## 关键实现锚点澄清（Proposer 技术上下文校正 — Reviewer 请复核）

PRD「预期受影响文件」把 Mapper 认证闸列在 `packages/brain/src/map/state-resolver.js`，但**当前实际驱动 Capability
投影状态的读路径**是：

```
GET /api/brain/map/nodes/:key
  → routes/map.js → lib/map-read-service.js: readNode → readMap → loadMapContext
  → lib/map-state-resolver.js: loadMapNodeStates → resolveEvidenceState   ← 真正算 green/red/gray/unknown 的地方
```

`packages/brain/src/map/state-resolver.js` 的 `resolveNodeState/aggregateCapabilityState` 是**旧账本兼容层**，
`getFactHealthSummary` 仍被 `map/radius.js` 使用，但**不**参与 `/api/brain/map/nodes` 的 Capability 状态投影。
因此本合同要求：**fail-closed 认证闸落在 `packages/brain/src/lib/map-state-resolver.js`**（真实读路径），
不是 PRD 字面列的 `map/state-resolver.js`。Reviewer 若认为应改 PRD 列出的旧文件，请在 feedback 明确；
默认以真实读路径为准（否则闸加在无人调用的旧文件上 = 假绿，PRD Golden Path 第 4 步无法达成）。

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `packages/brain/src/__tests__/integration/map-state-resolver.integration.test.js`
  → 「同一 active projection 现算 green→gray→red→unknown，完全忽略 cell_status」：
  本 sprint **不得回退** query-time 现算语义与 freshness/stale→unknown 行为。
- [回归测试] 同文件「PASS receipt + revision 匹配 → assertion green → feature green → capability green」：
  **注意——该 fixture 当前无 signed GP contract 也投绿，正是本 sprint 要收紧的 fail-closed 缺口**；
  本 sprint 需在保持其余语义不变的前提下，追加「无 signed GP contract / receipt 未绑定 GP+Impact 身份 → 非绿」闸。
  收紧后该回归测试若因缺 signed contract 而 fixture 变非绿，需在同一 PR 内为其 fixture 补 signed contract + gp 绑定
  （不得删除或放宽该回归断言的现算语义部分）。
- [回归测试] `packages/brain/src/lib/journey-assertion-receipt.js` deriveAssertionVerification：receipt 必须
  assertion_revision 匹配 + assertion_digest 匹配 + 有 scenario/execution evidence，本 sprint 绑定校验叠加其上、不替代。
- [累积FR] context-manifest: unavailable（`/api/brain/line/e6f803f2-.../context-manifest` 返回空，无累积 FR 摘要）。
- [MAP_NOT_CONFIGURED] task.payload.map_scope / map_repo 均为 null，Unified Map radius 影响半径未配置；
  本 sprint 不依赖 radius must_run_assertions，闸落在节点投影读路径。

## Response Schema（推导来源: 现有 api_registry 端点 GET /api/brain/map/nodes/:key，无新增 HTTP 端点）

### Endpoint（现有，不新增）: `GET /api/brain/map/nodes/:key?scope=<scope>`
本 sprint **不新增 HTTP 端点**，只收紧既有投影读路径返回的 `node.state`。观察面 = 该端点（及其底层
`loadMapNodeStates(...).states[]`）对 Capability 节点返回的状态。

**Success (HTTP 200)** — 节点投影（现有 shape，字段名字面复用 map-read-service.js `publicNode`）:
```json
{"node": {"key": "<capability_key>", "type": "capability", "state": "<state>", "state_reason": "<reason_code>", "state_details": {}}}
```
- `node.state` (string, 必填): 取值枚举 **`green` | `red` | `gray` | `unknown` | `not_applicable`**（字面来源 lib/map-state-resolver.js `state()`）。
  认证前提缺失时 **禁止为 `green`**（fail-closed），必须落在 `red|gray|unknown` 之一。
- `node.state_reason` (string, 必填): reason_code，认证闸新增原因码见下「认证闸 reason_code 契约」。
- `node.state_details` (object, 可选): provenance（freshness/receipt 等）。

**认证闸 reason_code 契约（本 sprint 新增，字面用于断言）**:
| 缺失前提 | Capability/Assertion 非绿 reason_code（字面） |
|---|---|
| 无 signed GP contract | `gp_contract_unsigned` |
| receipt 未绑定该 signed GP contract identity（gp_contract_id/hash 缺失或不符） | `receipt_gp_contract_unbound` |
| receipt 未绑定 Impact contract（impact_contract_id 缺失） | `receipt_impact_contract_unbound` |
| receipt source_sha ≠ 当前 fact source_revision（陈旧） | `receipt_revision_mismatch`（**复用现有码**，不新增） |
| step link 未绑定 Feature/Assertion（feature_id 或 assertion_ref 缺失） | `step_link_unbound` |

> 现有绿码 `receipt_pass` / `anchor_target_present` 只有在**四前提全成立**时才允许返回。
> **禁用字段名**（不得作为新状态值或绿码出现）: `certified`、`ok`、`pass`、`verified_green`、`stale_green`。

**Error (HTTP 4xx)**: 节点不存在 → 现有 `{"error": {"code": "MAP_NODE_NOT_FOUND", "message": "..."}}`（HTTP 404，不改）。

---

## Golden Path

[准备可丢弃 fixture：F1 Capability + Feature + Journey Step link + Owner-signed GP Contract + 真实 Evaluator PASS receipt(绑定 GP+Impact identity + 当前 SHA)]
→ [Mapper `loadMapNodeStates` 查询时对 F1 施加 fail-closed 认证闸]
→ [四前提齐备 → F1 投影 green；缺任一前提 → F1 保持非绿 red/gray/unknown]

### Step 1: 构造可丢弃 fixture 全链（Capability/Feature/Step link + signed GP contract + PASS receipt）
**来源**: `[FROM_PRD]` — Golden Path 第 1–2 步 + 边界情况段（PRD L19-23、L29-35）。

**可观测行为**: 在隔离的 throwaway scope 下，projected active projection 中存在一个 F1 Capability 节点及其
feature/assertion 子节点，journey_step_link 已绑定 feature_id + assertion_ref，golden_path_contract_versions
存在 status='signed' 版本，journey_assertion_receipts 存在一条 verdict='PASS'、source_sha=当前 revision、
gp_contract_id/gp_contract_hash=该 signed contract identity、impact_contract_id 非空的 receipt。

**验证命令**（E2E oracle harness，真 Postgres，见 `## E2E 验收`）:
```bash
node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=S0-happy
# 期望 stdout 含: RESULT S0-happy state=green reason=receipt_pass  → PASS
```
**硬阈值**: 四前提齐备时 F1 capability `state == "green"`；harness 退出码 0。

---

### Step 2: Mapper 对 F1 施加 fail-closed 认证闸（无 signed GP contract → 非绿）
**来源**: `[FROM_PRD]` — Golden Path 第 4-5 步 + 边界「无 signed GP contract → F1 非绿」（PRD L22-23、L29）。
TDD 红：**先证明**此前提。

**可观测行为**: 上述 fixture 中把 GP contract 置为未签署（status='pending_signature' 或删除 signed 版本），
其余前提不变 → F1 capability `state != "green"`，reason_code=`gp_contract_unsigned`（沿子节点冒泡到 capability）。

**验证命令**:
```bash
node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=S1-unsigned
# 期望 stdout 含: RESULT S1-unsigned state=<非green> reason=gp_contract_unsigned  → PASS
```
**硬阈值**: `state ∈ {red,gray,unknown}` 且 ≠ green；harness 退出码 0（观察到 fail-closed 即 PASS）。
**当前（未实现闸时）**: 此 receipt PASS+revision 匹配 → 现有 resolver 投 green → harness 退出码 1（红证据）。

---

### Step 3: receipt 身份绑定闸（未绑定 GP identity / 未绑定 Impact / 陈旧 SHA → 非绿）
**来源**: `[FROM_PRD]` — 边界情况「receipts 未绑定 GP contract identity / 未绑定 Impact / SHA 陈旧 → 非绿」（PRD L30-32）。

**可观测行为**: 逐一破坏 receipt 绑定：
- receipt.gp_contract_id 置 NULL → `state != green`，reason=`receipt_gp_contract_unbound`
- receipt.impact_contract_id 置 NULL → `state != green`，reason=`receipt_impact_contract_unbound`
- receipt.source_sha 改成非当前 SHA → `state != green`，reason=`receipt_revision_mismatch`

**验证命令**:
```bash
node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=S3-receipt-binding
# 期望 stdout 含三行 RESULT，均 state=<非green> + 对应 reason  → PASS
```
**硬阈值**: 三种破坏各令 F1 `state != green` 且 reason_code 精确匹配上表；harness 退出码 0。

---

### Step 4: step link Feature/Assertion 绑定闸 + Feature 子节点全绿闸
**来源**: `[FROM_PRD]` — 边界「Journey Step links 未全部绑定 Feature/Assertion → 非绿」+「Feature 任一子节点非绿 → 非绿」（PRD L34-35）。

**可观测行为**:
- journey_step_link.feature_id 或 assertion_ref 断开 → `state != green`，reason=`step_link_unbound`
- feature 下某 assertion 子节点为 red/unknown → capability 聚合 `state != green`（复用现有 `child_red`/`child_unknown` 聚合，不新增码）

**验证命令**:
```bash
node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --scenario=S5-steplink
# 期望 stdout 含: RESULT S5-steplink state=<非green> reason=step_link_unbound  → PASS
```
**硬阈值**: 断开 step link 绑定 → F1 `state != green` 且 reason=`step_link_unbound`；harness 退出码 0。

---

### Step 5: 真实 Evaluator receipt 落库绑定 GP identity（evaluator bundle GP identity 补齐）
**来源**: `[FROM_PRD]` — 范围内「补 evaluator bundle GP identity、receipt GP identity」（PRD L39、L54）+ Invariant validation-clock/judge-evidence。

**可观测行为**: `persistTrustedEvaluatorReceipts(db, {attempt, result})` 在写入 PASS receipt 时，除现有
impact_contract_id/impact_contract_hash/harness_attempt_id 绑定外，**新增**从 signed GP contract 解析并落
`gp_contract_id` + `gp_contract_hash`（64hex）。缺 signed GP contract 或 identity 不完整时**拒绝落 PASS receipt**
（抛 evidence 错误，fail-closed，不静默写无绑定 receipt）。validation-clock / evidence_insufficient 现有约束不回退。

**验证命令**（单元/集成，真 Postgres）:
```bash
npx vitest run sprints/0813-f1-capability-certification/tests/f1-capability-certification.integration.test.ts -t "evaluator writer 绑定 gp_contract_id" 2>&1 | tail -20
# 期望: 该用例通过（TEST_DATABASE_URL 就绪时真跑；否则 describe.skip）
```
**硬阈值**: evaluator 写入的 receipt 行 `gp_contract_id` 非空且等于 signed contract id、`gp_contract_hash` 匹配其 content_hash。

---

## 真实调用方请求 shape

本 sprint 无「设备/agent 调服务端」外部真实调用方（Android/Windows agent 等）—— 认证闸是 Brain 内部
读路径（Mapper 投影）与写路径（Evaluator receipt 落库）。真实"调用方"是：
- **写侧**：Kernel Harness Evaluator 通过 `persistTrustedEvaluatorReceipts(db, {attempt, result})` 落 receipt，
  attempt/result 为 harness task bundle 形态（`attempt.role='evaluator'`、`result.decision.outcome ∈ {PASS,FIXED}`、
  `inputs.impact_gate.{contract_id,contract_hash,repo,head_revision}`、`inputs.pull_request.head_sha`）——
  字段名逐字复用现有 `impact-contract/assertion-receipts.js`，本 sprint 仅**增量新增** gp identity 落列，不改现有字段路径。
- **读侧**：Mapper `GET /api/brain/map/nodes/:key`（内部/loopback），无外部认证 header 分叉。

N/A：无 Android/微信/webhook 等跨设备真实调用方，故无 header-vs-body 双路径风险。

## 第三方真调

N/A —— 本 sprint 不依赖任何第三方 API（LLM/支付/短信/平台）。认证闭环全部落在本仓 Postgres + Brain 内部函数。
（本合同无第三方外部依赖，规则 B 不适用。）

## 未覆盖真实链路清单

- **真实 Evaluator 端到端触发未在本 sprint E2E 覆盖**：本 sprint E2E 用 `persistTrustedEvaluatorReceipts` 的真实函数
  + 真 Postgres 验证「写侧绑定 GP identity」，但**不**真实拉起一次完整 Kernel Harness Evaluator 跑 GitHub PR SHA
  （那依赖 Fleet/PR/远端 runner，超出本认证闸 sprint 范围）。补位计划：写侧用真实函数 + 真库 fixture 覆盖绑定逻辑；
  端到端真 evaluator 由既有 harness evaluate 链路在后续真 PR 上自然覆盖。属 `logic-done-pending`（写侧逻辑真验，
  端到端 evaluator 触发未真验）。责任：本 line 后续真 sprint 走 harness evaluate 时自然覆盖。
- 其余链路（resolver 读闸、receipt 绑定、step-link 绑定、聚合）均由真 Postgres fixture 真验，无 mock 顶替。

## 禁 mock 边清单

本单改动涉及 **DB 写路径**（evaluator receipt 落 gp identity）+ **跨模块数据传递/状态机**（resolver 读 receipt+contract 算投影态），故以下边**禁 mock**，failing test 必须真 Postgres：

- `lib/map-state-resolver.js` (loadMapNodeStates/resolveEvidenceState) ↔ **journey_assertion_receipts 表**（本单新增读 gp_contract_id/gp_contract_hash/impact_contract_id 并据以 gate，测试必须真库真 receipt 行）
- `lib/map-state-resolver.js` ↔ **golden_path_contract_versions 表**（本单新增读 signed 版本存在性 + identity，测试必须真库真 contract 行）
- `lib/map-state-resolver.js` ↔ **journey_step_links / journey_features 表**（step-link Feature/Assertion 绑定闸，测试真库真 link 行）
- `impact-contract/assertion-receipts.js` (persistTrustedEvaluatorReceipts) ↔ **journey_assertion_receipts 表 + golden_path_contract_versions 表**（本单新增写 gp identity，测试真库校验落列，禁 mock db）
- `golden-path-contracts.js` ↔ **golden_path_contract_versions 表**（读 signed identity，真库）

只允许 mock 更外层无关依赖（如 Bark 通知、GitHub API）——本单不触及这些。空清单不适用（本单是接缝/DB 写路径改动）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | | Mapper 对 F1 Capability 投影 green 前，强制校验四认证前提（signed GP contract / receipt 绑定 GP+Impact+当前SHA / step-link 绑定 Feature+Assertion / Feature 子节点全绿）；Evaluator 落 PASS receipt 时绑定 GP identity。缺任一 → 非绿 fail-closed。 |
| **NFR（做得多好）** | | 无强性能阈值（PrepPRD 未指定）。CI 跑最短 smoke（S0 happy + S1 unsigned 反例）；nightly 跑全 fail-closed 矩阵（S0–S5）。投影读为查询时现算，不引入新缓存。 |
| **Invariant（永不违反）** | | ①fail-closed：缺任一认证前提一律非绿，禁 stale-green 假绿。②不新增平行认证系统，只复用 golden_path_contract_versions / journey_assertion_receipts / Kernel Harness / Mapper。③不回退 query-time 现算与 freshness→unknown 语义。④validation-clock / judge-evidence 铁律不破（见 INV 映射）。 |
| **判定点（怎么知道）** | | 见下方「判定点登记表」 |
| **保质期（何时过期）** | | receipt 随 source_sha 变化即过期（陈旧 SHA→非绿），无独立 TTL；signed GP contract 被 invalidated/superseded 即失去认证力（本 sprint 只认 status='signed' 当前版本）。 |
| **死亡告警（停了谁知道）** | | 认证闸退化为「无脑投绿」= 静默假绿最危险；由本 sprint 的 nightly 全矩阵测试 + brain-integration 回归测试守护，任一 fail-closed 反例回绿则 CI 红，主理人经 CI/Notion 得知。 |
| **失败语义（挂了怎么办）** | | 见下方「失败语义声明」。核心：认证数据不可得/异常一律**拦截（非绿）**，不放行。 |
| **效果确认（已发≠已生效）** | | 每次投影现算，`node.state` 即实时事实；E2E 逐前提破坏→回落非绿，确认闸真实生效（非"配置即生效"）。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ signed GP contract 是否存在 | A. golden_path_contract_versions status='signed' 当前版本存在性；B. 信 journey_features.status | A. 查 golden_path_contract_versions（journeys→golden_paths.journey_id→contract）status='signed' | 唯一 Owner 签署事实源，migration 372 有 uq_gp_contract_one_signed 唯一约束 | 静默把无合同能力当认证绿，直接面客假绿 |
| ⚠️ receipt 是否绑定该 GP contract identity | A. receipt.gp_contract_id==signed.id 且 gp_contract_hash==content_hash；B. 仅比 gp_contract_hash | A. id + hash 双绑定 | id 防跨 GP，hash 防合同内容漂移；migration 374 有 contract_chk 保证 id/hash 同在同缺 | 陈旧/他路 receipt 冒充认证，假绿 |
| receipt 是否绑定 Impact contract | A. receipt.impact_contract_id 非空；B. 忽略 | A. impact_contract_id 非空（migration 409 列） | Impact 合同证明改动半径已被评估 | 未评估影响面的改动被认证绿 |
| receipt 是否当前 SHA | A. receipt.source_sha==fact source_revision；B. 只看有 PASS | A.（复用现有 resolveEvidenceState 现算逻辑） | 现有语义，陈旧即 unknown | 上一轮绿冒充本轮，假绿 |
| step link 是否绑定 Feature/Assertion | A. journey_step_links.feature_id 且 assertion_ref 均非空；B. 只看 assertion_ref | A. feature_id + assertion_ref 双非空 | Golden Path 第 3 步要求全绑定 | 无锚点的 link 被当已验证 |

> ⚠️ 行为「升拍板点」级判定：signed contract 存在性 与 gp identity 绑定两处误判后果=直接面客假绿。
> PrepPRD 已在 PRD Golden Path 第 4 步显式拍定四前提 AND 关系，判定方法与 PRD 一致，无新增待确认项。
> judgment-pending-user: 无（PRD 已拍定四前提及其 AND 语义）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| golden_path_contract_versions 查询异常/无 signed 行 | Capability 非绿（gp_contract_unsigned / resolver 内部错→unknown），**不放行** | 是（纯读，现算） | fail-closed 保持非绿 |
| receipt 缺 gp/impact 绑定字段 | 非绿（receipt_gp_contract_unbound / receipt_impact_contract_unbound） | 是 | fail-closed |
| Evaluator 落 receipt 时无 signed GP contract | `persistTrustedEvaluatorReceipts` 抛 evidence 错误（HTTP 409），**拒绝写无绑定 PASS receipt** | 是（ON CONFLICT DO NOTHING 幂等键不变） | 不写=下游非绿，不静默假绿 |
| fact 快照陈旧 | unknown（复用现有 freshness→unknown） | 是 | fail-closed |

### 输入对抗面

N/A —— 本 sprint 无对外暴露 agent / 外部用户可写入接口；receipt 写入方是内部 Kernel Harness Evaluator（内部信任边界），
读侧是内部/loopback Mapper 查询。无 Prompt Injection / 越权指令面。

---

## Invariant 铁律映射（历史约束三源之一）

- INV-1 [validation-clock]：本 sprint 不改 validation_clock_required 默认 fail-closed 语义；evaluator 落 receipt 仍经现有
  clock/身份校验路径，本单只增量新增 gp_contract_id/hash 落列，不旁路 clock。DoD 有 INV 条目守护（见 contract-dod.md）。
- INV-2 [judge-evidence]：本 sprint 不改 Judge 的 evidence_insufficient vs 实现缺陷区分；认证闸只作用于 receipt 已落库后的
  Mapper 投影读，不干预 Judge 判定分支。DoD 有 INV 条目守护。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，真 Postgres，可丢弃 fixture）

**journey_type**: autonomous
**target_environment**: local_api

> 说明：认证闭环全部落在本仓 Postgres 内部表（golden_path_contract_versions / journey_assertion_receipts /
> journey_step_links / map_projection_*）。E2E 由 Fleet 注入 attempt 级空库 `DB_URL`，先跑仓库真实 migration
> 建表，再由 oracle harness 在**隔离 throwaway scope** 内 seed 全链 fixture、逐前提破坏、断言 fail-closed，退出即清理。
> harness 自建 Pool 连 `DB_URL`（不经受 `_test` 名守护的全局 pool），把 client 注入被测的 `loadMapNodeStates` 真实读路径——
> 真库、真 resolver、无 mock 被改的边。Kernel validation identity 用运行时注入的 HARNESS_* 环境变量（见脚本），不写死 UUID。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"

# Kernel validation identity late-bound（provenance 仅取运行时注入值，禁写死 UUID）
ATTEMPT_ID="${HARNESS_ATTEMPT_ID:-local-e2e}"
CAP_SNAPSHOT_ID="${CAPABILITY_SNAPSHOT_ID:-local-e2e}"
echo "e2e provenance attempt=$ATTEMPT_ID cap_snapshot=$CAP_SNAPSHOT_ID"

# 1. 空库跑仓库真实 migration 建表（golden_path_contract_versions / journey_assertion_receipts / map_projection_* 等）
node packages/brain/src/migrate.js
# 机检关键表已建
node -e 'import("pg").then(async ({default:pg})=>{const c=new pg.Client({connectionString:process.env.DB_URL});await c.connect();for(const t of ["golden_path_contract_versions","journey_assertion_receipts","journey_step_links","map_projection_runs"]){const r=await c.query("SELECT to_regclass($1) AS t",[t]);if(!r.rows[0].t){console.error("FAIL: 表未建 "+t);process.exit(1);}}await c.end();console.log("OK: 关键表已建");})'

# 2. oracle harness 跑全 fail-closed 矩阵（S0 happy + S1..S5 反例），真库真 resolver，退出码驱动
node sprints/0813-f1-capability-certification/tests/f1-cert-harness.mjs --mode=full

echo "✅ F1 Capability 认证闭环 E2E 全矩阵通过（fail-closed 生效）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: receipt 的 gp_contract_hash 写成非 64hex / 大小写混合 → 确认闸按 migration 正则拒绝，不误判绿。
- 重复提交: 同一 (run_id, journey_step_link_id, source_sha, impact_contract_hash) 重复落 receipt → ON CONFLICT DO NOTHING 幂等，不产生双绑定歧义。
- 中途中断: seed 到一半（signed contract 有、receipt 无）→ Capability 非绿（receipt_missing/unbound），不因半成品投绿。
- 边界值: signed GP contract 存在但被 invalidated/superseded（非 'signed'）→ 视为无 signed → 非绿；多 pending 版本 + 0 signed → 非绿。
- 跨 GP 串味: receipt.gp_contract_id 指向**另一条** GP 的 signed contract → gp identity 不属本 GP → 非绿（防跨 GP 冒认）。
发现分级: P0/P1（认证前提缺失却投绿 / 跨 GP 冒认成功）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 认证闸全链 | `tests/f1-capability-certification.integration.test.ts` | 无 signed GP contract 时 F1 非绿; receipt 未绑定 gp_contract_id 时非绿; receipt 未绑定 impact 时非绿; step link 未绑定 feature/assertion 时非绿; 四前提齐备时 F1 green; evaluator writer 绑定 gp_contract_id | TEST_DATABASE_URL 就绪时 → 上述 fail-closed 用例现全绿(闸未加)故 FAIL |
| E2E oracle | `tests/f1-cert-harness.mjs` | S0-happy/S1-unsigned/S3-receipt-binding/S5-steplink 真库矩阵 | 闸未加时 S1/S3/S5 观察到 green → harness exit 1 |
