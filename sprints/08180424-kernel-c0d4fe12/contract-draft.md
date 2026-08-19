# Sprint Contract Draft (Round 1)

**锚定父路声明**：独立小路（无父路）——本 sprint 是 impact-contract gate 对 `freshness.status !== 'fresh'` 分支的纯裁决逻辑修复，不推进任何已注册 Golden Path。

gp-anchor: skipped (product-map.json not found)
contract-gate: skipped (file not found, third-party repo — 若 packages/brain/src/lib/contract-gate.js 存在则由 cecelia 原逻辑执行)
map-scope: [MAP_NOT_CONFIGURED]（task.payload 无 map_scope/map_repo，不注入 must_run_assertions，不回退领域硬编码）

## Response Schema（推导来源: PRD 字面 — 无 HTTP 响应，内部 gate 结果对象）

N/A — 任务无 HTTP 响应。本 sprint 修复的是进程内 gate 函数的**结果对象**语义，不新增/不改动任何 HTTP 端点。为供验收对齐，固化受影响的结果对象字段（字段名来自现有 `diff-gate.js` / `structure-gate.js` 返回体，禁止漂移改名）：

### `evaluateDiffGate(...)` 返回对象（`freshness.status !== 'fresh'` 分支）
```json
{"gate": "impact_unknown", "reason": "<Map freshness.reason_code 字面>", "reason_code": "<同 reason>", "retryable": <boolean>}
```
- `gate` (string, 必填): 该分支恒为 `"impact_unknown"`（不变，PRD 范围内只改 reason/retryable）。来源——PRD 步骤3。
- `reason` (string, 必填): **透传** `mapperResult.freshness.reason_code` 字面值；缺失时为 status 派生值（如 `mapper_unknown` / `mapper_freshness_missing`），**禁止回退成通用 `mapper_stale`**。来源——PRD 步骤2/3 + 边界情况。
- `reason_code` (string, 必填): 与 `reason` 同值（供 `harness-gates.js` 的 `result.reason ?? result.reason_code` 双读路径任一命中）。来源——PRD 范围限定。
- `retryable` (boolean, 必填): `freshness.status === 'stale'` → `true`；`freshness.status === 'unknown'`、其它非 fresh、或 `freshness` 缺失/null → `false`。来源——PRD 假设（`freshness.status` 为唯一分流依据）。

### `evaluateStructureGate(...)` 返回对象（`freshness.status !== 'fresh'` 分支）
```json
{"gate": "blocked", "reason": "<Map freshness.reason_code 字面>", "reason_code": "<同 reason>", "retryable": <boolean>, "httpStatus": <number>}
```
- `gate` (string, 必填): 该分支恒为 `"blocked"`（不变）。来源——PRD 步骤3（structure → blocked）。
- `reason` / `reason_code` / `retryable`：语义同上（stale→retryable:true；unknown/其它非fresh/null→retryable:false；reason 透传具体 code，禁 `mapper_stale` 兜底）。
- `httpStatus` (number, 必填): 现有 `buildBlockedResult` 语义——瞬态可重试沿用 `503`；确定性 fail-closed 用非 503/409 码（建议 `422`，使 `retryable` 自然为 false）。**验收以 `retryable`/`reason` 为准，不强绑具体 http 码**（避免超覆盖）。

**禁用字段名**（不得作为透传结果 reason 出现在确定性/瞬态分支）: `mapper_stale`（仅允许作为 Mapper 抛异常/连接性问题的既有 `mapper_unavailable` 语义之外的**已废弃兜底**，本 sprint 后确定性/瞬态分支不得再产出 `mapper_stale`）。

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `structure-gate.test.js` → `test('Mapper unavailable 响应包含 retryable=true')`（`makeUnavailableMapClient` 抛异常路径 `mapper_unavailable` retryable=true）**必须保持不变**——本 sprint 不动 Mapper 抛异常分支。
- [回归] `structure-gate.test.js` → `describe('fail-closed 原则兜底') test('任何不可判定情形下 gate 结果绝不为 pass')`（遍历 unavailable/stale/revision_mismatch，`gate !== 'pass'`）**必须仍绿**（stale/unknown 仍 blocked，只是 reason/retryable 变）。
- [回归·需更新] `structure-gate.test.js` → `test('Mapper stale 响应包含 reason=mapper_stale')`（当前断言 `result.reason === 'mapper_stale'`，`makeStaleFreshnessMapClient` 返回 `freshness:{status:'stale',reason_code:'ttl_exceeded'}`）——本存量断言编码的是**旧 bug 行为**，修复后 `reason` 透传为 `'ttl_exceeded'`。**Generator 必须把该断言更新为 `expect(result.reason).toBe('ttl_exceeded')` 并保留 `retryable===true`**（不得删除该测试；它是回归锚点，改为断言新正确行为）。
- [回归] `harness-gates.test.js` → `it('merge 前重新查询 Mapper freshness，stale 时即使旧 Diff receipt 存在也阻断')`（直接 stub `diffGate` 返回 `mapper_stale`，验 merge 透传 `reason`）**不受本改动影响**（它 stub 整个 gate），保持绿；已证明 `harness-gates.js` 的 `reason ?? reason_code` 透传路径本就贯通。
- [累积 FR] 本 line 暂无历史（PRD 累积 FR 段为空）。
- [context-manifest] unavailable（runtime_resources.postgres=false，Brain API 未起，无法拉 `/api/brain/line/.../context-manifest`；本 sprint 为纯 gate 逻辑，无跨 sprint 累积 FR 依赖）。

## Golden Path

[Impact Gate 被调用] → [读取 Map freshness] → [按 freshness.status 分流裁决] → [receipt 携真实 reason_code 出口]

### Step 1: Diff/Structure Impact Gate 被调用，注入的 Map 客户端返回 `freshness.status !== 'fresh'`
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步。

**可观测行为**: gate 进入非 fresh 分支，读取 `mapperResult.freshness.status` 与 `mapperResult.freshness.reason_code`。

**验证命令**:
```bash
node --input-type=module -e 'import{evaluateDiffGate}from"./packages/brain/src/impact-contract/diff-gate.js";const r=await evaluateDiffGate({taskId:"t",mapClient:async()=>({freshness:{status:"unknown",reason_code:"impact_anchor_missing"}})});process.exit(r.gate==="impact_unknown"?0:1)'
# 期望：exit 0（进入非 fresh 分支，gate=impact_unknown）
```
**硬阈值**: `gate === 'impact_unknown'`（diff）。

---

### Step 2: 瞬态结论（`status==='stale'`）→ `retryable:true` 且透传具体 `reason_code`
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步。

**可观测行为**: gate 返回 `retryable:true`，`reason`/`reason_code` = Map 给出的具体 `reason_code` 字面（非 `mapper_stale`）。

**验证命令**:
```bash
node --input-type=module -e 'import{evaluateDiffGate}from"./packages/brain/src/impact-contract/diff-gate.js";const r=await evaluateDiffGate({taskId:"t",mapClient:async()=>({freshness:{status:"stale",reason_code:"fact_snapshot_stale"}})});if(r.retryable!==true||r.reason!=="fact_snapshot_stale"||r.reason==="mapper_stale"){console.error("FAIL",JSON.stringify(r));process.exit(1)}console.log("OK")'
# 期望：exit 0，reason=fact_snapshot_stale retryable=true
```
**硬阈值**: `retryable === true` 且 `reason === 'fact_snapshot_stale'` 且 `reason !== 'mapper_stale'`。

---

### Step 3: 确定性结论（`status==='unknown'`）→ fail-closed `retryable:false` 且透传具体 `reason_code`
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步 + Invariant「fail-closed」。

**可观测行为**: diff → `gate:'impact_unknown'`；structure → `gate:'blocked'`；两者 `retryable:false`，`reason`/`reason_code` 透传具体码（如 `capability_not_in_active_projection`），不再是 `mapper_stale`。

**验证命令**:
```bash
node --input-type=module -e 'import{evaluateStructureGate}from"./packages/brain/src/impact-contract/structure-gate.js";const r=await evaluateStructureGate({db:null,task:{id:"t",change_kind:"code_change"},contract:{task_id:"t",change_kind:"code_change",repo:"cecelia",base_revision:"a".repeat(40),affected_capabilities:[],required_assertions:[],contract_body:{affected_capabilities:[],required_assertions:[]}},mapClient:async()=>({freshness:{status:"unknown",reason_code:"capability_not_in_active_projection"}})});if(r.gate!=="blocked"||r.retryable!==false||r.reason!=="capability_not_in_active_projection"){console.error("FAIL",JSON.stringify(r));process.exit(1)}console.log("OK")'
# 期望：exit 0，gate=blocked retryable=false reason=capability_not_in_active_projection
```
**硬阈值**: `gate === 'blocked'`（structure）且 `retryable === false` 且 `reason === 'capability_not_in_active_projection'`。

---

### Step 4: 可观测出口 — `harness-gates.js` receipt 携带真实 `reason_code`，确定性 `retryable:false` 传播（不再 `deny:impact:mapper_stale` 空转）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步 + NFR 可观测。

**可观测行为**: 经真实 `evaluateDiffGate` 抵达的 `beforeEvaluate` receipt，`reason` 为具体码、`retryable:false`。

**验证命令**:
```bash
npx vitest run sprints/08180424-kernel-c0d4fe12/tests/impact-gate-reason-code.test.js -t "出口贯通" --reporter=basic 2>&1 | grep -qE "1 passed|Tests +1 passed" || { echo FAIL; exit 1; }
# 期望：出口贯通 describe 全绿（receipt.reason 具体化 + retryable=false）
```
**硬阈值**: 出口贯通测试通过（exit 0）。

---

### 边界: `freshness` 缺失/null → fail-closed 非重试（不静默判绿）
**来源**: `[FROM_PRD]` — PRD「边界情况」。

**验证命令**:
```bash
node --input-type=module -e 'import{evaluateDiffGate}from"./packages/brain/src/impact-contract/diff-gate.js";const r=await evaluateDiffGate({taskId:"t",mapClient:async()=>({freshness:null})});if(r.retryable!==false||r.reason==="mapper_stale"){console.error("FAIL",JSON.stringify(r));process.exit(1)}console.log("OK")'
# 期望：exit 0，retryable=false 且 reason!=mapper_stale
```
**硬阈值**: `retryable === false` 且 `reason !== 'mapper_stale'`。

---

## 禁 mock 边清单

本单改动落在 **gate 状态机/裁决分流逻辑**（`freshness.status` → `retryable`/`reason` 分流），属「状态机 + 跨模块数据传递（gate → harness-gates receipt）」类，必须真跑被改的边：

- `diff-gate.js` 内 `freshness` 分支裁决逻辑 ↔ 返回结果对象（本单改此裁决，测试必须真跑 `evaluateDiffGate`，不 stub 该函数）。
- `structure-gate.js` 内 `freshness` 分支裁决逻辑 ↔ `buildBlockedResult` 返回对象（本单改此裁决，测试必须真跑 `evaluateStructureGate`）。
- `diff-gate.js` 结果对象 ↔ `harness-gates.js` receipt（出口贯通测试必须真跑 `evaluateDiffGate` 抵达 `createHarnessImpactGates().beforeEvaluate` receipt，**不 stub diffGate**——用真实 `evaluateDiffGate` 包一层注入 `mapClient`）。

**允许注入的外层边界**（非被改的边）：`mapClient`（freshness 来源，PRD 明确不改 `map/radius.js`，是既有测试标准注入点）、`getActiveContract` / `readChangedFiles`（harness-gates 出口测试的 DB/git 外层依赖，runtime_resources.postgres=false 无真库）。本 sprint 无 DB 写路径变更（非 fresh 分支在任何 DB 写之前 return），故 fail-closed 分支不触真 Postgres，注入这两个外层边界不违反「禁 mock 被改的边」。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 系统对外承诺做什么 | gate 对 `freshness.status !== 'fresh'` 透传 Map 真实 `reason_code`，按 `status` 分流 `retryable`（stale→true，unknown/其它非fresh/null→false） |
| **NFR（做得多好）** | 性能/可靠性阈值 | 进程内纯逻辑，无外部延迟约束（PRD NFR 待定）；可靠性：确定性失败必在 receipt 可识别，不被 `mapper_stale` 掩盖 |
| **Invariant（永不违反）** | 不变量 | [fail-closed] 任何不可判定情形返回 blocked/impact_unknown，绝不假绿；[不掩盖真因] 确定性结论禁折叠成通用 `mapper_stale`，必透传原始 `reason_code` |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | N/A — 纯逻辑修复，无 token/数据保质期 |
| **死亡告警（停了谁知道）** | 停止工作谁知道 | harness `deny:impact:*` 空转率 / receipt `reason` 分布可在 run 决策日志观测；确定性失败以真码暴露即为「知道」 |
| **失败语义（挂了怎么办）** | 放行还是拦截 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | receipt.reason=具体码 且 receipt.retryable=false 即为生效（出口贯通 BEHAVIOR 断言） |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳定 | 静默丢消息 |
| ⚠️ 瞬态 vs 确定性失败的分流线 | A. `freshness.status`（stale=瞬态/unknown=确定性）; B. reason_code 白名单枚举 | A. `freshness.status` | `radius.js` 现有语义直接映射；白名单会随新码漂移（PRD 边界明确 status 为唯一依据） | 误判确定性为瞬态 → 无限重试空转（本 bug 根因）；误判瞬态为确定性 → 本可重试的扫描被 fail-closed 拦死 |

> ⚠️ 行说明：该分流线误判后果严重（无限重试空转 / 误拦可恢复态），但 PRD 假设段已机检拍定「`freshness.status` 为唯一分流依据」，非模型自创，无需升拍板；notes 记 `judgment-locked-by-prd: freshness.status 分流线`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| freshness.status='stale' | 返回 retryable:true + 具体 reason_code | 是（同 base_sha 重扫可恢复） | 上游按 retryable 重派一次新扫描 |
| freshness.status='unknown' | fail-closed：diff→impact_unknown / structure→blocked，retryable:false + 具体 reason_code | 否（同 base_sha 重试永不变好） | 停止重试，如实暴露真因（合同锚点/能力结构性缺失） |
| freshness 缺失/null | fail-closed 非重试，reason 非 mapper_stale | 否 | 不静默判绿，暴露不可判定 |
| Mapper 抛异常（连接性） | 维持现状 `mapper_unavailable` + retryable:true | 是 | 不在本 sprint 语义内，不改 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 为进程内 gate 逻辑，无对外暴露 agent / 无外部可写入接口 / 无 prompt 注入面。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> runtime_resources.postgres=false，Brain server 未起：本 sprint 修复的非 fresh 分支在任何 DB 写之前 return，验收为**进程内 gate 单元/集成真跑**（真跑被改的裁决逻辑，仅注入 freshness 来源 mapClient）。vitest 死规则（v9.25）：`packages/brain/src/**` 的 vitest 必须子 shell `(cd packages/brain && npx vitest run ...)`；`sprints/**` 合同测试才从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
SPRINT_DIR="sprints/08180424-kernel-c0d4fe12"

# 1. 复现 + 回归合同测试（sprints/** → 仓库根跑，root vitest.config include 覆盖）
npx vitest run "${SPRINT_DIR}/tests/impact-gate-reason-code.test.js" --reporter=basic

# 2. 被改文件的存量 brain 单元测试（含更新后的 reason=mapper_stale→具体码 回归断言）
#    packages/brain/src/** → 必须子 shell 用 brain 自己的 vitest 配置
( cd packages/brain && npx vitest run --no-cache \
    ./src/impact-contract/__tests__/diff-gate.test.js \
    ./src/impact-contract/__tests__/structure-gate.test.js \
    ./src/impact-contract/__tests__/harness-gates.test.js )

# 3. Golden Path 关键出口断言（确定性 fail-closed 透传真码 — 真跑被改的边）
node --input-type=module -e 'import{evaluateStructureGate}from"./packages/brain/src/impact-contract/structure-gate.js";const r=await evaluateStructureGate({db:null,task:{id:"t",change_kind:"code_change"},contract:{task_id:"t",change_kind:"code_change",repo:"cecelia",base_revision:"a".repeat(40),affected_capabilities:[],required_assertions:[],contract_body:{affected_capabilities:[],required_assertions:[]}},mapClient:async()=>({freshness:{status:"unknown",reason_code:"impact_anchor_missing"}})});if(r.gate!=="blocked"||r.retryable!==false||r.reason!=="impact_anchor_missing"){console.error("E2E FAIL structure",JSON.stringify(r));process.exit(1)}'

echo "✅ Impact Gate reason_code 透传 + status 分流 E2E 验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `freshness` 为 `{}`（空对象无 status）/ `{status:'garbage'}`（未知 status 枚举）——须走 fail-closed 非重试，不得 crash、不得判绿、不得回退 `mapper_stale`。
- 重复提交: 同一 unknown freshness 连续两次调用 gate → 两次都 `retryable:false` 且 reason 稳定（不因缓存/状态残留漂移）。
- 中途中断: N/A（进程内同步裁决，无异步中断面）。
- 边界值: `freshness.reason_code` 为空串 `""` / 为 `null` 显式值 → 透传 status 派生值，禁 `mapper_stale`；`status:'fresh'` 但带 `reason_code` → 不应进入非 fresh 分支（不受影响）。
发现分级: P0/P1（确定性失败被判 retryable=true 空转 / 任何情形判绿）→ 阻塞 merge；P2/P3（reason 派生值命名不理想但语义正确）→ 记 findings 不阻塞。
