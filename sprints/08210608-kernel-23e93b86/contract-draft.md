# Sprint Contract Draft (Round 1)

**Sprint**: Diff Impact Gate 透传 Mapper reason_code 并对确定性结论 fail-closed 出口（r19）
**journey_type**: autonomous
**target_environment**: local_api
**锚定父路声明**: 独立小路（无父路）— journey golden-paths 仅有 planned 态 ability，本 sprint 是 Impact Contract 闸门内部缺陷修复，无已验收父路可挂载。

---

## Response Schema（推导来源: PRD 字面 — 内部函数返回契约，无 HTTP 端点）

**N/A — 任务无 HTTP 响应**：本 sprint 改动 `evaluateDiffGate()` 内部函数，非 REST 端点，Reviewer 第 6 维按内部函数返回契约核对。

### 内部函数返回契约: `evaluateDiffGate(...)` step 3a 非 fresh 出口

Mapper 复算返回 `freshness.status !== 'fresh'` 时，返回对象字面契约（PRD Golden Path 第 2-4 步逐字定义）：

```json
{ "gate": "impact_unknown", "reason": "<string>", "reason_code": "<string|null>", "retryable": true }
```

- `gate` (string, 必填): 恒为 `"impact_unknown"`（既有语义不变，来源: PRD 可观测结果）
- `reason` (string, 必填): **优先透传** `freshness.reason_code`；无 reason_code 时按 status 桶回退默认标签（来源: PRD 第 2-3 步）
  - `status === 'unknown'` 无 reason_code → 回退 `"mapper_unknown"`
  - `status === 'stale'` 无 reason_code → 回退 `"mapper_stale"`（PRD 第 3 步：无 reason_code 时才回退默认标签）
- `reason_code` (string|null, 选填): 透传 `freshness.reason_code`（无则 `null`），供 loop/寄存器机器可读定位（来源: `[AI_ADDED]` 观测增强，JSDoc 返回类型已声明该字段）
- `retryable` (boolean, 必填): **按 status 语义分流**（来源: PRD 第 2-3 步 + NFR 可判定性）
  - `status === 'stale'`（瞬态）→ `true`
  - `status === 'unknown'`（确定性）→ `false`（fail-closed 终局出口）
  - `freshness` 缺失/结构异常（status 非三枚举之一）→ `false`（fail-closed，见判定点登记表）

**禁用字段名**: `reason` 正向断言中**禁止**恒为字面 `"mapper_stale"`（NFR 可观测硬约束：确定性结论下 reason 不再恒为 `mapper_stale`）。

---

## Golden Path

[orchestrator loop 调用 Diff Impact Gate] → [Mapper 复算返回非 fresh] → [按 freshness.status 语义分流的可判定出口]

### Step 1: Gate 收到 Mapper 复算结果，`freshness.status !== 'fresh'`
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「Gate 收到 Mapper 复算结果，freshness.status !== 'fresh'」逐字。

**可观测行为**: `evaluateDiffGate()` 在 step 3a 判定分支（`diff-gate.js:201-207`），进入非 fresh 出口，不再进入 pass/extend/drift 对账。

**验证命令**:
```bash
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const r=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({freshness:{status:'unknown',reason_code:'x'}})}); if(r.gate!=='impact_unknown'){console.error('FAIL',r);process.exit(1)} console.log('OK')"
```
**硬阈值**: `gate === 'impact_unknown'`。验证命令见上（node 直调，退出码即真值）。

---

### Step 2: `freshness.status === 'unknown'`（Map 确定性结论）→ 透传 reason_code + fail-closed 终局出口
**来源**: `[FROM_PRD]` — Golden Path 第 2 步「当 freshness.status === 'unknown'：Gate 透传 freshness.reason_code 作为 reason，并以 fail-closed 终局出口返回 retryable: false」逐字。

**可观测行为**: 返回 `{ gate:'impact_unknown', reason:<freshness.reason_code>, retryable:false }`；orchestrator 据 `retryable:false` 终局收敛，`deny:impact` 空转消失。

**验证命令**:
```bash
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const r=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({freshness:{status:'unknown',reason_code:'capability_not_in_active_projection'}})}); if(r.reason!=='capability_not_in_active_projection'||r.retryable!==false){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK')"
```
**硬阈值**: `reason === 'capability_not_in_active_projection'` 且 `retryable === false`。

---

### Step 3: `freshness.status === 'stale'`（瞬态过期）→ 保留 retryable:true，reason 优先透传 reason_code
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「当 freshness.status === 'stale'：保留 retryable:true；reason 同样优先透传 freshness.reason_code，无 reason_code 时才回退默认标签」逐字。

**可观测行为**: 有 reason_code → `{ reason:<reason_code>, retryable:true }`；无 reason_code → `{ reason:'mapper_stale', retryable:true }`。

**验证命令**:
```bash
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const a=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({freshness:{status:'stale',reason_code:'projection_snapshot_expired'}})}); const b=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({freshness:{status:'stale',reason_code:null}})}); if(a.reason!=='projection_snapshot_expired'||a.retryable!==true||b.reason!=='mapper_stale'||b.retryable!==true){console.error('FAIL',JSON.stringify(a),JSON.stringify(b));process.exit(1)} console.log('OK')"
```
**硬阈值**: stale+code → `reason==='projection_snapshot_expired' && retryable===true`；stale 无 code → `reason==='mapper_stale' && retryable===true`。

---

### Step 4: 出口可判定 + 边界 fail-closed（freshness 缺失/结构异常）
**来源**: `[FROM_PRD]` — Golden Path 第 4 步可观测结果 + 边界情况「freshness 缺失或结构异常 → 仍 fail-closed，不得假绿」。`retryable:false` 的终局判定为 `[AI_ADDED]`（理由：见判定点登记表 ⚠️ 行，成功响应体但 freshness 结构异常属 Mapper 契约违背，非瞬态网络抖动，折成可重试会复活空转根因）。

**可观测行为**: `mapperFn` resolve 成功但返回体无 `freshness` 或 status 非三枚举 → 返回 `{ gate:'impact_unknown', retryable:false }`，走确定性终局出口。既有 `mapper_unavailable`（mapClient 抛错，更外层 catch）与 `revision_mismatch`（fresh 但 revision 不对齐）不受影响。

**验证命令**:
```bash
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const m=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({affected_nodes:[]})}); const u=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>{throw new Error('ETIMEDOUT')}}); if(m.gate!=='impact_unknown'||m.retryable!==false){console.error('FAIL missing-freshness',JSON.stringify(m));process.exit(1)} if(u.reason!=='mapper_unavailable'||u.retryable!==true){console.error('FAIL unavailable-regress',JSON.stringify(u));process.exit(1)} console.log('OK')"
```
**硬阈值**: 缺 freshness → `gate==='impact_unknown' && retryable===false`；mapper_unavailable → `reason==='mapper_unavailable' && retryable===true`（不回退）。

---

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 20 个既有回归全绿不得回退：`pass`/`extend`/`drift`/`revision_mismatch`/`manifest_digest_mismatch`/`revision_evidence_missing`/`mapper_unavailable`/drift 事务提交等。本改动只增 step 3a 分流，不得动 step 4-6 对账逻辑。
- [累积FR] context-manifest: unavailable（journey e6f803f2 仅 planned 态 ability，无已验收历史行为；PRD 累积 FR 段已注明本 line 暂无已验收历史）。
- [MAP_NOT_CONFIGURED] task.payload.map_repo 为空（map_scope=['F1'] 但无 repo），Unified Map radius 无 must_run_assertions 注入；不回退领域硬编码。

## 状态枚举 sweep 结果（Invariant [status 枚举 sweep] — 全仓库硬编码断言 sweep）

`grep -rn "status !== 'fresh'|mapper_stale" packages/brain/src --include=*.js`（排除 __tests__）折叠 Mapper 非 fresh → `mapper_stale`/retryable 的站点仅两处：

| 站点 | 语义 | 处置 |
|---|---|---|
| `diff-gate.js:202` | step 3a 折 `status !== 'fresh'` → `mapper_stale`/`retryable:true`（**本 sprint 目标**）| **本 sprint 修复**：按 stale/unknown 分流 + 透传 reason_code |
| `structure-gate.js:123-124` | rule 3 折 `status !== 'fresh'` → `mapper_stale` 503/`retryable:true`（同构折叠）| **已识别 · 本 sprint 不改**（见下方 deferred 说明）|

其余命中（`map/radius.js:381`=Mapper 产出侧、`map-state-resolver.js`、`harness-gates.js`、`orchestrator/preflight/map-impact-contract.js`）是 freshness 生产/前置巡检，非 diff-gate 折叠，PRD 范围限定明确「Mapper reason_code 产出逻辑本身」不在范围内 → 不动。

**structure-gate.js deferred 依据**：PRD 预期受影响文件仅列 `diff-gate.js` + `diff-gate.test.js`；范围限定「在范围内」= diff-gate.js step 3a；issue_ref 空转（runs f62c7e87/d1360a48）是 **diff-gate 的 `deny:impact:mapper_stale`（编码后）路径**，structure-gate 是编码前闸返回 HTTP 503 blocked（不同调用点）。B50 精简纪律 + 预期受影响文件权威 → structure-gate 同构修复作为已识别 deferred 站点登记（见 `## 未覆盖真实链路清单` 与 notes），不在本轮 scope 内蔓延。此 sweep 已满足 Invariant「做一次全仓库硬编码断言 sweep」的审计义务。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | Diff Gate step 3a 非 fresh 出口：透传 `freshness.reason_code` 作 `reason`；按 `status` 分流 `retryable`（stale→true / unknown→false） |
| **NFR（做得多好）** | 非功能需求 | 可判定性（确定性走终局出口）+ 可观测（reason 透传 reason_code）+ 无限重试防护（同一确定性结论不产生无界 `deny:impact` 重试），见 PRD NFR 段 |
| **Invariant（永不违反）** | 不变量 | ①确定性 `unknown` 必 `retryable:false`；②reason 不得恒为 `'mapper_stale'`；③freshness 缺失/异常不得假绿（fail-closed）；④既有 fail-closed 出口（mapper_unavailable/revision_mismatch/drift 对账）零回退 |
| **判定点（怎么知道）** | 模糊现实判断假设 | 见下方判定点登记表 |
| **保质期（何时过期）** | 何时失效 | N/A — 纯分支逻辑常量语义，无 token/数据保质期 |
| **死亡告警（停了谁知道）** | 告警手段 | 既有 orchestrator loop `deny:impact` 计数 + 寄存器；本改动使确定性结论透传 reason_code，反而增强根因可观测 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执方式 | 出口 `retryable:false` 由 orchestrator loop 消费终局收敛；回归测试断言返回体三字段（gate/reason/retryable）即效果 oracle |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| Mapper 非 fresh 是否可重试 | A. 全部折成可重试; B. 按 status 枚举（stale=瞬态可重试 / unknown=确定性终局） | B. 按 status 枚举分流 | PRD Golden Path 第 2-3 步逐字 + map-client freshness 契约已区分 stale/unknown | 误折 unknown 为可重试 → `deny:impact:mapper_stale` 无限空转（本 sprint 根因） |
| ⚠️ freshness 缺失/status 非三枚举时可重试性 | A. 折成 stale 可重试; B. 折成确定性终局 retryable:false | B. 确定性终局（retryable:false） | mapClient resolve 成功但缺 freshness = Mapper 契约违背（非瞬态网络抖动，网络抖动走更外层 catch→mapper_unavailable/retryable:true）；折成可重试会复活空转根因 | 误折可重试 → 结构异常持续空转；误折终局 → 极端下瞬态畸形响应被判死一次 attempt（可由上游重跑覆盖，代价可控） |

> ⚠️ 行判定点属「升拍板点主动请教用户」级别：PRD 边界情况仅写「freshness 缺失或结构异常 → 仍 fail-closed，不得假绿」，未逐字拍板 retryable 值。本合同取 fail-closed 最强义（retryable:false）以彻底消除空转，判定依据见上。
> judgment-pending-user: freshness 缺失/结构异常出口 retryable 值（本合同取 false，待主理人/对齐会确认）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Mapper resolve `unknown` + reason_code | 返回 `impact_unknown`/透传 reason_code/`retryable:false` | 幂等（纯函数，同输入同输出） | orchestrator 终局收敛，不重试 |
| Mapper resolve `stale` | 返回 `impact_unknown`/`retryable:true` | 幂等 | orchestrator 重试（瞬态刷新后可恢复） |
| Mapper resolve 缺 freshness/status 异常 | 返回 `impact_unknown`/`retryable:false`（fail-closed） | 幂等 | 终局收敛，不假绿放行 |
| Mapper 抛错（网络/timeout） | 更外层 catch → `mapper_unavailable`/`retryable:true`（既有，不改） | 幂等 | orchestrator 重试 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本改动为 Brain 内部 Impact Contract 闸门分支逻辑，无对外暴露 agent 输入面（Mapper 结果经 map-client.js 合同校验后进入，非外部用户可写）。

---

## 禁 mock 边清单

本单改动性质：`diff-gate.js` step 3a 判定/分流逻辑（决策闸），改的是「Mapper freshness → Gate verdict（reason/retryable）→ orchestrator loop 消费」这条跨模块数据传递边的**分流规则**。

- **禁 mock**：`evaluateDiffGate()` step 3a 分流逻辑本身 —— 回归测试必须**真实调用** `evaluateDiffGate`，禁止 stub/`vi.mock` diff-gate 自身或替身其返回值。真实分支必须真跑（tests/ 与 __tests__ 均真调）。
- **允许 mock（豁免登记）**：`mapClient`（上游 Mapper freshness 注入）—— PRD 范围限定明确「Mapper reason_code 产出逻辑本身」不在范围内，freshness 契约（`{status, reason_code}`）已由 `map-client.js` + `radius.test.js` 校验；注入 mapClient 是在**模块边界提供测试 fixture**（既有 diff-gate.test.js 全套沿用此 DI 模式），非替身被改的分流逻辑。
- **代码 ↔ DB 边**：本路径 **不触达** —— step 3a 在 step 4-6 对账/DB 写（drift block / extend persist）**之前**返回，`db:null` 即可确定性触发，无 DB 写边被 mock（无 Postgres 依赖，与 runtime_resources.postgres=false 对齐）。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

> cecelia 仓库根无 `product-map/generated/product-map.json`（该文件仅 zenithjoy-workspace 存在），本段整体跳过，不阻塞。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `mapClient` 返回 `freshness:{status:'garbage'}`（非三枚举）→ 应落 fail-closed retryable:false，禁止落 pass/undefined retryable
- 错输入: `freshness:{status:'unknown'}` 但 `reason_code` 为空串 `''`（非 null）→ 应回退 `mapper_unknown`（`||` 空串回退），不得透传空 reason
- 重复提交: 同一 unknown 输入连调两次 evaluateDiffGate → 返回体三字段完全一致（纯函数幂等，无状态泄漏）
- 边界值: `freshness:{status:'stale'}` 无 reason_code 字段（undefined 非 null）→ 应回退 `mapper_stale` retryable:true
- 中途中断: 无（纯同步分支，无异步中断面）
发现分级: P0/P1（unknown 被误折可重试 / 缺 freshness 假绿放行）→ 阻塞 merge；P2/P3（reason 标签措辞）→ 记 findings 不阻塞

---

## E2E 验收（local_api — autonomous，node 直调 + vitest 定向回归，无需 Postgres）

> target_environment=local_api。本 sprint step 3a 在 DB 对账前返回，注入 `db:null` + mock mapClient 即确定性覆盖 Golden Path 全部出口；vitest 回归落 `packages/brain` 自身 config 的 include（`src/**`），死规则：对 `packages/brain/src/**` 的 vitest 必须 `(cd packages/brain && npx vitest run ...)` 子 shell 执行，从仓库根跑必命中根 include（仅 sprints/**、tests/**）→ No test files found。sprint spec 测试（`sprints/**`）才允许从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. Golden Path Step 2 — unknown 确定性终局出口（透传 reason_code + retryable:false）
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const r=await evaluateDiffGate({db:null,taskId:'e2e',mapClient:async()=>({freshness:{status:'unknown',reason_code:'capability_not_in_active_projection'}})}); if(r.gate!=='impact_unknown'||r.reason!=='capability_not_in_active_projection'||r.retryable!==false){console.error('FAIL unknown',JSON.stringify(r));process.exit(1)} console.log('OK unknown terminal');"

# 2. Golden Path Step 3 — stale 瞬态可重试（透传 reason_code / 无则回退 mapper_stale）
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const a=await evaluateDiffGate({db:null,taskId:'e2e',mapClient:async()=>({freshness:{status:'stale',reason_code:'projection_snapshot_expired'}})}); const b=await evaluateDiffGate({db:null,taskId:'e2e',mapClient:async()=>({freshness:{status:'stale',reason_code:null}})}); if(a.reason!=='projection_snapshot_expired'||a.retryable!==true||b.reason!=='mapper_stale'||b.retryable!==true){console.error('FAIL stale',JSON.stringify(a),JSON.stringify(b));process.exit(1)} console.log('OK stale retryable');"

# 3. Golden Path Step 4 边界 — freshness 缺失 fail-closed（retryable:false，不假绿）+ mapper_unavailable 不回退
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const m=await evaluateDiffGate({db:null,taskId:'e2e',mapClient:async()=>({affected_nodes:[]})}); const u=await evaluateDiffGate({db:null,taskId:'e2e',mapClient:async()=>{throw new Error('ETIMEDOUT')}}); if(m.gate!=='impact_unknown'||m.retryable!==false){console.error('FAIL missing-freshness',JSON.stringify(m));process.exit(1)} if(u.reason!=='mapper_unavailable'||u.retryable!==true){console.error('FAIL unavailable-regress',JSON.stringify(u));process.exit(1)} console.log('OK fail-closed + no-regress');"

# 4. 永久回归全绿（packages/brain 自身 config，含既有 20 例 + 本 sprint 新增分流回归）— 死规则子 shell 执行
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ) || { echo "FAIL: brain diff-gate 回归未全绿"; exit 1; }
echo "OK brain regression green"

# 5. sprint spec 回归（sprints/** 根 include，防 include 范围外假绿）
npx vitest run --no-cache sprints/08210608-kernel-23e93b86/tests/diff-gate-reason-passthrough.test.js || { echo "FAIL: sprint spec 回归未全绿"; exit 1; }
echo "✅ Golden Path 全部出口验证通过"
```

**通过标准**：脚本 exit 0（node 直调三段 + brain 回归 + sprint spec 全绿）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（it() 名子串）| 预期红证据 |
|---|---|---|---|
| unknown 确定性终局出口 | `sprints/.../tests/diff-gate-reason-passthrough.test.js` + `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | `unknown 状态透传 reason_code 且 retryable false` | baseline 恒返 `mapper_stale`/`true` → 断言 `reason==='capability_not_in_active_projection' && retryable===false` FAIL |
| unknown 无 reason_code 回退 | 同上 | `unknown 状态无 reason_code 回退 mapper_unknown` | baseline `mapper_stale`/`true` → 断言 `mapper_unknown`/`false` FAIL |
| stale 透传 reason_code | 同上 | `stale 状态透传 reason_code 且 retryable true` | baseline `reason==='mapper_stale'` → 断言透传 `projection_snapshot_expired` FAIL |
| freshness 缺失 fail-closed | 同上 | `freshness 缺失 fail-closed 且 retryable false` | baseline `retryable:true` → 断言 `retryable===false` FAIL |
| 既有出口不回退 | 同上 | `既有 fail-closed mapper_unavailable 与 revision_mismatch 不回退` | 回归守卫（baseline 已绿，防改动回退）|

> Red 实证（baseline）：`npx vitest run sprints/08210608-kernel-23e93b86/tests/diff-gate-reason-passthrough.test.js` → 6 tests, 4 failed（unknown 透传 / unknown 回退 / stale 透传 / freshness 缺失），2 passed（stale 无 code 回退 + 既有出口守卫，baseline 恰好符合）。

---

## 未覆盖真实链路清单

- **structure-gate.js:123 同构折叠（已识别 · 本 sprint deferred）**｜为什么：PRD 预期受影响文件仅授权 diff-gate.js，范围限定「在范围内」= diff-gate.js step 3a，B50 精简纪律禁 scope 蔓延；issue_ref 空转是 diff-gate 编码后 `deny:impact` 路径，structure-gate 是编码前闸不同调用点｜真验证补位计划：由后续 sprint 单独立项修复（同构 3 行改），或本轮 Reviewer 若判定必须同修则在反馈中显式扩 scope。sweep 审计已完成并登记（见 `## 状态枚举 sweep 结果`）。
- **mapClient DI（合规豁免，非未覆盖）**：注入 mapClient 提供 freshness fixture 属模块边界测试 fixture，PRD 明确 Mapper 产出逻辑不在范围内，freshness 契约已由 map-client.js/radius.test.js 校验；分流逻辑本身真实执行未被 mock。
