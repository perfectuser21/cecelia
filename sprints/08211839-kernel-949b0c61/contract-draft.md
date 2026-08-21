# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传 reason_code + fail-closed 出口

## 锚定父路声明

独立小路（无父路）—— 本 sprint 是 harness kernel 内部 impact-contract gate 逻辑修复，无用户可观察父级 Golden Path。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改的是 `packages/brain/src/impact-contract/` 两个 gate 函数的**返回对象**（进程内库函数，非 HTTP 端点），无新增/变更 REST 路由。验收 oracle 为 node 进程内直调真实 gate 函数 + vitest 断言返回对象字段。

被改的返回对象契约（gate verdict 出口字段，消费方 = `orchestrator/loop.js`）：

- `evaluateDiffGate(...)` 在 `freshness.status !== 'fresh'` 分支：
  - `gate: 'impact_unknown'`（不变）
  - `reason: <freshness.reason_code>`（**透传**，旧值硬编码 `'mapper_stale'`）
  - `reason_code: <freshness.reason_code>`（**新增透传**）
  - `retryable: false`（确定性 reason_code）/ `true`（瞬态 reason_code 或 reason_code 缺失回退）
- `evaluateStructureGate(...)` 在 `freshness.status !== 'fresh'` 分支（`buildBlockedResult` 折叠点）：
  - `gate: 'blocked'`（不变）
  - `reason: <freshness.reason_code>`（透传，旧值 `'mapper_stale'`）
  - `reason_code: <freshness.reason_code>`（新增透传）
  - `retryable: false` + `httpStatus: 422`（确定性）/ `retryable: true` + `httpStatus: 503`（瞬态或回退）

**禁用字段名**（不得引入消费方无法识别的新字段，PRD 假设②）：`stale_class` / `fail_closed` / `terminal` / `deterministic` 等新增语义字段——只沿用现有 `reason` / `reason_code` / `retryable` 出口。

## 已知约束（来自回归测试 + 累积 FR）

- [diff-gate.test.js] `没有 active contract 时 fail-closed，且不调用 Mapper` → `reason:'contract_missing', retryable:false`（不得回退）。
- [diff-gate.test.js] Mapper 抛错 → `reason:'mapper_unavailable', retryable:true`（本 sprint 不改）。
- [diff-gate.test.js] `revision_mismatch` / `manifest_digest_mismatch` / `projection_digest_mismatch` 等 3b 分支保持 `retryable:true`（不在本 sprint 折叠点范围）。
- [structure-gate.test.js] **需更新的既有断言（在范围内，预期受影响文件已列）**：`Mapper stale 响应包含 reason=mapper_stale` 用 fixture `reason_code:'ttl_exceeded'`。透传后 `reason` 变为 `'ttl_exceeded'`（非白名单 → 瞬态 → `retryable:true` 不变）。generator 必须把该断言改为 `expect(result.reason).toBe('ttl_exceeded')`（或补一条 `reason_code:null → mapper_stale` 用例覆盖回退语义），否则既有套件红。`retryable=true` 断言不受影响。
- [累积FR] context-manifest: 本 journey 无 done/working ability，无累积 FR（PRD 已注明）。
- [MAP_NOT_CONFIGURED] task.payload 无 map_scope/map_repo，Unified Map 半径未配置，不引入 must_run_assertions。
- 铁律映射：见下方八要素 Invariant 行（Mapper 任何不可判定情形 fail-closed，绝不假绿）。

## Golden Path

[Gate 触发（loop.js beforeGenerate/beforeEvaluate/beforeMerge）] → [Mapper 复算给出确定性 freshness.reason_code] → [Gate 透传 reason_code 并按白名单判 retryable] → [fail-closed 终止，重试计数不再无限增长，空转消失]

### Step 1: loop.js 调 Diff Impact Gate，Mapper 返回确定性 reason_code
**来源**: `[FROM_PRD]` — Golden Path 第 1 步（PRD「具体：1. [触发条件]」）。

**可观测行为**: `evaluateDiffGate` 拿到 `mapperResult.freshness = { status:'unknown', reason_code:'impact_anchor_missing' }`，进入 step 3a 折叠点。

**验证命令**:
```bash
node --input-type=module -e "import{evaluateDiffGate}from\"./packages/brain/src/impact-contract/diff-gate.js\";const r=await evaluateDiffGate({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"},affected_nodes:[],required_assertions:[]})});if(r.gate!==\"impact_unknown\")process.exit(1);console.log(\"OK\")"
# 期望：gate=impact_unknown，进入折叠点
```
**硬阈值**: `gate == 'impact_unknown'`，退出码 0。

---

### Step 2: Gate 透传 reason_code + 按确定性白名单决定 retryable
**来源**: `[FROM_PRD]` — Golden Path 第 2 步（PRD「2. [系统处理]」）。

**可观测行为**: 确定性结论 → `reason/reason_code == 'impact_anchor_missing'`（非 `'mapper_stale'`）且 `retryable == false`；瞬态结论 `fact_snapshot_stale` → 透传且 `retryable == true`。

**验证命令**:
```bash
# 确定性 → fail-closed
node --input-type=module -e "import{evaluateDiffGate as g}from\"./packages/brain/src/impact-contract/diff-gate.js\";const r=await g({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"},affected_nodes:[],required_assertions:[]})});if(r.reason!==\"impact_anchor_missing\"||r.reason_code!==\"impact_anchor_missing\"||r.retryable!==false)process.exit(1);console.log(\"OK\")"
# 瞬态 → 仍可重试
node --input-type=module -e "import{evaluateDiffGate as g}from\"./packages/brain/src/impact-contract/diff-gate.js\";const r=await g({db:null,taskId:\"t\",mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"fact_snapshot_stale\"},affected_nodes:[],required_assertions:[]})});if(r.reason!==\"fact_snapshot_stale\"||r.retryable!==true)process.exit(1);console.log(\"OK\")"
```
**硬阈值**: 确定性 `retryable===false` 且 `reason===reason_code===<真实 code>`；瞬态 `retryable===true`。

---

### Step 3: loop.js 写 deny:impact:<真实 reason_code>，空转消失（幂等稳定）
**来源**: `[FROM_PRD]` — Golden Path 第 3 步（PRD「3. [可观测结果]」）+ NFR 幂等不震荡。

**可观测行为**: 同一确定性结论重复进 Gate，`reason_code` 与 `retryable` 稳定（不在 retryable 与否间震荡）；`retryable:false` 使 loop.js 不再无限重试。structure-gate 同款折叠点一并修复（否则换路径仍空转）。

**验证命令**:
```bash
# 幂等：两次调用结果一致且 retryable=false
node --input-type=module -e "import{evaluateDiffGate as g}from\"./packages/brain/src/impact-contract/diff-gate.js\";const c=async()=>({freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"},affected_nodes:[],required_assertions:[]});const a=await g({db:null,taskId:\"t\",mapClient:c});const b=await g({db:null,taskId:\"t\",mapClient:c});if(a.reason_code!==b.reason_code||a.retryable!==b.retryable||b.retryable!==false)process.exit(1);console.log(\"OK\")"
# structure-gate 同款：确定性 → retryable:false
node --input-type=module -e "import{evaluateStructureGate as g}from\"./packages/brain/src/impact-contract/structure-gate.js\";const r=await g({db:null,task:{id:\"t\",change_kind:\"bugfix\"},contract:{task_id:\"t\",change_kind:\"bugfix\",repo:\"cecelia\",base_revision:\"abc\",affected_capabilities:[{capability_id:\"c1\"}],required_assertions:[],contract_body:{affected_capabilities:[{capability_id:\"c1\"}],required_assertions:[]}},mapClient:async()=>({fact_revisions:{cecelia:\"abc\"},freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"},affected_nodes:[],required_assertions:[]})});if(r.reason!==\"impact_anchor_missing\"||r.retryable!==false)process.exit(1);console.log(\"OK\")"
```
**硬阈值**: 两次调用 `reason_code`/`retryable` 相等且 `retryable===false`；structure-gate 确定性 `retryable===false`。

---

## 确定性 vs 瞬态 reason_code 白名单（本 sprint 锁定）

确定性 reason_code 白名单（→ `retryable:false` fail-closed），对齐 `map/radius.js` 产出的确定性 freshness reason_code + PRD 假设①：

| reason_code | radius.js 产出行 | 分类 |
|---|---|---|
| `impact_anchor_missing` | radius.js:386 | 确定性 |
| `capability_not_in_active_projection` | radius.js:384 | 确定性 |
| `unsafe_assertion_ref` | radius.js:388 | 确定性 |
| `assertion_identity_ambiguous` | radius.js:390 | 确定性 |
| `capability_assertion_coverage_missing` | radius.js:396 | 确定性 |
| `fact_snapshot_stale` | radius.js:82 | 瞬态（retryable） |
| `projection_revision_missing` | radius.js:85 | 瞬态 |
| `projection_revision_mismatch` | radius.js:88 | 瞬态 |
| `manifest_projection_mismatch` | radius.js:267 | 瞬态 |
| `graph_projection_revision_mismatch` | radius.js:307 | 瞬态 |
| （白名单外未知 code，如测试 fixture `ttl_exceeded`） | — | 默认瞬态 retryable（只对**已知确定性**才 fail-closed，避免误终止可自愈情形） |

**共享位置（防 diff-gate/structure-gate 漂移）**：generator 新建 `packages/brain/src/impact-contract/freshness-codes.js`，导出常量 `DETERMINISTIC_FRESHNESS_REASON_CODES`（上表确定性 5 项的 Set）与 helper `isDeterministicFreshnessReason(code)`；diff-gate.js 与 structure-gate.js 均 `import` 之，禁止各自复制字面量。

## 禁 mock 边清单

本单改动涉及**状态机**（retryable 可重试 ↔ fail-closed 终止的裁决迁移）与**跨模块数据传递**（Mapper.freshness.reason_code → Gate 出口 reason/reason_code）。被改的边必须真调，测试只许 mock 更外层的 Mapper 边界：

- Gate 决策逻辑 ↔ `mapperResult.freshness` 解释（本单改的就是这条边的映射）→ 测试**必须真调**真实 `evaluateDiffGate` / `evaluateStructureGate`，禁止 `vi.mock` 掉 gate 模块或 stub 其内部 reason_code→retryable 判定。
- `freshness-codes.js` 白名单 ↔ gate 消费 → 测试断言的是真实白名单成员判定，不得 mock helper 返回值。
- 允许 mock 的外层无关依赖：`mapClient`（Mapper/radius.js HTTP 边界，本 sprint 明确**不在范围**，是提供 freshness 输入的注入 seam，既有 gate 测试同款做法）；`db`（本折叠点分支不触达 DB 写路径，测试传 `db:null`，无 DB 边被 mock）。

> 说明：改动路径（`freshness.status !== 'fresh'` 早返回）不写 DB、不发第三方请求，故无真 Postgres / 第三方真调需求；runtime_resources.postgres=false 与此一致。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | Diff/Structure Gate 在 `freshness.status!=='fresh'` 时透传 Mapper 真实 `reason_code`，按确定性白名单决定 `retryable`（确定性→false，瞬态/回退→true），不再硬编码折叠 `mapper_stale`。 |
| **NFR（做得多好）** | 非功能 | 幂等/确定性：同一 Mapper 结论多次进 Gate，reason_code 与 retryable 稳定不震荡。 |
| **Invariant（永不违反）** | 不变量 | INV-1：Mapper 任何不可判定情形 fail-closed，绝不假绿（绝不返回 pass/extend）；确定性结论必须终止（retryable:false）而非无限重试。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表。 |
| **保质期（何时过期）** | 失效 | 白名单随 `radius.js` 产出的 reason_code 集合演进；新增确定性 reason_code 时须同步入白名单（否则默认瞬态重试）。无 token/数据过期。 |
| **死亡告警（停了谁知道）** | 告警 | loop.js 写 `deny:impact:<reason_code>` 进 decision log；空转复发时 `deny:impact:mapper_stale` 计数回升即信号（可观测 NFR）。 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明。 |
| **效果确认（已发≠已生效）** | 回执 | Gate 返回对象即同步回执；node 直调断言 `reason_code`/`retryable` 字段确认生效，无异步。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| Mapper 某 freshness.reason_code 是「确定性 fail-closed」还是「瞬态可重试」 | A. 按 status（unknown=确定性/stale=瞬态）；B. 按 reason_code 白名单（锚点/覆盖/引用类=确定性，快照/投影追赶类=瞬态） | B. reason_code 白名单 | status 与语义不一一对应（`graph_projection_revision_mismatch` 是 unknown 但属瞬态；PRD 假设①按 reason_code 语义划分）；白名单对齐 radius.js 全部产出 + loop.js DETERMINISTIC 语义 | 确定性误判瞬态→无限重试空转（当前 bug）；瞬态误判确定性→误 fail-closed 掉可自愈任务。故未知 code 默认瞬态（保守偏可重试，不误终止） |

> 判定点已由 PRD 假设①拍定（Proposer 对齐 radius.js 与 loop.js 后锁定白名单），非新增待确认 ⚠️ 项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Mapper 抛错（不可达） | `reason:'mapper_unavailable', retryable:true`（既有，不改） | 是 | loop.js 重试 |
| Mapper 确定性 reason_code | 透传 + `retryable:false`，任务 blocked/fail-closed 终止 | 是（同结论稳定） | 不重试，走 blocked 出口 |
| Mapper 瞬态 reason_code | 透传 + `retryable:true` | 是 | loop.js 可重试（自愈追赶） |
| `reason_code` 缺失/null 且 status≠fresh | 保守回退 `mapper_stale` + `retryable:true`（不假绿、不误终止） | 是 | 可重试 |

### 输入对抗面

N/A — 内部 kernel gate 库函数，无对外暴露 agent / 用户可写入接口，输入来自可信 Mapper 复算结果。

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本任务无 HTTP 端点、无 DB 写路径（改动分支早返回）。E2E oracle = 从仓库根跑冻结回归套件（sprints/** 由根 vitest include 覆盖）+ 子 shell 内跑既有 impact-contract 门测试（packages/brain/src/** 用包自身 vitest 配置，遵 9.25 死规则）。全绿即 Golden Path 端到端通过。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 冻结回归套件（复现 f62c7e87/d1360a48 空转，修复后转绿）——sprints/** 从仓库根跑
npx vitest run sprints/08211839-kernel-949b0c61/tests/diff-impact-gate-reason-code.test.js --reporter=basic

# 2. 既有 impact-contract 门测试（含 generator 对 structure-gate.test.js 的更新）——子 shell 切进包根用包 vitest 配置
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/structure-gate.test.js )

echo "OK: Diff/Structure Impact Gate reason_code 透传 + fail-closed 全绿"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `evaluateDiffGate` 传 `freshness:{status:'unknown', reason_code:'某未登记新 code'}` → 应默认瞬态 `retryable:true` 且透传该 code（不得误 fail-closed，也不得回退 mapper_stale 丢 code）。
- 边界值: `freshness` 为 `undefined` / `freshness:{}`（无 status 无 reason_code）→ 应回退 `mapper_stale` + `retryable:true`（现有 `!mapperResult?.freshness` 分支不得回归）。
- 重复提交: 同一确定性结论连续 3 次进 diff-gate 与 structure-gate → reason_code/retryable 三次全等（幂等不震荡）。
- 中途中断: `reason_code` 为空字符串 `''` → 视同缺失走回退（不得把空串当有效确定性 code）。
发现分级: P0/P1（reason_code 丢失回归空转 / 瞬态误 fail-closed 掉可自愈任务）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Diff Gate 确定性透传+fail-closed | `sprints/08211839-kernel-949b0c61/tests/diff-impact-gate-reason-code.test.js` | 透传 reason_code 且 retryable:false、保持 retryable:true、回退 mapper_stale、判定稳定不震荡 | → 17 failed（当前折叠 mapper_stale/retryable:true）|
| Structure Gate 同款修复（补充行） | `packages/brain/src/impact-contract/__tests__/structure-gate.test.js` | reason=mapper_stale 断言更新为透传 | → 既有断言随透传更新 |
