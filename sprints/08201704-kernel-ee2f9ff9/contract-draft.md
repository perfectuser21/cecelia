# Sprint Contract Draft (Round 1)

**锚定父路声明**：独立小路（无父路）— 本 sprint 修 `evaluateDiffGate` Map 可判定性校验分支（step 3a），无上游 Golden Path 依赖。

gp-anchor: skipped (product-map.json not found)
contract-gate: skipped (file not found, third-party repo — cecelia 无 packages/brain/src/lib/contract-gate.js)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

N/A — 任务无 HTTP 响应。本 sprint 改的是 Brain 内部纯函数 `evaluateDiffGate` 的**返回对象**分类逻辑，不新增/不改任何 HTTP 端点（PRD 第 22 行注释 + target_environment=local_api 但为内部裁决）。故无 REST Response Schema。

被改函数的**返回对象契约**（step 3a 出口，codify 进 DoD 的 vitest expect / node 断言）：

```jsonc
// 确定性结论（Map 携带非瞬态 reason_code）→ fail-closed 有界出口
{ "gate": "impact_unknown", "reason": "<真实 reason_code>", "reason_code": "<真实 reason_code>", "retryable": false }
// 真·瞬态过期（reason_code ∈ 瞬态白名单）→ 保留原重试语义
{ "gate": "impact_unknown", "reason": "mapper_stale", "reason_code": "<瞬态码>", "retryable": true }
```

**禁用字段名**：`unknown`（NFR 第 59 行：reason 不得吞成 `unknown`）；`mapper_stale`（确定性出口严禁复用此 reason）。

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → `Mapper 抛出异常 → fail-closed → impact_unknown`（reason=mapper_unavailable, retryable=true，本 sprint 不得回退）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → `manifest_digest_mismatch / revision_mismatch（fresh 分支 step 3b）→ impact_unknown`（step 3b 现状 retryable=true，**不在本 sprint 范围**，见范围限定）
- [累积FR] context-manifest: unavailable（postgres=false，端点不可达，按协议记一行不静默跳过）
- [SSOT diff-gate.js 模块原则] fail-closed：Mapper 任何不可判定情形返回 blocked/impact_unknown，绝不假绿

## 判定点白名单 codify（读 state-resolver.js + radius.js 后确定）

进入 `evaluateDiffGate` step 3a 的确定性信号来源 = `mapperResult.freshness.reason_code`（map-client.js 第 116 行 shape：`freshness:{status,reason_code}`）。

**真·瞬态过期白名单**（事实快照/扫描过期，重新扫描即自愈 → 保留 `mapper_stale` + `retryable:true`，不误伤）：

| reason_code | 来源 | 语义 |
|---|---|---|
| `fact_snapshot_stale` | radius.js:82 | 事实快照过期，重扫自愈 |
| `fact_stale` | state-resolver.js:190 | 事实源过期，重扫自愈 |
| `projection_revision_missing` | radius.js:85 | 投影 revision 尚未建立，重算自愈 |

**确定性结论**（以上白名单**之外**的任何非 fresh reason_code，含 state-resolver terminal 码 `fail_current_revision`/`revision_mismatch`/`no_receipt`/`resolver_error`/`no_anchor` 与 radius terminal 码 `projection_revision_mismatch`/`manifest_projection_mismatch`/`graph_projection_revision_mismatch`/`capability_not_in_active_projection`/`impact_anchor_missing`/`unsafe_assertion_ref`/`assertion_identity_ambiguous`/`capability_assertion_coverage_missing`，以及 reason_code 缺失/为空）→ 透传 reason_code、`retryable:false` fail-closed 有界出口。

> **判定点决策（PRD 第 26 行 vs 第 28 行张力的显式解析）**：采用**瞬态白名单**模型而非确定性白名单模型。理由：(1) 真实 radius.js 中 `status!=='fresh'` 恒携带非空 reason_code，`reason_code` 缺失是纯防御性边界；(2) 按 Invariant「fail-closed / 确定即 retryable=false」，未识别或缺失的 reason_code 默认 fail-closed（有界终止）比默认无限重试更安全，直接满足 PRD 第 28 行「reason_code 缺失/为空但结论确定 → fail-closed，不得转回无限重试」；(3) PRD 第 26 行「无确定性 reason_code → mapper_stale」解读为「reason_code ∈ 瞬态白名单」，与第 28 行不冲突。白名单只含 3 个明确可自愈码，最小化「把瞬态误判成确定性」的误伤面。

## Golden Path

[run 进入 evaluateDiffGate] → [step 3a 识别 freshness 非 fresh 的 reason_code 是确定性还是瞬态] → [确定性透传 reason_code + retryable:false 有界终止；瞬态保留 mapper_stale + retryable:true]

---

### Step 1: 确定性 Map 结论透传 reason_code + fail-closed 有界出口
**来源**: `[FROM_PRD]` — PRD 第 18-20 行 Golden Path step 1-3、第 34-35 行范围限定。

**可观测行为**: Map 事实层返回带确定性 reason_code（如 `revision_mismatch`）且 `freshness.status !== 'fresh'` 时，`evaluateDiffGate` 返回 `reason` = 该 reason_code（非 `mapper_stale`）、`reason_code` = 同值、`retryable: false`。编排层据此落地 `deny:impact:revision_mismatch` 且有界终止。

**验证命令**:
```bash
cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const r = await evaluateDiffGate({ taskId:"t", repo:"cecelia", headRevision:"h", mapClient: async()=>({freshness:{status:"stale",reason_code:"revision_mismatch"}}) });
if (r.reason!=="revision_mismatch"||r.retryable!==false) { console.error("FAIL",JSON.stringify(r)); process.exit(1); }
console.log("OK",JSON.stringify(r));
'
# 期望：OK，reason=revision_mismatch，retryable=false
```

**硬阈值**: `reason==="revision_mismatch"` 且 `retryable===false` 且 `reason!=="mapper_stale"`。

---

### Step 2: 真·瞬态过期保留 mapper_stale + retryable=true（不误伤）
**来源**: `[FROM_PRD]` — PRD 第 20 行后半句、第 26 行边界情况。

**可观测行为**: `freshness.status !== 'fresh'` 且 reason_code ∈ 瞬态白名单（`fact_snapshot_stale`）时，仍返回 `reason: 'mapper_stale'` + `retryable: true`，保留原瞬态重试语义。

**验证命令**:
```bash
cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const r = await evaluateDiffGate({ taskId:"t", repo:"cecelia", headRevision:"h", mapClient: async()=>({freshness:{status:"stale",reason_code:"fact_snapshot_stale"}}) });
if (r.reason!=="mapper_stale"||r.retryable!==true) { console.error("FAIL",JSON.stringify(r)); process.exit(1); }
console.log("OK",JSON.stringify(r));
'
# 期望：OK，reason=mapper_stale，retryable=true
```

**硬阈值**: `reason==="mapper_stale"` 且 `retryable===true`。

---

### Step 3: reason_code 缺失/为空 → fail-closed 默认（不转回无限重试）
**来源**: `[AI_ADDED]` — PRD 第 28 行边界情况 codify；理由：防御性边界，未识别信号默认 fail-closed，符合 Invariant「确定即 retryable=false」，堵防御性缺口反而空转。

**可观测行为**: `freshness.status !== 'fresh'` 且 reason_code 为 `null`/`''` 时，返回 `retryable: false`（fail-closed 有界出口），reason 非 `mapper_stale`（不吞成 unknown，用具体 fail-closed 码）。

**验证命令**:
```bash
cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const r = await evaluateDiffGate({ taskId:"t", repo:"cecelia", headRevision:"h", mapClient: async()=>({freshness:{status:"stale",reason_code:null}}) });
if (r.retryable!==false||r.reason==="mapper_stale"||r.reason==="unknown") { console.error("FAIL",JSON.stringify(r)); process.exit(1); }
console.log("OK",JSON.stringify(r));
'
# 期望：OK，retryable=false，reason 非 mapper_stale/unknown
```

**硬阈值**: `retryable===false` 且 `reason!=="mapper_stale"` 且 `reason!=="unknown"`。

---

### Step 4: Mapper 不可达（抛异常）保持 mapper_unavailable + retryable=true（回归不破）
**来源**: `[FROM_PRD]` — PRD 第 27 行边界情况；回归保护 diff-gate.js 第 190-197 行现状。

**可观测行为**: mapClient 抛异常时，仍返回 `reason: 'mapper_unavailable'` + `retryable: true`，本 sprint 不改此路径。

**验证命令**:
```bash
cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const r = await evaluateDiffGate({ taskId:"t", repo:"cecelia", headRevision:"h", mapClient: async()=>{ throw new Error("timeout"); } });
if (r.reason!=="mapper_unavailable"||r.retryable!==true) { console.error("FAIL",JSON.stringify(r)); process.exit(1); }
console.log("OK",JSON.stringify(r));
'
# 期望：OK，reason=mapper_unavailable，retryable=true
```

**硬阈值**: `reason==="mapper_unavailable"` 且 `retryable===true`。

---

## 禁 mock 边清单

本单改动涉及**状态机/判定**（Gate verdict 分类）与**生命周期钩子**（impact-contract 裁决出口），故：

- 代码 ↔ `evaluateDiffGate` 分类分支（本单改的边）：回归测试必须**直调真实 `evaluateDiffGate`**，禁止 `vi.mock`/stub 该函数或其内部 step 3a 分类判定。
- 允许注入 `mapClient`：它是**更外层的 Mapper HTTP 依赖**（radius 端点），非被改的边——与仓库现有 diff-gate.test.js 惯例一致（依赖注入构造确定性投影）。
- DB 写路径**不在本单改动路径上**：step 3a 在任何 DB 副作用（gap 写入/block）之前返回，故测试省略 `db`，无需真 Postgres（runtime postgres=false 匹配）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | `evaluateDiffGate` step 3a 区分确定性 vs 瞬态：确定性透传 reason_code + retryable:false；瞬态保留 mapper_stale + retryable:true |
| **NFR（做得多好）** | | 同步纯函数判定，无新增外部 IO；无延迟/频控新增（PRD 第 56-58 行） |
| **Invariant（永不违反）** | | fail-closed：不可判定情形返回 impact_unknown 绝不假绿；确定即 retryable=false，不折叠成无限重试 mapper_stale |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | 瞬态白名单随 radius.js/state-resolver.js reason_code 取值演进；新增可自愈码需同步白名单（否则被 fail-closed 误伤，但方向安全） |
| **死亡告警（停了谁知道）** | | 编排层 `loop.js` 消费 `deny:impact:<reason>`；确定性出口落地具体 reason_code 后由现有 harness 归因/上报可见（PRD 第 59 行可观测） |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | Gate 返回对象即时生效（同步纯函数）；vitest expect / node 断言直接读返回对象，无异步回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ reason_code 是「确定性」还是「真·瞬态」 | A. 确定性白名单; B. 瞬态白名单(其余 fail-closed) | B. 瞬态白名单（仅 fact_snapshot_stale/fact_stale/projection_revision_missing），其余含缺失/空 → fail-closed | Invariant fail-closed 优先；真实 radius 非 fresh 恒有非空码，缺失是防御边界；瞬态误判面最小 | 误判「瞬态→确定性」=可自愈 run 被提前有界终止（方向安全，可重派）；误判「确定性→瞬态」=复现空转 bug（本 sprint 要消灭的，白名单仅 3 码最小化此风险） |

> ⚠️ 说明：该判定点误判「确定性→瞬态」后果为复现空转（原 bug），属需谨慎项；已在合同 notes 标 `judgment-pending-user` 供对齐会复核瞬态白名单取值。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 确定性 reason_code | impact_unknown + 透传 reason_code + retryable:false（有界终止，不重试） | 是（同输入同 reason_code/retryable，幂等纯函数） | 编排层落地 deny:impact:<reason> 上报，人工/上层介入 |
| 真·瞬态过期 | impact_unknown + mapper_stale + retryable:true（有界重试语义保留） | 是 | 编排层按现有 retry 退避（不在本 sprint 范围） |
| Mapper 抛异常 | impact_unknown + mapper_unavailable + retryable:true（不假绿） | 是 | 现有 retry，回归不破 |
| reason_code 缺失/空 | impact_unknown + fail-closed 具体码 + retryable:false | 是 | 默认有界终止，避免防御缺口空转 |

### 输入对抗面（对外暴露 agent 必填）

N/A — Brain 内部纯函数裁决，无对外暴露 agent 输入面；输入来自可信 Mapper 事实层（radius 端点）与内部合同存储。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本单为内部纯函数，风险面窄）
高风险面:
- 错输入: mapClient 返回 `freshness` 缺失（`undefined`）→ 应走 fail-closed（当前 step 3a 首条 `!mapperResult?.freshness` 已覆盖，验证仍 retryable 语义正确、reason 非 unknown 吞掉）
- 边界值: reason_code 为空字符串 `''`（区别于 null）→ 应与 null 同走 fail-closed retryable:false
- 混合态: `freshness.status==='fresh'` 但携带 reason_code（非 null）→ 不得进入 step 3a 折叠分支（fresh 优先，透传给 step 3b/4）
- 大小写/未知码: 未在任何白名单的新 reason_code（如 `some_future_code`）→ 默认 fail-closed retryable:false（方向安全）
发现分级: P0/P1（瞬态被误判成确定性致误伤、或确定性被折叠回 mapper_stale 复现空转）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 无 HTTP 端点、无 DB 副作用路径（postgres=false）：Golden Path 全程为 `evaluateDiffGate` 纯函数返回对象裁决，oracle = 直调真实函数（注入 Mapper 边界）断言返回对象 + 跑永久回归 vitest 套件。vitest 对 `packages/brain/src/**` 必须子 shell 切进包根跑（根 vitest include 不覆盖 src/**）。

```bash
#!/bin/bash
set -euo pipefail

echo "▶ 1) 永久回归套件（真实 evaluateDiffGate，子 shell 切包根用 brain vitest 配置）"
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=basic )

echo "▶ 2) 确定性透传 + 瞬态保留 + 缺失 fail-closed + 不可达回归（直调真实函数）"
( cd packages/brain && node --input-type=module -e '
import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
const mk = (reason_code, status="stale") => ({ freshness: { status, reason_code } });
const det = await evaluateDiffGate({ taskId:"e2e", repo:"cecelia", headRevision:"h", mapClient: async()=>mk("revision_mismatch") });
if (det.reason!=="revision_mismatch" || det.reason_code!=="revision_mismatch" || det.retryable!==false) { console.error("FAIL deterministic", JSON.stringify(det)); process.exit(1); }
const tr = await evaluateDiffGate({ taskId:"e2e", repo:"cecelia", headRevision:"h", mapClient: async()=>mk("fact_snapshot_stale") });
if (tr.reason!=="mapper_stale" || tr.retryable!==true) { console.error("FAIL transient", JSON.stringify(tr)); process.exit(1); }
const missing = await evaluateDiffGate({ taskId:"e2e", repo:"cecelia", headRevision:"h", mapClient: async()=>mk(null) });
if (missing.retryable!==false || missing.reason==="mapper_stale" || missing.reason==="unknown") { console.error("FAIL missing", JSON.stringify(missing)); process.exit(1); }
const unavail = await evaluateDiffGate({ taskId:"e2e", repo:"cecelia", headRevision:"h", mapClient: async()=>{ throw new Error("boom"); } });
if (unavail.reason!=="mapper_unavailable" || unavail.retryable!==true) { console.error("FAIL unavailable", JSON.stringify(unavail)); process.exit(1); }
const a = await evaluateDiffGate({ taskId:"e2e", repo:"cecelia", headRevision:"h", mapClient: async()=>mk("revision_mismatch") });
const b = await evaluateDiffGate({ taskId:"e2e", repo:"cecelia", headRevision:"h", mapClient: async()=>mk("revision_mismatch") });
if (a.reason_code!==b.reason_code || a.retryable!==b.retryable) { console.error("FAIL idempotent", JSON.stringify([a,b])); process.exit(1); }
console.log("✅ Golden Path 验证通过：确定性透传/瞬态保留/缺失 fail-closed/不可达回归/幂等 全过");
' )

echo "✅ E2E 验收通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 确定性透传 | `tests/diff-gate-deterministic-exit.test.ts` | `确定性 reason_code revision_mismatch 透传且 retryable=false` | 当前 reason=mapper_stale retryable=true → FAIL |
| 确定性透传(unknown态) | `tests/diff-gate-deterministic-exit.test.ts` | `确定性 reason_code fail_current_revision 透传且 retryable=false` | 当前 reason=mapper_stale → FAIL |
| 瞬态不误伤 | `tests/diff-gate-deterministic-exit.test.ts` | `真·瞬态过期 fact_snapshot_stale 仍 mapper_stale 且 retryable=true` | 当前已 mapper_stale（回归绿，防误伤）|
| 缺失 fail-closed | `tests/diff-gate-deterministic-exit.test.ts` | `reason_code 缺失 → fail-closed retryable=false` | 当前 retryable=true → FAIL |
| 幂等 | `tests/diff-gate-deterministic-exit.test.ts` | `确定性结论幂等：同输入两次 reason_code 与 retryable 一致` | 修复后确定性态一致 |
