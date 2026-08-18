# Sprint Contract Draft (Round 1)

**Sprint**: Diff Impact Gate 透传 reason_code + 确定性 stale fail-closed 出口（r19）
**journey_type**: autonomous
**target_environment**: local_api（postgres:false — 被改分支为进程内纯决策逻辑，node/vitest 直接验，无需真 DB）
**锚定父路声明**: 独立小路（无父 golden_path id；对应本 sprint Golden Path 第 3-4 步）

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在，按 gate-clean 惯用法书写）

---

## Response Schema（推导来源: PRD 字面 — evaluateDiffGate 函数返回对象，非 HTTP 响应）

> 本 task 无 HTTP 端点，被测对象是 `evaluateDiffGate(...)` 的返回对象。下述为其在 freshness 分流分支的返回契约。

### 函数: `evaluateDiffGate({ db, taskId, mapClient, headRevision, changedFiles, repo })`

**确定性 stale 结论出口（`mapperResult.freshness.status === 'stale'`）**:
```json
{"gate": "impact_unknown", "reason": "mapper_stale", "reason_code": "<透传 freshness.reason_code 或 null>", "retryable": false}
```
- `gate` (string, 必填): 字面 `"impact_unknown"` — 来源 PRD Golden Path 第 3 步
- `reason` (string, 必填): 字面 `"mapper_stale"` 保持不变 — 来源 PRD 第 3 步（reason 不改，仅新增 reason_code + 改 retryable）
- `reason_code` (string|null, 必填): **字面透传** `mapperResult.freshness.reason_code`；缺失时为 `null` — 来源 PRD 第 3 步 + 边界情况
- `retryable` (boolean, 必填): 字面 `false`（fail-closed 终态）— 来源 PRD 第 3 步

**不可判定/瞬时出口（`freshness.status === 'unknown'` 或 freshness 缺失）**:
```json
{"gate": "impact_unknown", "reason": "mapper_stale", "reason_code": "<透传 freshness.reason_code 或 null>", "retryable": true}
```
- `retryable` (boolean, 必填): 字面 `true`（保留可重试语义，不冤杀瞬时态）— 来源 PRD 第 4 步 + Invariant
- `reason_code` (string|null, 必填): 透传 `freshness.reason_code`（有则透传，无则 null）— 来源 PRD 第 4 步

**禁用字段名 / 禁止行为**（禁止 generator 漂移）:
- 禁止把确定性 stale 结论写成 `retryable: true`（这是本 bug 的根因）
- 禁止把 `freshness.status === 'unknown'` 写成 `retryable: false`（冤杀瞬时态，违反 Invariant [不冤杀瞬时态]）
- 禁止丢弃 `reason_code`（压成通用 `mapper_stale` 而不透传，是本 bug 的另一半）
- 禁止改动 `reason` 字段的字面值（仍为 `"mapper_stale"`）

**Error / fail-closed 语义**:
- 任何非 fresh 情形仍返回 `gate: "impact_unknown"`，绝不进入 pass/extend/drift（fail-closed，绝不假绿）

---

## Golden Path

[Gate 调用 Mapper 复算影响半径] → [按 freshness.status 结论分流] → [透传 reason_code + 确定性结论 fail-closed 终止 / 瞬时态可重试]

### Step 1: `evaluateDiffGate` 拿到 active contract 后调用 Mapper 复算影响半径
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步

**可观测行为**: 函数读取 active impact contract，调用注入/默认 mapClient，得到 `mapperResult.freshness = { status, reason_code }`。行为不变，仅作为后续分流输入。

**验证命令**:
```bash
# 复用既有回归：Mapper fresh 路径行为不变（pass/extend/drift 裁决全绿）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js)
# 期望：既有用例全部 pass（本步不改 fresh 行为）
```
**硬阈值**: 既有 diff-gate.test.js 全绿（exit 0）

---

### Step 2: `freshness.status === 'fresh'` — 行为不变
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步

**可观测行为**: fresh 时进入既有 revision 对齐 + `compareImpactContract` 对账（pass/extend/drift），返回不含本 sprint 新语义。

**验证命令**:
```bash
# fresh 分支既有 pass/extend/drift/revision_mismatch 用例不受影响
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js)
# 期望：20+ 既有用例全绿
```
**硬阈值**: exit 0，无既有用例回退

---

### Step 3: `freshness.status === 'stale'`（确定性结论）→ 透传 reason_code + `retryable: false`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 边界情况第 1 条

**可观测行为**: Gate 返回 `gate: 'impact_unknown'`，`reason_code` **字面透传** Mapper 的 `freshness.reason_code`（缺失则 null），且 `retryable: false`（fail-closed 终态出口，上游据此 block 任务，不再无限重试）。

**验证命令**:
```bash
# 真实调用 evaluateDiffGate（未 mock 被测函数），stale + reason_code → retryable:false + 透传
node --input-type=module -e 'import { evaluateDiffGate } from "./packages/brain/src/impact-contract/diff-gate.js"; const db={query:async()=>({rows:[{id:"c",repo:"cecelia",change_kind:"bugfix",base_revision:"base",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:"t",repo:"cecelia",headRevision:"head",mapClient:async()=>({freshness:{status:"stale",reason_code:"MAP_PROJECTION_STALE"}})}); if(r.gate!=="impact_unknown"||r.reason_code!=="MAP_PROJECTION_STALE"||r.retryable!==false){console.error("FAIL",JSON.stringify(r));process.exit(1);} console.log("OK");'
# 期望：OK（当前代码 exit 1，实现后 exit 0）
```
**硬阈值**: `gate === "impact_unknown"` 且 `reason_code === "MAP_PROJECTION_STALE"` 且 `retryable === false`

---

### Step 4: `freshness.status === 'unknown'`（不可判定/瞬时）→ 保留 `retryable: true` + 透传 reason_code
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + Invariant [不冤杀瞬时态]

**可观测行为**: Gate 仍返回 `reason: 'mapper_stale'`、`retryable: true`（保留可重试语义），并把 `reason_code`（若有）透传到结果。freshness 完全缺失也归入此瞬时态出口。

**验证命令**:
```bash
# unknown → retryable:true 且透传 reason_code
node --input-type=module -e 'import { evaluateDiffGate } from "./packages/brain/src/impact-contract/diff-gate.js"; const db={query:async()=>({rows:[{id:"c",repo:"cecelia",change_kind:"bugfix",base_revision:"base",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:"t",repo:"cecelia",headRevision:"head",mapClient:async()=>({freshness:{status:"unknown",reason_code:"MAP_INDETERMINATE"}})}); if(r.retryable!==true||r.reason_code!=="MAP_INDETERMINATE"){console.error("FAIL",JSON.stringify(r));process.exit(1);} console.log("OK");'
# 期望：OK
```
**硬阈值**: `retryable === true` 且 `reason_code === "MAP_INDETERMINATE"`

---

### Step 5: 可观测出口 — 确定性 stale run 走向 blocked 终态而非无限 retry
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步

**可观测行为**: 确定性 stale 结论下 `retryable: false` 使上游把任务判为终态 block；结果携带 Mapper 的 `reason_code` 供审计归因（消除 `deny:impact:mapper_stale` 无 reason 的黑盒空转）。

**验证命令**:
```bash
# 边界：stale 但 reason_code 缺失 → 仍 fail-closed（retryable:false），reason_code 透传为 null
node --input-type=module -e 'import { evaluateDiffGate } from "./packages/brain/src/impact-contract/diff-gate.js"; const db={query:async()=>({rows:[{id:"c",repo:"cecelia",change_kind:"bugfix",base_revision:"base",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:"t",repo:"cecelia",headRevision:"head",mapClient:async()=>({freshness:{status:"stale"}})}); if(r.retryable!==false||r.reason_code!==null){console.error("FAIL",JSON.stringify(r));process.exit(1);} console.log("OK");'
# 期望：OK
```
**硬阈值**: `retryable === false` 且 `reason_code === null`（缺失 reason_code 不得回退成无限重试）

---

## 已知约束（来自回归测试）

- [diff-gate.test.js] → `没有 active contract 时 fail-closed，且不调用 Mapper`（contract_missing → retryable:false，本 sprint 不改）
- [diff-gate.test.js] → `Mapper.radius() 超时时 Diff Gate 返回 blocked（不放行）`（mapper 异常 → impact_unknown, retryable:true，本 sprint 不改）
- [diff-gate.test.js] → `fact_revisions 缺少目标 repo 时返回 impact_unknown`（revision_evidence_missing, retryable:true，本 sprint 不改）
- [diff-gate.test.js] → `Mapper revision mismatch 时 Diff Gate 返回 blocked`（revision_mismatch，本 sprint 不改）
- [diff-gate.test.js] → 实际影响 ⊆ 声明影响 pass / 新增无断言 drift / extend 持久化（fresh 分支裁决，本 sprint 不改）
- [map-client.js 合同] → `freshness.status ∈ ['fresh','stale','unknown']`；`freshness.reason_code: string|null`（本 sprint reason_code 透传的来源契约）
- [累积FR] → context-manifest: unavailable（postgres:false / Brain API 不可达，端点未取；PRD「累积 FR」段声明本 line 暂无历史）
- [MAP_NOT_CONFIGURED] → task.payload.map_scope/map_repo 未注入（DB_URL 缺、Brain API 不可达）；无 must_run_assertions 注入，按 PRD scope 起草

## 已知回归约束（must_run_assertions）

- （无 — Unified Map radius 未配置/不可达，标 [MAP_NOT_CONFIGURED]，禁止回退领域硬编码）

---

## 禁 mock 边清单

本单类别判定：改动落在 `evaluateDiffGate` 步骤 3a 的 **freshness 结论分流 + 终态判定**（属「状态机/终态判定」类），但被改的是**函数内部纯决策逻辑**，不涉及跨模块数据传递的真实接缝，也不触及 DB 写路径。

- **evaluateDiffGate ↔ freshness 结论（被改的边，禁 mock 被测函数本身）**：测试必须真实调用 `evaluateDiffGate`（未 vi.mock / stub 该函数），由真实分流逻辑产出 `{ reason_code, retryable }`。`freshness` 是该纯决策函数的**输入**，经注入的 `mapClient` 提供——这是本 sprint 范围外的边界（map-client / map/radius 路由，另有 `map-client.test.js` 回归），属合法可注入输入，非被改的边。
- **DB 写路径（不在本单改动范围，故无需真 Postgres）**：stale/unknown 分支在步骤 5（drift → gap_events 写入 / block 任务）**之前**返回，本 sprint 不触碰任何 INSERT/UPDATE 路径。因此 `db` 用注入存根仅满足步骤 1 的 active contract 读取（返回早于任何写），符合 runtime_resources.postgres=false。若 generator 的改动意外落到 DB 写路径，即越出 scope，应判违约。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `evaluateDiffGate` 步骤 3a：透传 Mapper `freshness.reason_code`；`status==='stale'` → `retryable:false` fail-closed 终态；`status==='unknown'`/缺失 → `retryable:true` 保留可重试 |
| **NFR（做得多好）** | 非功能 | 进程内纯函数，无网络 NFR（PRD 未指定超时/频控/版本）；N/A |
| **Invariant（永不违反）** | 不变量 | [fail-closed] 非 fresh 均返回 impact_unknown 绝不假绿；[不冤杀瞬时态] unknown 必须 retryable:true（见 INV-1/INV-2） |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方登记表（stale=确定性 vs unknown=瞬时，依据 map-client freshness 枚举） |
| **保质期（何时过期）** | 失效/退役 | reason_code 随 Mapper 单次复算即时产生并透传，无独立保质期；N/A |
| **死亡告警（停了谁知道）** | 告警 | 上游消费 `retryable`/`reason_code` 落审计日志（`deny:impact:<reason_code>`）；本 sprint 不新增告警通道，N/A |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明（fail-closed：拦截不放行；stale=终态 block，unknown=可重试幂等） |
| **效果确认（已发≠已生效）** | 回执 | 函数同步返回对象即回执；node/vitest 断言返回 `{gate,reason_code,retryable}` 为效果确认 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ Mapper 结论是"确定性过期"还是"瞬时/不可判定" | A. Gate 自行推断新鲜度; B. 直接采信 Mapper `freshness.status` 枚举（stale=确定性 / unknown=瞬时） | B. 采信 `freshness.status`：stale→终态、unknown→可重试 | map-client.js 合同固定枚举 `['fresh','stale','unknown']`，Mapper 是新鲜度权威，Gate 不重复判定 | 误把 unknown 当 stale→冤杀可自愈 run；误把 stale 当 unknown→无限重试空烧算力（runs f62c7e87/d1360a48） |
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |

> ⚠️ 判定点已由 PRD ASSUMPTION（据 map-client.js 合同枚举）锚定，非本 sprint 新拍板；无需升用户，故不加 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| freshness.status==='stale'（确定性过期） | 返回 impact_unknown + retryable:false，上游 block 任务（不放行） | 否（终态，重试不自愈，故 fail-closed 终止） | 无降级——block 是正确终态，由人/上游处理坏 run |
| freshness.status==='unknown' 或缺失（瞬时） | 返回 impact_unknown + retryable:true，上游可重试 | 是（幂等，重算可能转 fresh） | 保留可重试语义，等待瞬时态自愈 |
| Mapper 抛异常 / DB 不可达 / revision 不对齐 | 既有 impact_unknown + retryable:true（本 sprint 不改） | 是 | 既有行为不变 |

### 输入对抗面（对外暴露 agent 必填）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A — 进程内纯函数，无对外暴露 agent / 外部可写接口 | — | — | — |

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `freshness` 为 `{status:'stale', reason_code: 123}`（非字符串 reason_code）/ `{status:'STALE'}`（大小写）/ `freshness:null` — 确认不崩、按契约分流（大小写不匹配枚举应归入非 stale 的瞬时出口 retryable:true）
- 重复提交: 连续两次同 taskId + stale 复算，两次结果一致（幂等，均 retryable:false + 同 reason_code）
- 中途中断: fresh 分支不受本次改动影响（drift/extend 写库路径回归全绿）
- 边界值: `reason_code` 为空字符串 `""` vs `null` — 空串按 `?? null` 是否透传为 `""`（应保留原值透传，不强制转 null，仅缺失/undefined 才为 null）
发现分级: P0/P1（stale 仍 retryable:true 空烧 / unknown 被误杀）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，postgres:false 纯函数 node/vitest）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 被改分支为进程内纯决策逻辑，`runtime_resources.postgres=false`；stale/unknown 出口在任何 DB 写入之前返回，故 E2E **无需** migration/真 DB bootstrap（skill local_api 模板的空库自举仅适用于依赖 DB 的合同，本合同不依赖）。E2E 直接跑 node 断言 + vitest 回归。
> vitest 工作目录死规则：对 `packages/brain/src/**` 的 vitest 用子 shell `(cd packages/brain && ...)`；sprints/** 下的合同测试从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail

echo "▶ [1/4] 确定性 stale + reason_code → gate=impact_unknown, reason_code 透传, retryable=false"
node --input-type=module -e 'import { evaluateDiffGate } from "./packages/brain/src/impact-contract/diff-gate.js"; const db={query:async()=>({rows:[{id:"c",repo:"cecelia",change_kind:"bugfix",base_revision:"base",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:"t",repo:"cecelia",headRevision:"head",mapClient:async()=>({freshness:{status:"stale",reason_code:"MAP_PROJECTION_STALE"}})}); if(r.gate!=="impact_unknown"||r.reason_code!=="MAP_PROJECTION_STALE"||r.retryable!==false){console.error("FAIL stale",JSON.stringify(r));process.exit(1);} console.log("OK stale");'

echo "▶ [2/4] 边界：stale 但 reason_code 缺失 → retryable=false, reason_code=null（不回退无限重试）"
node --input-type=module -e 'import { evaluateDiffGate } from "./packages/brain/src/impact-contract/diff-gate.js"; const db={query:async()=>({rows:[{id:"c",repo:"cecelia",change_kind:"bugfix",base_revision:"base",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:"t",repo:"cecelia",headRevision:"head",mapClient:async()=>({freshness:{status:"stale"}})}); if(r.retryable!==false||r.reason_code!==null){console.error("FAIL stale-null",JSON.stringify(r));process.exit(1);} console.log("OK stale-null");'

echo "▶ [3/4] unknown 瞬时态 → retryable=true, reason_code 透传（不冤杀瞬时态）"
node --input-type=module -e 'import { evaluateDiffGate } from "./packages/brain/src/impact-contract/diff-gate.js"; const db={query:async()=>({rows:[{id:"c",repo:"cecelia",change_kind:"bugfix",base_revision:"base",contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:"t",repo:"cecelia",headRevision:"head",mapClient:async()=>({freshness:{status:"unknown",reason_code:"MAP_INDETERMINATE"}})}); if(r.retryable!==true||r.reason_code!=="MAP_INDETERMINATE"){console.error("FAIL unknown",JSON.stringify(r));process.exit(1);} console.log("OK unknown");'

echo "▶ [4/4] 回归：sprint 新测试 + 既有 diff-gate.test.js 全绿"
npx vitest run sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-code.test.js --reporter=basic
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=basic)

echo "✅ Golden Path 验证通过（reason_code 透传 + 确定性 stale fail-closed + 瞬时态可重试 + 回归全绿）"
```

**通过标准**: 脚本 exit 0（4 段全过）
**FAIL 标准**: 任一段 exit≠0（stale 仍 retryable:true / reason_code 未透传 / unknown 被误杀 / 既有回归回退）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 确定性 stale fail-closed + reason_code 透传 | `sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-code.test.js` | `返回 retryable false 且透传 reason_code` / `reason_code 缺失 仍 fail-closed retryable false` / `unknown 瞬时态 保留 retryable true` / `freshness 完全缺失 视为瞬时态 保留 retryable true` | → 4 failures（当前 reason_code undefined、stale retryable=true）|
| 既有 fresh/drift/extend/mapper 异常回归 | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | 既有 20 用例 | → 全绿（不得回退）|
