# Sprint Contract Draft (Round 1)

任务：fix(harness) — Diff Impact Gate 第 3a 步把 Mapper `freshness.status !== 'fresh'` 的**所有**情形折叠成 `mapper_stale/retryable:true`，导致确定性 reason_code（重试不会变）被当瞬时态无限重试，run 空转到不了 merge fence。本 sprint 让 3a 透传具体 `reason_code` 并按「瞬时白名单 vs 确定性」分类 `retryable`，未知码默认 fail-closed。

gp-anchor: skipped (product-map.json not found)

## 锚定父路声明

独立小路（无父路）——journey e6f803f2 下 ability 均为 planned，本 line 无 done/working golden_path 可锚定（PRD 累积 FR 段确认）。

## Response Schema（推导来源: PRD 字面 / 内部函数返回，非 HTTP）

N/A — 任务无 HTTP 响应。本改动为 Brain 内部纯内存裁决函数 `evaluateDiffGate` 的返回值契约，非对外 endpoint。为消除歧义，下方登记被改函数的返回 shape（ground truth = PRD Golden Path 第 3 步，字段名不可漂移）：

### Function: `evaluateDiffGate(...)` — 步骤 3a（Mapper stale 分支）返回值

```json
{"gate": "impact_unknown", "reason": "<具体 reason_code 字符串>", "retryable": <boolean>}
```

- `gate` (string, 必填): 固定 `"impact_unknown"`（3a 分支不变）。来源——PRD Golden Path 第 3 步字面。
- `reason` (string, 必填): **具体 reason_code**（如 `"capability_not_in_active_projection"` / `"fact_snapshot_stale"`）；仅当 `freshness` 缺失（reason_code 为 null）时回落为 `"mapper_stale"`。来源——PRD Golden Path 第 3 步「reason 携带具体 reason_code」。
- `retryable` (boolean, 必填): 瞬时白名单命中或 reason_code 为 null → `true`；其余确定性/未知码 → `false`。来源——PRD Golden Path 第 2 步。

**禁用字段名**（不得出现在本分支返回或断言的正向匹配里）：无新增字段；严禁把确定性码返回时仍写死 `reason: "mapper_stale"`（裸标签即 bug）。

**瞬时白名单（唯一两项，PRD 显式点名）**：`fact_snapshot_stale`、`projection_revision_missing`。
**确定性码（fail-closed，来自 `packages/brain/src/map/radius.js` 实际产出，非枚举依赖——白名单外一律 fail-closed）**：`projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch` / `capability_not_in_active_projection` / `impact_anchor_missing` / `unsafe_assertion_ref` / `assertion_identity_ambiguous` / `capability_assertion_coverage_missing` 及**任何未来未知码**。

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` — 现有用例：`情形一 pass`、`情形二 extend`、`情形三 CONTRACT_IMPACT_DRIFT`、`fail-closed：revision_evidence_missing / Mapper 超时 blocked / revision_mismatch`。本 sprint 只改 3a（freshness 折叠），**不得回退**这些既有断言（3b/3c revision & digest mismatch 分支保持原 `reason`）。
- [回归测试] `packages/brain/src/impact-contract/__tests__/harness-gates.test.js:395/409` — 现有 merge-fence 用例通过 **DI mock `diffGate`** 返回 `reason:'mapper_stale'`，不调真实 `evaluateDiffGate`；本 sprint 改 3a **不影响**这两条（它们测的是 receipt 透传上游给定的 reason，属独立契约）。generator 不得删改这两条。
- [累积 FR] context-manifest: unavailable（本 line journey e6f803f2 下 ability 均 planned，无累积已验收行为）。
- [module 铁律] `diff-gate.js:12`「fail-closed：Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿」。本改动只收紧 retryable 语义，绝不新增放行路径。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | `evaluateDiffGate` 3a 透传 `mapperResult.freshness.reason_code` 到返回 `reason`；按瞬时白名单 vs 确定性/未知码判定 `retryable`。 |
| **NFR（做得多好）** | 非功能 | 纯内存分类，无新增 I/O；单次判定 O(1)。PrepPRD 未指定量化阈值（N/A）。 |
| **Invariant（永不违反）** | 不变量 | ①fail-closed：不新增任何放行路径，3a 仍返回 `gate:'impact_unknown'`。②无未知重试：白名单外 reason_code 一律 `retryable:false`。 |
| **判定点（怎么知道）** | 判断假设 | 见「判定点登记表」。 |
| **保质期（何时过期）** | 失效 | 瞬时白名单是硬编码常量集；未来 radius.js 若新增瞬时码需同步扩白名单（否则新码默认 fail-closed，安全侧不会假绿）。N/A（无 token/数据时效）。 |
| **死亡告警（停了谁知道）** | 告警 | deny 收据带具体 reason_code 进 kernel 决策日志；若回落裸 `mapper_stale` 说明 3a 未透传（回归测试守卫）。 |
| **失败语义（挂了怎么办）** | 故障 | 见「失败语义声明」。核心：不可判定 → `impact_unknown`；未知码 → fail-closed（`retryable:false`），拦截优先。 |
| **效果确认（已发≠已生效）** | 回执 | `evaluateDiffGate` 同步返回值即回执；`gateReceipt('diff', result).reason` 必为具体码，非裸 `mapper_stale`。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ Mapper freshness 非 fresh 时该码可否重试 | A. 白名单式（仅两个瞬时码可重试，其余含未知全 fail-closed）; B. 黑名单式（枚举确定性码，未知默认可重试） | A. 白名单式 | 符合 diff-gate.js:12「任何不可判定情形绝不假绿」铁律，未来新增码安全侧 fail-closed 而非无限重试（PRD ASSUMPTION 显式选 A） | 选 B 会让未来未知确定性码走无限重试 → run 空转到不了 merge fence（本 bug 根因）；标 ⚠️：PRD ASSUMPTION 已在 PrepPRD 拍板此白名单，无待确认 |

> ⚠️ 判定点已由 PRD ASSUMPTION（白名单式 + 两个瞬时码）拍板，无 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| reason_code 命中瞬时白名单（fact_snapshot_stale/projection_revision_missing） | 返回 `retryable:true`，上游可重试 | 是（纯函数，同输入同输出） | 重试等待快照/投影就绪 |
| reason_code 为确定性码（白名单外已知码） | 返回 `retryable:false`，run 一次 fail-closed 停下 | 是 | 不重试；deny 收据带具体码供人工/kernel 区分 |
| reason_code 为未知/未来新增码 | 默认 `retryable:false`（fail-closed） | 是 | 同确定性码；扩白名单需显式改代码 |
| `freshness` 对象整体缺失（null） | reason_code 视为 null → `retryable:true`，`reason` 回落 `mapper_stale` | 是 | 视为 Mapper 尚未产出的瞬时态，可重试 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本改动是 Brain 内部函数级裁决逻辑，无对外暴露 agent、无外部可写入接口，输入来自内部 Mapper 复算结果（`mapperResult.freshness`），非用户输入。

## 禁 mock 边清单

本单改动属**状态机/裁决逻辑**（`evaluateDiffGate` 对 Mapper freshness 的可重试性裁决）。被改的边如下：

- `evaluateDiffGate` 分类逻辑 ↔ `mapperResult.freshness.reason_code`（本单改的就是这条：从 freshness 折叠改为按 reason_code 分类）——测试必须调**真实** `evaluateDiffGate`（不 mock 被测函数本体），只允许把**更外层的 Mapper 边界**（`mapClient` 函数）作为依赖注入替身喂入确定的 `freshness` 投影。这是本仓 `diff-gate.test.js` 既有的 DI 约定：Mapper 是 HTTP 外部边界（`map-client.js`），注入它构造确定投影，被测的分类逻辑全程真实执行。
- `gateReceipt` ↔ `result.reason`（透传边）——测试必须调**真实** `gateReceipt`（generator 需将其从 harness-gates.js 导出），断言它把具体 reason_code 原样带出，不 mock 该函数。

无需真 Postgres：被改逻辑与 DB 无关，测试走 `db: null` 路径（跳过 contract 读取，直接进 3a）。这也与本 attempt `runtime_resources.postgres=false` 一致。

## Golden Path

覆盖父路：独立小路（无父路）。

[worker PR head revision 进 Diff Impact Gate] → [evaluateDiffGate 调 Mapper 复算，freshness 非 fresh 带 reason_code] → [3a 按 reason_code 分类 retryable] → [确定性码 fail-closed 一次停下 / 瞬时码保留重试 / deny 收据带具体码]

### Step 1: Diff Impact Gate 复算，Mapper 返回非 fresh + 确定性 reason_code
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「Mapper 返回 freshness.status !== 'fresh' 且带确定性 reason_code」。

**可观测行为**: `evaluateDiffGate({db:null, mapClient: ()=>({freshness:{status:'stale',reason_code:'capability_not_in_active_projection'}})})` 进入 3a 分支。

**验证命令**:
```bash
node --input-type=module -e 'const m=await import("file://"+process.cwd()+"/packages/brain/src/impact-contract/diff-gate.js");const r=await m.evaluateDiffGate({db:null,taskId:"t",headRevision:"h",changedFiles:[],mapClient:async()=>({freshness:{status:"stale",reason_code:"capability_not_in_active_projection"}})});console.log(JSON.stringify(r));process.exit(r.reason==="capability_not_in_active_projection"&&r.retryable===false?0:1)'
# 期望：{"gate":"impact_unknown","reason":"capability_not_in_active_projection","retryable":false}，exit 0
```
**硬阈值**: `reason === "capability_not_in_active_projection"` 且 `retryable === false`（fail-closed）。

---

### Step 2: 按瞬时白名单分类可重试性
**来源**: `[FROM_PRD]` — Golden Path 第 2 步「瞬时白名单 = {fact_snapshot_stale, projection_revision_missing} 或 null → retryable:true；其余确定性码 → retryable:false（含未知码默认 fail-closed）」。

**可观测行为**: 瞬时码 → `retryable:true` 且 `reason` 为具体瞬时码；未知码 → `retryable:false`。

**验证命令**:
```bash
node --input-type=module -e 'const m=await import("file://"+process.cwd()+"/packages/brain/src/impact-contract/diff-gate.js");const c=(rc,miss)=>m.evaluateDiffGate({db:null,taskId:"t",headRevision:"h",changedFiles:[],mapClient:async()=>miss?({affected_nodes:[]}):({freshness:{status:"stale",reason_code:rc}})});let f=0;let r=await c("fact_snapshot_stale");if(!(r.reason==="fact_snapshot_stale"&&r.retryable===true)){f++;console.error("t1",JSON.stringify(r))}r=await c("projection_revision_missing");if(!(r.reason==="projection_revision_missing"&&r.retryable===true)){f++;console.error("t2",JSON.stringify(r))}r=await c("some_future_unknown_code");if(r.retryable!==false){f++;console.error("t3",JSON.stringify(r))}r=await c(null,true);if(r.retryable!==true){f++;console.error("t4",JSON.stringify(r))}process.exit(f?1:0)'
# 期望：t1/t2 retryable=true 带具体码；t3 未知码 retryable=false；t4 null retryable=true；exit 0
```
**硬阈值**: 瞬时两码 `retryable===true`、未知码 `retryable===false`、null `retryable===true`。

---

### Step 3: deny 收据透传具体 reason_code（非裸 mapper_stale）
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「gateReceipt 透传该具体 reason_code，deny 标签不再是裸 mapper_stale」。

**可观测行为**: `gateReceipt('diff', <确定性结果>).reason` 为具体码。

**验证命令**:
```bash
node --input-type=module -e 'const h=await import("file://"+process.cwd()+"/packages/brain/src/impact-contract/harness-gates.js");if(typeof h.gateReceipt!=="function"){console.error("gateReceipt not exported");process.exit(1)}const rc=h.gateReceipt("diff",{gate:"impact_unknown",reason:"capability_not_in_active_projection",retryable:false});console.log(JSON.stringify(rc));process.exit(rc.reason==="capability_not_in_active_projection"&&rc.reason!=="mapper_stale"?0:1)'
# 期望：receipt.reason === "capability_not_in_active_projection"，exit 0
```
**硬阈值**: `receipt.reason === "capability_not_in_active_projection"` 且 `!= "mapper_stale"`。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本改动为 Brain 内部纯内存裁决函数，无 DB/无起服务（PRD 明确：node 直调 evaluateDiffGate + 断言返回 reason/retryable）。空库自举规则 N/A（被改逻辑不触达数据库，测试走 `db:null` 路径）。evaluator 从仓库根直接 node 执行下方单块脚本。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 断言点全部覆盖 5 类分类 + gateReceipt 透传；被测函数真实执行，只注入 Mapper 外部边界替身。
node --input-type=module - <<'NODE'
const cwd = process.cwd();
const gm = await import("file://" + cwd + "/packages/brain/src/impact-contract/diff-gate.js");
const hm = await import("file://" + cwd + "/packages/brain/src/impact-contract/harness-gates.js");
const call = (reason_code, miss = false) => gm.evaluateDiffGate({
  db: null, taskId: "e2e", headRevision: "head", changedFiles: [],
  mapClient: async () => miss ? ({ affected_nodes: [] }) : ({ freshness: { status: "stale", reason_code } }),
});
let fail = 0;
const check = (name, cond, got) => { if (!cond) { console.error("FAIL:", name, JSON.stringify(got)); fail++; } else console.log("OK:", name); };

let r = await call("capability_not_in_active_projection");
check("1 确定性码 fail-closed", r.reason === "capability_not_in_active_projection" && r.retryable === false, r);

r = await call("fact_snapshot_stale");
check("2 瞬时 fact_snapshot_stale 保留重试", r.reason === "fact_snapshot_stale" && r.retryable === true, r);

r = await call("projection_revision_missing");
check("3 瞬时 projection_revision_missing 保留重试", r.reason === "projection_revision_missing" && r.retryable === true, r);

r = await call(null, true);
check("4 freshness 缺失(null) 保留重试", r.gate === "impact_unknown" && r.retryable === true, r);

r = await call("some_future_unknown_code");
check("5 未知码默认 fail-closed", r.retryable === false, r);

if (typeof hm.gateReceipt !== "function") { console.error("FAIL: gateReceipt 未导出"); fail++; }
else {
  const rc = hm.gateReceipt("diff", { gate: "impact_unknown", reason: "capability_not_in_active_projection", retryable: false });
  check("6 gateReceipt 透传具体码(非裸 mapper_stale)", rc.reason === "capability_not_in_active_projection" && rc.reason !== "mapper_stale", rc);
}

if (fail) { console.error("❌ E2E FAILED:", fail); process.exit(1); }
console.log("✅ Golden Path 验证通过（5 分类 + gateReceipt 透传）");
process.exit(0);
NODE
```

**通过标准**: 脚本 exit 0，6 条 check 全 OK。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本单为纯函数分类，风险面窄）
高风险面:
- 错输入: `freshness.reason_code` 传空字符串 `""`（非 null）→ 期望走确定性 fail-closed（`""` 不在白名单，`retryable:false`），不得被当 null 放行重试。
- 错输入: `freshness` 为 `{status:'fresh'}` 且**同时**带 `reason_code`（矛盾态）→ 期望仍走 fresh 正常裁决（3a 只在非 fresh 时触发），reason_code 被忽略。
- 边界值: `freshness={status:'unknown', reason_code:'graph_projection_revision_mismatch'}`（status 是 `unknown` 而非 `stale`）→ 期望仍进 3a（非 fresh 即触发），确定性码 fail-closed。
- 中途中断: 白名单码大小写/前后空格变体（如 `'Fact_Snapshot_Stale'`）→ 期望不匹配白名单 → fail-closed（严格相等，不做规整）。
发现分级: P0/P1（把确定性码误判成可重试 → 无限重试；或把瞬时码误判成 fail-closed → 假阻断）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 3a 分类 + gateReceipt 透传（冻结） | `sprints/08220132-kernel-d133c55c/tests/diff-gate-reason-code.contract.test.ts` | `确定性 reason_code fail-closed`、`瞬时 fact_snapshot_stale 保留重试`、`瞬时 projection_revision_missing 保留重试`、`freshness 缺失 null 保留重试`、`未知 reason_code 默认 fail-closed`、`gateReceipt 透传具体 reason_code` | → 6 failures（当前 3a 返回裸 mapper_stale/retryable:true；gateReceipt 未导出） |
| 回归补充（既有文件，非冻结） | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | 复用同断言，保证既有 pass/extend/drift/revision 分支不回退 | 补充行 |
