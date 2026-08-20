# Sprint Contract Draft (Round 1)

覆盖父路：**独立小路（无父路）** —— Diff Impact Gate step 3a 确定性折叠修复，journey e6f803f2 golden-paths 仅 planned 态，无父路步骤可锚。

## Response Schema（推导来源: PRD 字面 + 既有 evaluateDiffGate 返回契约）

### Endpoint: N/A — 任务无 HTTP 响应

本 sprint 改动为 Brain 内部 `evaluateDiffGate()` 函数返回对象，无新增/修改 HTTP 端点。
但函数返回对象是下游 orchestrator 的确定性输入契约，等价于 schema，故 codify 如下（Reviewer 第 6 维按此审）：

**`evaluateDiffGate()` step 3a（Mapper 非-fresh）返回对象**：

确定性 reason_code 分支（新行为）：
```json
{"gate": "impact_unknown", "reason": "<reason_code>", "reason_code": "<reason_code>", "retryable": false}
```
- `gate` (string, 必填): 恒为 `"impact_unknown"`（fail-closed，绝不 pass/extend）— 来源 PRD Golden Path 3 + 既有契约
- `reason` (string, 必填): 确定性时为**真实 reason_code**（如 `projection_revision_mismatch`），**禁止**折叠成 `mapper_stale` — 来源 PRD Invariant [reason_code 透传]
- `reason_code` (string, 必填): 透传自 `mapperResult.freshness.reason_code` — 来源 PRD Golden Path 3
- `retryable` (boolean, 必填): 确定性 → `false`（有界终态）— 来源 PRD Invariant [有界终态]

非确定性/缺失 reason_code 分支（保持既有行为）：
```json
{"gate": "impact_unknown", "reason": "mapper_stale", "retryable": true}
```
- `reason` 恒为 `"mapper_stale"`，`retryable` 恒为 `true`（不误杀可恢复重试）— 来源 PRD 边界情况 + Golden Path 5

**禁用字段名**（不得改字段名漂移）: `mapper_stale` 不得作为确定性分支的 `reason`；`retryable:true` 不得出现在确定性分支。

**确定性 freshness reason_code 集合**（本 sprint 定义，来源 `packages/brain/src/map/radius.js` 结构性 mismatch 判定，语义对齐 orchestrator `DETERMINISTIC_IMPACT_ERROR_CODES`：Map 已作定态负判定、非瞬时抖动、重派同角色不会自愈）：
```
projection_revision_missing, projection_revision_mismatch, manifest_projection_mismatch,
graph_projection_revision_mismatch, capability_not_in_active_projection, impact_anchor_missing,
unsafe_assertion_ref, assertion_identity_ambiguous, capability_assertion_coverage_missing
```
**故意排除**（保持 `retryable:true`）：`fact_snapshot_stale`（事实快照滞后，可随事实刷新自愈）；任何缺失/集合外的 reason_code。

## Golden Path

[orchestrator 进入 Diff Impact Gate] → [Mapper 复算返回确定性非-fresh 结论] → [gate 带真实 reason_code fail-closed 终结 run，不空转]

### Step 1: orchestrator 在 beforeGenerate/beforeEvaluate/beforeMerge 调 `evaluateDiffGate`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（第 23 行）

**可观测行为**: `harness-gates.js` 的 `beforeGenerate/beforeEvaluate` 调用 `diffGate({db, taskId, repo, headRevision, changedFiles})`，返回值经 `gateReceipt` 包装进 `impact_gate` receipt。

**验证命令**:
```bash
# 既有 wiring 不变，回归测试确认 beforeMerge/beforeGenerate 仍消费 diffGate 返回
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/harness-gates.test.js)
# 期望：全绿
```
**硬阈值**: harness-gates.test.js 全 PASS（wiring 零回退）

---

### Step 2: Mapper 返回 `freshness.status !== 'fresh'` 且携带确定性 `freshness.reason_code`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（第 24 行）

**可观测行为**: `evaluateDiffGate` step 3a 命中（`mapperResult.freshness.status !== 'fresh'`），`freshness.reason_code` ∈ 确定性集合。

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8'); if(!c.includes('projection_revision_mismatch')||!c.includes('impact_anchor_missing')) process.exit(1); console.log('OK: 确定性集合已内置')"
# 期望：OK
```
**硬阈值**: diff-gate.js 内含确定性 reason_code 集合常量

---

### Step 3: Diff Impact Gate 透传 reason_code + 确定性 fail-closed（`retryable:false`）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（第 25-26 行）

**可观测行为**: 确定性 reason_code → 返回 `{gate:'impact_unknown', reason:<code>, reason_code:<code>, retryable:false}`；不再一律 `mapper_stale/retryable:true`。

**验证命令**:
```bash
node_modules/.bin/vitest run sprints/08210531-kernel-4582c6dd/tests/diff-gate-reason-code.test.js
# 期望：全绿（确定性 → retryable:false 透传；非确定性/缺失 → retryable:true 保持）
```
**硬阈值**: sprint 测试 12 例全 PASS

---

### Step 4: orchestrator 收 `retryable:false` → `impact_contract_invalid` 终态 BLOCKED，不再重派
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条（第 27-28 行）

**可观测行为**: `loop.js` 既有消费逻辑（第 1542 行 `impactGateReceipt?.retryable === false ? 'impact_contract_invalid'`）将 receipt 归为终态 BLOCKED，观测 `deny:impact:<真实reason_code>` 出现一次即终结。**本 sprint 不改 loop.js**——只需 diff-gate 侧产出 `retryable:false` 即触发既有终态路径。

**验证命令**:
```bash
# (逻辑断言) diff-gate 真实产出 retryable:false + reason===reason_code（orchestrator 终态所需两属性）
node --input-type=module -e "import('./packages/brain/src/impact-contract/diff-gate.js').then(async(m)=>{const r=await m.evaluateDiffGate({db:{query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'b',contract_body:{affected_capabilities:[],required_assertions:[]}}]})},taskId:'t',repo:'cecelia',headRevision:'h',mapClient:async()=>({freshness:{status:'stale',reason_code:'projection_revision_mismatch'}})});if(r.retryable!==false||r.reason!=='projection_revision_mismatch'){console.error('FAIL',r);process.exit(1)}console.log('OK: retryable=false reason='+r.reason)})"
# (接缝断言) orchestrator 接收侧未回退：loop.js 仍按 retryable===false 归 impact_contract_invalid
grep -q \"impactGateReceipt?.retryable === false\" packages/brain/src/orchestrator/loop.js && grep -q \"'impact_contract_invalid'\" packages/brain/src/orchestrator/loop.js
# 期望：OK + grep 命中（接收侧终态分类存在且未回退）
```
**硬阈值**: node 断言 exit 0 且 loop.js 消费点存在

---

### Step 5: 瞬时/真实 stale（reason_code 非确定性或缺失）仍 `retryable:true`，不误杀
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条（第 29 行）+ 边界情况（第 35 行）

**可观测行为**: `fact_snapshot_stale` 或缺失 reason_code → 保持 `{reason:'mapper_stale', retryable:true}`。

**验证命令**:
```bash
node --input-type=module -e "import('./packages/brain/src/impact-contract/diff-gate.js').then(async(m)=>{const r=await m.evaluateDiffGate({db:{query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'b',contract_body:{affected_capabilities:[],required_assertions:[]}}]})},taskId:'t',repo:'cecelia',headRevision:'h',mapClient:async()=>({freshness:{status:'stale',reason_code:'fact_snapshot_stale'}})});if(r.retryable!==true||r.reason!=='mapper_stale'){console.error('FAIL',r);process.exit(1)}console.log('OK: 瞬时 stale 保持 retryable=true')})"
# 期望：OK
```
**硬阈值**: 非确定性 stale 返回 retryable:true

---

## 禁 mock 边清单

本单改动涉及**跨模块数据传递**（diff-gate 的 `reason_code`/`retryable` 经 harness-gates receipt 流向 orchestrator loop 终态分类）。禁 mock 的边：

- `evaluateDiffGate` step 3a ↔ `mapperResult.freshness`（本单改了对 freshness.reason_code 的分类决策）→ 测试必须真实执行 `evaluateDiffGate`，**禁止 vi.mock('../diff-gate.js')** 或 stub `evaluateDiffGate` 本身；只喂入固定 `freshness` 结论。
- `evaluateDiffGate` 返回对象 ↔ orchestrator `loop.js` 终态分类（`retryable===false → impact_contract_invalid`）→ 接收侧属既有未改逻辑，本单以真实 `evaluateDiffGate` 输出 + loop.js 消费点存在性断言覆盖（真 orchestrator loop + 真 DB 终态见接缝清单）。

**允许 mock 的更外层边界**（PRD 明确不在范围内）：
- `mapClient`（Mapper HTTP `POST /api/brain/map/radius` 边界）—— 既有全部 diff-gate 测试的注入点，等价固定 HTTP 响应，PRD 第 48 行明确 Mapper 本身不在范围内。
- `db`（Postgres）—— 本 attempt `postgres:false`，stub 仅让 step 1 读到 active contract 后进入 step 3a；step 3a 在任何 DB 副作用之前返回，不触碰真实写路径。

## 接缝清单（接缝 vs 逻辑）

| # | 接缝点 | 碰真实世界处 | 真目标验证方式 | 本轮状态 |
|---|---|---|---|---|
| 1 | orchestrator loop 真跑 → `impact_contract_invalid` 终态 BLOCKED、无重派、无 deadline 兜底 | 真 Postgres + 真 orchestrator run 循环 | 需真 DB run 观测 `deny:impact:<code>` 出现一次即终结 | `logic-done-pending`（本 attempt `postgres:false`，无法起真 run；接收侧 loop.js:1542 为**既有未改**逻辑，已由现存 orchestrator loop 回归测试守护；本单以真实 evaluateDiffGate 输出 retryable:false + loop.js 消费点存在性断言覆盖逻辑侧）|

逻辑断言（环境无关，CI/单测验绿=真 done）：diff-gate step 3a 的分类决策、reason_code 透传、retryable 取值——全部 L2 覆盖。

## 未覆盖真实链路清单

- **mapClient（Mapper /map/radius）被注入固定 freshness 顶替**｜为什么：PRD 第 48 行明确 Mapper freshness 判定逻辑不在本次范围，本单只透传+分类既有字段｜真验证补位计划：Mapper freshness reason_code 的真实产出由 `map/radius.js` 既有回归测试守护，非本 sprint 职责。
- **真 orchestrator loop 终态 BLOCKED（接缝 #1）** 未在本 attempt 真 DB 环境跑通（postgres:false）｜真验证补位计划：见接缝清单 #1，接收侧为既有未改逻辑。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 确定性 freshness reason_code → 透传进 gate 结果并给 `retryable:false` fail-closed 出口；非确定性/缺失 → 保持 `mapper_stale/retryable:true` |
| **NFR（做得多好）** | 非功能 | 有界重试：确定性 Map 结论一轮终结，禁止无限重派/空转 |
| **Invariant（永不违反）** | 不变量 | ①fail-closed（不可判定→blocked 绝不假绿）②有界终态（确定性不得 retryable:true）③reason_code 透传（不折叠丢弃）见 Invariant 段 |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表 |
| **保质期（何时过期）** | 失效 | N/A —— 确定性集合随 map/radius.js reason_code 演进；新增结构性 code 需同步集合（合同 notes 记）|
| **死亡告警（停了谁知道）** | 告警 | 若本逻辑失效退回空转，orchestrator run 会重现 `deny:impact:mapper_stale` 无限重派 → deadline 兜底 fail（可观测退化信号）|
| **失败语义（挂了怎么办）** | 故障 | fail-closed：确定性→BLOCKED 终态（拦截）；瞬时/未知→retryable 重试（放行重试）。见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | impact_gate receipt 的 `reason` 字段必须为真实 reason_code（非泛化 mapper_stale）；由 B-01/B-04 断言 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ freshness 非-fresh 结论是"确定性终态"还是"瞬时可重试" | A. 按 reason_code 是否 ∈ 结构性 mismatch 集合分类; B. 一律当瞬时可重试（现状 bug）; C. 一律当终态 | A. reason_code 集合分类 | radius.js 已产出结构性 vs 快照滞后两类语义不同的 reason_code；B 是本 bug 根因（空转），C 会误杀 fact_snapshot_stale 可恢复重试 | 误判为瞬时→无限空转 deadline 兜底（本 bug）；误判为终态→误杀可恢复 run（Golden Path 5 防线）|

> ⚠️ 行：该判定点误判后果严重（空转/误杀），已由 PRD Golden Path 3+5 明确拍板分类边界（确定性集合 vs fact_snapshot_stale/缺失），非新增待确认判定；集合成员选择依据 radius.js 结构性语义，如需扩集合以 PRD 边界为准。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 确定性 reason_code 命中 | 返回 blocked + retryable:false，orchestrator 归 impact_contract_invalid 终态 | 是（纯函数，同输入同输出） | 无降级——终态即目标 |
| Mapper 非-fresh 但 reason_code 缺失/集合外 | 返回 mapper_stale + retryable:true | 是 | orchestrator 重试（既有语义，不动）|
| Mapper throw（连接/timeout） | 返回 mapper_unavailable + retryable:true（既有 step 2 catch，本单不动）| 是 | 重试 |

### 输入对抗面

N/A —— 本单为 Brain 内部 orchestrator gate 逻辑，无对外暴露 agent 输入面，freshness 结论来自内部 Mapper 服务。

## 已知约束（来自回归测试 + 累积 FR）

- [diff-gate.test.js] `Mapper.radius() 超时时 Diff Gate 返回 blocked（不放行）` → mapper_unavailable/retryable:true 分支不得回退（本单不动 step 2 catch）
- [diff-gate.test.js] `Mapper revision mismatch 时 Diff Gate 返回 blocked` → revision_mismatch/retryable:true（step 3b，本单不动）
- [harness-gates.test.js] `merge 前重新查询 Mapper freshness，stale 时即使旧 Diff receipt 存在也阻断` → 现断言 `{gate:'blocked', reason:'mapper_stale', retryable:true}`（该测试注入的是**无 reason_code** 的 stale，属边界"缺失"情形，行为不变，无需改）
- [累积FR] （本 line 暂无历史已验收行为，journey e6f803f2 仅 planned 态）
- context-manifest: 本 attempt 无 Brain 连接（postgres:false / 无 5221），累积 FR 以 PRD 第 77-80 行为准（暂无历史）

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `freshness` 为 `null` / `freshness` 无 `status` 字段 / `reason_code` 为空字符串 `""` / `reason_code` 为非字符串（number/object）→ 不得 crash，须归"缺失"分支 retryable:true
- 集合边界: reason_code 大小写变体（`Projection_Revision_Mismatch`）、前后空格 → 精确匹配集合，不误纳
- 重复提交: 同一 taskId 连续两次确定性 gate → 幂等，两次同返回 retryable:false
- 中途中断: db stub 返回 contract 但 mapperResult 缺 freshness → 走 step 3a "非 fresh" 分支（`!mapperResult?.freshness`）retryable:true
发现分级: P0/P1（确定性误判为可重试→空转 / 缺失误判为终态→误杀）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本单为 Brain 内部 gate 纯逻辑改动，无新增 HTTP 端点；本 attempt postgres:false。故 local_api E2E 以 node 单测 + node 内联断言为 oracle（真实执行被改的 evaluateDiffGate；Mapper/DB 为 PRD 范围外注入边界）。packages/brain 回归测试用子 shell 切包根跑（避开根 vitest include）。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. Sprint 合同测试（sprints/** 归根 vitest include，直接从根跑）
node_modules/.bin/vitest run sprints/08210531-kernel-4582c6dd/tests/diff-gate-reason-code.test.js

# 2. packages/brain 回归测试（必须子 shell 切包根，用包自己的 vitest 配置）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/harness-gates.test.js ./src/impact-contract/__tests__/structure-gate.test.js)

# 3. 逻辑断言：确定性 reason_code → retryable:false + reason 透传真实 code（orchestrator 终态两属性）
node --input-type=module -e "import('./packages/brain/src/impact-contract/diff-gate.js').then(async(m)=>{const r=await m.evaluateDiffGate({db:{query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'b',contract_body:{affected_capabilities:[],required_assertions:[]}}]})},taskId:'t',repo:'cecelia',headRevision:'h',mapClient:async()=>({freshness:{status:'stale',reason_code:'projection_revision_mismatch'}})});if(r.retryable!==false||r.reason!=='projection_revision_mismatch'||r.reason_code!=='projection_revision_mismatch'){console.error('FAIL',r);process.exit(1)}console.log('OK det retryable=false reason='+r.reason)})"

# 4. 逻辑断言：瞬时 stale → 保持 retryable:true（不误杀）
node --input-type=module -e "import('./packages/brain/src/impact-contract/diff-gate.js').then(async(m)=>{const r=await m.evaluateDiffGate({db:{query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'b',contract_body:{affected_capabilities:[],required_assertions:[]}}]})},taskId:'t',repo:'cecelia',headRevision:'h',mapClient:async()=>({freshness:{status:'stale',reason_code:'fact_snapshot_stale'}})});if(r.retryable!==true||r.reason!=='mapper_stale'){console.error('FAIL',r);process.exit(1)}console.log('OK transient retryable=true')})"

# 5. 接缝断言（接收侧未回退）：loop.js 仍按 retryable===false 归 impact_contract_invalid
grep -q "impactGateReceipt?.retryable === false" packages/brain/src/orchestrator/loop.js
grep -q "'impact_contract_invalid'" packages/brain/src/orchestrator/loop.js

echo "✅ Golden Path 验证通过（确定性 fail-closed 透传 + 瞬时保持可重试 + 接收侧终态未回退）"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 确定性 reason_code fail-closed 透传 | `tests/diff-gate-reason-code.test.js` | `确定性 reason_code`、`透传真实 reason_code`、`retryable:false`、`保持 mapper_stale/retryable:true` | → 10 failures（确定性/unknown 案例，现返回 mapper_stale/retryable:true）|
