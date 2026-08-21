# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传确定性 reason_code + fail-closed 出口

**锚定父路声明**: 独立小路（无父路）— journey e6f803f2 已验收 ability 历史为空（PRD 累积 FR 段），本 sprint 是 impact-gate 步骤 3a 的独立缺陷修复小路。

gp-anchor: skipped (product-map.json not found)  <!-- cecelia 仓无 product-map/generated/product-map.json -->
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在，走代码层 gate 原逻辑）

## Response Schema（推导来源: PRD 字面 + 现有 diff-gate.js verdict 契约锚定）

**N/A — 任务无 HTTP 响应**：本改动是 Brain 内部纯函数 `evaluateDiffGate` 的裁决分流，无新增/改动 HTTP 端点。Reviewer 第 6 维 HTTP schema 项自动满分。

真正的 schema 契约是 `evaluateDiffGate(...)` 的**返回 verdict 对象**（现有 JSDoc 已定义枚举，不新增 gate 枚举）：

### 确定性 Map 结论出口（stale/unknown + 非空 reason_code）
```json
{ "gate": "impact_unknown", "reason": "<非 mapper_stale 的确定性标识>", "reason_code": "<透传 mapperResult.freshness.reason_code 原文>", "retryable": false }
```
- `gate` (string, 必填): 固定 `"impact_unknown"`（PRD ASSUMPTION 2：沿用既有语义，不新增枚举）—— 来源 PRD「可观测结果」
- `reason_code` (string, 必填): **逐字透传** `mapperResult.freshness.reason_code`（如 `deny:impact:manifest_unclaimed`）—— 来源 PRD「系统处理/可观测结果」
- `retryable` (boolean, 必填): `false`（fail-closed 终态，不可重试）—— 来源 PRD「可观测结果」
- `reason` (string, 必填): **禁用值 `"mapper_stale"`**（PRD：不再折叠成通用 mapper_stale）；固定写 `"mapper_deterministic"`（AI_ADDED，见下）

### 瞬时不可达出口（stale/unknown + reason_code 空/null/空白）— 语义不回退
```json
{ "gate": "impact_unknown", "reason": "mapper_stale", "retryable": true }
```
- `reason` (string, 必填): `"mapper_stale"`（原有值，字面保留）—— 来源 PRD「反向保留」
- `retryable` (boolean, 必填): `true`（原有重试语义）—— 来源 PRD「反向保留」

**禁用字段名/值**: 确定性出口的 `reason` **禁**写 `mapper_stale`；确定性出口 **禁** `retryable: true`（这正是被修复的 bug）。

---

## 确定性判据（PRD ASSUMPTION 锚定 map-client 契约）

读 `packages/brain/src/impact-contract/map-client.js` JSDoc + `contract-schema.js` FreshnessEvidenceSchema 得：
`freshness = { status: 'fresh'|'stale'|'unknown', reason_code: string|null }`（`reason_code` 为 optional string，可 null）。

**判据（与 PRD 边界逐条对齐）**：`mapperResult.freshness.reason_code` 为**非空白字符串** ⇒ 确定性终局结论 ⇒ fail-closed 透传 + `retryable:false`；否则（null/undefined/空串/纯空白）⇒ 瞬时不可达 ⇒ `mapper_stale` + `retryable:true`。

- 对齐 PRD 边界①：`status` 非 fresh 但 `reason_code` 空/null → 瞬时，保留 retryable ✅
- 对齐 PRD 边界②：`reason_code` 存在但非 `deny:*` 确定性拒绝类 → **默认 fail-closed**（宁可停不空转）✅ —— 故判据用「非空白」而非「必须匹配 deny: 前缀白名单」，符合「默认 fail-closed」的 PRD 指令
- 对齐 PRD 边界③：Mapper 完全不可达（抛错）→ 维持既有 `mapper_unavailable`/`db_unavailable` retryable 出口（步骤 2 的 catch，本 sprint 不动）✅

---

## Golden Path

[harness 任务编码完成进入 Diff Impact Gate] → [步骤 3a 识别 Mapper 结论是否确定性] → [确定性→透传 reason_code + fail-closed 终态；瞬时→mapper_stale 重试]

### Step 1: Diff Impact Gate 触发，Mapper 返回非 fresh 且携带确定性 reason_code
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步（Mapper 返回 `freshness.status='stale'|'unknown'` 且携带 `freshness.reason_code`）

**可观测行为**: `evaluateDiffGate` 走到步骤 3a，检测到 `freshness.status !== 'fresh'` 且 `freshness.reason_code` 非空。

**验证命令**:
```bash
(cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const db={query:async()=>({rows:[{id:"c1",repo:"cecelia",base_revision:"base",contract_body:{affected_capabilities:[],required_assertions:[]}}]})};
const mapClient=async()=>({manifest_digest:"1".repeat(64),projection_digest:"2".repeat(64),fact_revisions:{cecelia:"base"},freshness:{status:"stale",reason_code:"deny:impact:manifest_unclaimed"},affected_nodes:[],required_assertions:[]});
const r=await evaluateDiffGate({db,taskId:"t",repo:"cecelia",headRevision:"head",mapClient});
if(r.reason_code==="deny:impact:manifest_unclaimed"&&r.retryable===false)process.exit(0);
console.error("FAIL",JSON.stringify(r));process.exit(1);')
```
**硬阈值**: `reason_code === "deny:impact:manifest_unclaimed"` 且 `retryable === false`

---

### Step 2: 确定性结论透传 reason_code 并走 fail-closed 终态出口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2-3 步（透传到 verdict.reason_code + `retryable:false` + 不折叠 mapper_stale）

**可观测行为**: verdict 携带原始 `reason_code`，`retryable:false`，`reason !== 'mapper_stale'`，`gate` 仍为 `impact_unknown`（不新增枚举）。

**验证命令**: 见 contract-dod.md B-01（node -e 直验 verdict 四字段）

**硬阈值**: `gate==="impact_unknown"` ∧ `reason_code` 透传原文 ∧ `retryable===false` ∧ `reason!=="mapper_stale"`

---

### Step 3: 瞬时不新鲜（无 reason_code）保留 mapper_stale + retryable 重试
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步「反向保留」+「边界情况①」

**可观测行为**: `freshness.status` 非 fresh 但 `reason_code` 空/null/空白 → verdict `reason:'mapper_stale'` + `retryable:true`（原语义不回退）。

**验证命令**: 见 contract-dod.md B-03 / B-04

**硬阈值**: `reason==="mapper_stale"` 且 `retryable===true`

---

### Step 4: fail-closed 铁律 — 不可判定情形绝不假绿放行
**来源**: `[AI_ADDED]` — Invariant [fail-closed]（PRD Invariant 段，SSOT diff-gate.js 头部原则）。理由：防止 generator 把确定性拒绝改成 pass/extend/drift 放行绕过。

**可观测行为**: 确定性与瞬时两条出口都返回 `gate:'impact_unknown'`，**绝不**返回 `pass`/`extend`/`drift`（即绝不进入放行裁决）。

**验证命令**: 见 contract-dod.md B-05（全量回归套件绿，含既有 fail-closed 用例不回退）

**硬阈值**: `gate==="impact_unknown"`（两条出口）；`diff-gate.test.js` 全绿

---

## 禁 mock 边清单

本单改动**不涉及** DB 写路径 / 状态机 / 跨模块数据传递 / 生命周期钩子 / 调度——仅在 `evaluateDiffGate` 步骤 3a 内新增一个基于 `freshness.reason_code` 的纯分流分支（读入参、造 verdict 出参，无副作用）。

- 代码 ↔ 被测函数 `evaluateDiffGate`：**禁 mock**——所有 [BEHAVIOR] 必须真跑 `evaluateDiffGate`（node -e / vitest），不得替身该函数本身。
- Mapper 结果注入属**允许的外层边界**：PRD「范围限定」明确「Mapper 本身产出 reason_code 的实现」**不在范围内**；`map-client.js` 有独立 `map-client.test.js` 回归。故 [BEHAVIOR] 按 `map-client.js` JSDoc 契约 shape 注入 `mapClient` 返回值（`freshness.status` + `reason_code`），与仓库既有全部 diff-gate 单测同款依赖注入，非违约。
- 代码 ↔ DB：仅经 `getActiveImpactContract` **读**（不改写路径），沿用既有 mock db 注入；本单无 DB 写路径改动，故无需真 Postgres（runtime_resources.postgres=false 佐证）。

## 已知约束（来自回归测试 + 累积 FR）

- [diff-gate.test.js] → `没有 active contract 时 fail-closed，且不调用 Mapper`（步骤 1 短路，本单不得破坏）
- [diff-gate.test.js] → `Mapper.radius() 超时时 Diff Gate 返回 blocked（不放行）`（步骤 2 catch `mapper_unavailable` retryable，本单不动）
- [diff-gate.test.js] → `Mapper revision mismatch 时 Diff Gate 返回 blocked`（步骤 3b，本单不动）
- [diff-gate.test.js] → `fact_revisions 缺少目标 repo 时返回 impact_unknown`（步骤 3b `revision_evidence_missing`，本单不动）
- [diff-gate.test.js] → `同一 base revision 的 projection digest 漂移时刷新合同版本` / `manifest_digest_mismatch`（步骤 3b，本单不动）
- [累积FR] context-manifest: 本 line（journey e6f803f2）暂无已验收 ability 历史（PRD 累积 FR 段）
- [MAP_NOT_CONFIGURED] task.payload.map_scope/map_repo 未注入（本 sprint 修的是 Map 消费方 Gate，非 Map 产出；must_run_assertions 空）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 步骤 3a：Mapper 非 fresh 且 `freshness.reason_code` 非空白 → 透传 reason_code + `retryable:false` fail-closed 出口；否则保留 `mapper_stale`+`retryable:true` |
| **NFR（做得多好）** | 非功能 | 有界重试：确定性结论 0 次重试（`retryable:false`）；可观测：verdict 必带原始 reason_code |
| **Invariant（永不违反）** | 不变量 | [fail-closed] 两条出口均 `gate:impact_unknown`，绝不 pass/extend/drift 放行；纯函数无副作用（不写 DB、不阻塞任务） |
| **判定点（怎么知道）** | 见下方登记表 | 见判定点登记表 |
| **保质期（何时过期）** | 失效 | N/A —— 分流逻辑随 map-client `freshness` 契约存续；契约变更由 map-client 自身回归守护 |
| **死亡告警（停了谁知道）** | 告警 | N/A（纯裁决逻辑，无外部依赖存活假设）；退化表现=空转重试，本修复即消除该黑洞 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明——分流本身不抛错；上游 DB/Mapper 不可达仍走既有 retryable 出口 |
| **效果确认（已发≠已生效）** | 回执 | verdict 返回值即回执；evaluator 用 node -e 断言四字段 = 生效确认 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ Mapper 结论是否「确定性终局」 | A. `reason_code` 非空白即确定性; B. 仅 `deny:*` 前缀白名单算确定性 | A. `reason_code` 非空白即确定性（fail-closed 归类） | PRD 边界②指令「非确定性拒绝类默认 fail-closed（宁可停不空转）」，白名单会把未知码误放回无限重试黑洞 | 若误判：把瞬时码当确定性 → 本应重试的停了（可人工复核，非静默丢数据）；反向漏判才是原 bug（确定性当瞬时→无限空转） |
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 示例占位 | 示例占位 |

> ⚠️ 判定点 A 属「误判后果需人工把关」级别，但 PRD ASSUMPTION 已明确「默认 fail-closed」为 PrepPRD 认可方向；`judgment-pending-user: Mapper 确定性判据取「非空白」而非「deny:* 白名单」`（notes 待主理人复核，当前按 PRD 边界②执行）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 确定性 reason_code（stale/unknown） | 拦截：`impact_unknown` + `retryable:false`，任务落终态 | N/A（终态不重试） | fail-closed，交人工/上游处理确定性拒绝根因 |
| 瞬时不新鲜（无 reason_code） | 拦截：`impact_unknown` + `retryable:true` | 是（幂等：同输入同 verdict） | 交上游重试循环 |
| DB / Mapper 抛错 | 既有 `db_unavailable`/`mapper_unavailable` + `retryable:true`（本单不改） | 是 | 上游重试 |

### 输入对抗面

N/A —— `evaluateDiffGate` 为 Brain 内部函数，入参来自受信的合同库与 Mapper 客户端，非对外暴露 agent，无外部用户可写入面。

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯函数 vitest 套件 oracle）

**journey_type**: autonomous
**target_environment**: local_api

> 本改动是 Brain 内部纯函数分流，verifiable oracle = `evaluateDiffGate` 单测套件（依赖注入 mock db + mapper 结果，与仓库既有全部 diff-gate 单测同款）。runtime_resources.postgres=false 佐证无需真 DB；不启真实 API/Postgres，直接以 vitest 跑该模块套件（含本轮新增 3a 分流用例 + 既有 fail-closed 回归全绿）。
> vitest 工作目录死规则：`packages/brain/src/**` 套件必须子 shell 切进包根跑（根 vitest include 不覆盖 src/**）。

```bash
#!/bin/bash
set -euo pipefail

# 1. 跑 diff-gate 全量套件（含本轮新增步骤3a分流用例 + 既有 pass/extend/drift/fail-closed 回归）
#    子 shell 切进 packages/brain（用该包 vitest 配置；从仓库根跑会 No test files found）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=verbose) \
  || { echo "FAIL: diff-gate.test.js 套件未全绿"; exit 1; }

# 2. 直验 Golden Path：确定性结论透传 reason_code + fail-closed（node -e 真跑 evaluateDiffGate）
(cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const db={query:async()=>({rows:[{id:"c1",repo:"cecelia",base_revision:"base",contract_body:{affected_capabilities:[],required_assertions:[]}}]})};
const det=await evaluateDiffGate({db,taskId:"det",repo:"cecelia",headRevision:"head",mapClient:async()=>({manifest_digest:"1".repeat(64),projection_digest:"2".repeat(64),fact_revisions:{cecelia:"base"},freshness:{status:"stale",reason_code:"deny:impact:manifest_unclaimed"},affected_nodes:[],required_assertions:[]})});
if(!(det.gate==="impact_unknown"&&det.reason_code==="deny:impact:manifest_unclaimed"&&det.retryable===false&&det.reason!=="mapper_stale")){console.error("FAIL det",JSON.stringify(det));process.exit(1);}
const tr=await evaluateDiffGate({db,taskId:"tr",repo:"cecelia",headRevision:"head",mapClient:async()=>({manifest_digest:"1".repeat(64),projection_digest:"2".repeat(64),fact_revisions:{cecelia:"base"},freshness:{status:"stale"},affected_nodes:[],required_assertions:[]})});
if(!(tr.gate==="impact_unknown"&&tr.reason==="mapper_stale"&&tr.retryable===true)){console.error("FAIL transient",JSON.stringify(tr));process.exit(1);}
console.log("OK E2E: 确定性透传+fail-closed 与瞬时 mapper_stale 重试双出口正确");')

echo "✅ Golden Path 验证通过（Diff Impact Gate 步骤 3a 确定性/瞬时双出口）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（纯函数低风险，取默认下限）
高风险面:
- 错输入: `freshness` 为 `undefined`/`null`（应仍走瞬时 mapper_stale retryable，绝不抛错）；`freshness.reason_code` 为非字符串（数字/对象）——应按非确定性归瞬时或防御性 String 化，绝不放行
- 重复提交: 同一 stale+reason_code 输入连续调用两次，verdict 幂等一致（`retryable:false` 不因重复变 true）
- 中途中断: N/A（同步纯函数，无中断点）
- 边界值: `reason_code` = 空串 `""` / 纯空白 `"   "` / 前后含空白的确定性码 `" deny:x "`（trim 后非空应判确定性）；`status='fresh'` 但携带 reason_code（应正常进入 3b 对账，不被 3a 拦截）
发现分级: P0/P1（把确定性当瞬时→空转黑洞复发 / 把不可判定放行）→ 阻塞 merge；P2/P3（reason 文案）→ 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 步骤3a 确定性透传 | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | `透传 reason_code 且 retryable=false` / `unknown 状态携带确定性 reason_code 时同样 fail-closed 透传` / `保留 mapper_stale + retryable=true` / `reason_code 为空字符串/空白视为瞬时` | 修复前 2 failed（reason_code undefined、retryable=true）｜2 passed（瞬时控制组）→ 修复后 4 passed |

> Test File 为仓库既有测试（`packages/...`），依 skill v9.26 Test Contract 死规则不受封印闸 `assertTestContractResolvable` 约束；PRD「预期受影响文件」明确要求新增回归测试落此文件（与全部 diff-gate 单测同目录）。
