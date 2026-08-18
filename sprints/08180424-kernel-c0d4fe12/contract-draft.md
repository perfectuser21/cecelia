# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传确定性 reason_code + fail-closed 出口（r19）

**锚定父路声明**: 独立小路（无父路） — journey golden-paths 本 line 均 planned 态，无 done 父路可锚（PRD「累积 FR」段实证）。本 sprint 是 harness 内部 Diff Impact Gate 判定逻辑修复。

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree，contract-gate.js 存在，按代码层 gate 规则起草（非第三方 repo 跳过路径）

---

## Response Schema（推导来源: 现有代码 diff-gate.js evaluateDiffGate 返回契约，字面复用现有字段名 = LAW）

本 sprint 无 HTTP 端点，被测对象是 `evaluateDiffGate()` 的**返回对象**（内部函数契约）。字段名是 ground truth，直接来自 `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a 现有 return 及其 JSDoc（第 129-146 行），**禁止重命名**。

### Function: `evaluateDiffGate({db, taskId, mapClient, headRevision, changedFiles, repo})` 步骤 3a 出口

**mapperResult.freshness.status !== 'fresh' 时的返回**:
```json
{"gate": "impact_unknown", "reason": "<string>", "reason_code": "<string|null>", "retryable": "<boolean>"}
```
- `gate` (string, 必填): 固定 `"impact_unknown"`（PRD 假设 2：不改成 blocked）。来源——现有 diff-gate.js 步骤 3a
- `reason` (string, 必填): 确定性码 → 透传 Mapper 的 `freshness.reason_code`；瞬态/缺失 → 回退 `"mapper_stale"`。来源——PRD Golden Path 步骤 2 + diff-gate.js 现有字段
- `reason_code` (string|null, 新增透传): 原样透传 `mapperResult.freshness.reason_code`（null/undefined 时为 null）。来源——PRD Golden Path 步骤 2「透传到 reason_code 字段」+ JSDoc 第 142 行已声明该字段
- `retryable` (boolean, 必填): 确定性码 → `false`（fail-closed 终态）；瞬态码 `fact_snapshot_stale` 或 reason_code 缺失 → `true`（向后兼容）。来源——PRD Golden Path 步骤 2

**禁用字段名**（不得在断言正向出现）: `retry`、`can_retry`、`code`、`freshness_reason`、`stale_reason`、`blocked`（gate 值不改成 blocked）、`mapper_stale`（不得作为确定性码的 reason 值）

**下游消费链（不在本 sprint 修改范围，仅记录以佐证可观测结果，PRD 假设 2）**:
- `harness-gates.js:30` `gateReceipt`: `reason: result.reason ?? result.reason_code ?? null` — 透传 reason 进 receipt
- `loop.js:1454`: `gateVerdict = deny:impact:${impactGateReceipt.reason}` — 确定性码 → `deny:impact:projection_revision_mismatch`（非 `mapper_stale`）
- `loop.js:1542`: `impactGateReceipt.retryable === false ? 'impact_contract_invalid' : 'infrastructure_blocked'` — retryable:false → failure_class=impact_contract_invalid → `loop.js:1663 failRun('impact_gate_deterministic:...')` 终态阻断，不再每 tick 空转

---

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「没有 active contract 时 fail-closed，且不调用 Mapper」（reason:contract_missing, retryable:false 不变）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「Mapper revision mismatch 时 Diff Gate 返回 blocked」（步骤 3b reason:revision_mismatch, retryable:true — 本 sprint 不改 3b）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「manifest_digest 不匹配时 impact_unknown」（retryable:true 不变 — 步骤 3b/digest 校验不改）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「fact_revisions 缺少目标 repo 时 revision_evidence_missing, retryable:true」（不改）
- [累积FR] context-manifest: unavailable（postgres=false，Brain 未起，端点不可达；本 sprint 无历史累积 FR 可回退，PRD「累积 FR」段实证 line 均 planned）
- [MAP_NOT_CONFIGURED] task.payload.map_scope/map_repo 未配置（postgres=false，无法查 /api/brain/map；不回退领域硬编码，确定性 reason_code 集合改由读 radius.js 源码核对锁定，见下）

---

## 确定性 reason_code 集合（读 radius.js 核对锁定 — PRD 假设 1 授权）

已逐码核对 `packages/brain/src/map/radius.js`（`baseFreshness` 第 80-91 行 + 步骤 261-396 行），radius 产出的 `freshness.reason_code` 全集与分类：

| reason_code | radius 产出位置 | status | 分类 | retryable |
|---|---|---|---|---|
| `fact_snapshot_stale` | 第 82 行（factHealth 非 fresh，事实正在重扫） | stale | **瞬态**（可自愈） | `true` |
| `projection_revision_missing` | 第 85 行 | stale | 确定性（结构） | `false` |
| `projection_revision_mismatch` | 第 88 行 | stale | 确定性（结构） | `false` |
| `manifest_projection_mismatch` | 第 267 行 | stale | 确定性（结构） | `false` |
| `graph_projection_revision_mismatch` | 第 307 行 | unknown | 确定性（结构） | `false` |
| `capability_not_in_active_projection` | 第 384 行 | unknown | 确定性（结构） | `false` |
| `impact_anchor_missing` | 第 386 行 | unknown | 确定性（结构） | `false` |
| `unsafe_assertion_ref` | 第 388 行 | unknown | 确定性（结构） | `false` |
| `assertion_identity_ambiguous` | 第 390 行 | unknown | 确定性（结构） | `false` |
| `capability_assertion_coverage_missing` | 第 396 行 | unknown | 确定性（结构） | `false` |

**锁定的确定性集合 `DETERMINISTIC_STALE_REASON_CODES`**（Generator 在 diff-gate.js 定义为模块级 `Set`）:
```
revision_mismatch,                       // PRD 假设 1 显式列 + diff-gate.js 步骤 3b 同名码（结构性，一并纳入）
projection_revision_missing,
projection_revision_mismatch,
manifest_projection_mismatch,
graph_projection_revision_mismatch,
capability_not_in_active_projection,
impact_anchor_missing,
unsafe_assertion_ref,
assertion_identity_ambiguous,
capability_assertion_coverage_missing
```

**PRD 假设 1 对账说明**: PRD 假设列 `revision_mismatch` 为示例首项；radius.js 步骤 3a 实际产出的是 `projection_revision_mismatch`（`revision_mismatch` 是 diff-gate 步骤 3b 自身的 reason，非 freshness 码）。二者均为结构性确定性码，**全部纳入集合**（取并集，不遗漏）。radius 额外产出的 `projection_revision_missing` 未在 PRD 逐字列出，但属结构性 stale（projection 缺 revision，重试不自愈），依 PRD 假设 1「最终清单由 Proposer 读 radius.js 核对后锁定」授权纳入。**唯一瞬态码 = `fact_snapshot_stale`**。

**分类判定规则**（Generator 实现）: `mapperResult.freshness.reason_code` 命中集合 → `{reason: reason_code, reason_code, retryable: false}`；未命中（含 `fact_snapshot_stale`、集合外任意码、null/undefined）→ `{reason: 'mapper_stale', reason_code: reason_code ?? null, retryable: true}`。

---

## Golden Path

[Gate 复算 impact radius] → [freshness.status !== 'fresh' 携带确定性 reason_code] → [透传 reason_code + 确定性分类 retryable:false] → [orchestrator gateVerdict=deny:impact:<确定性码>，终态阻断停止空转]

### Step 1: Diff Impact Gate 复算返回非 fresh + 确定性 reason_code
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 1「Map 复算影响半径返回 freshness.status !== 'fresh' 且携带确定性 reason_code」

**可观测行为**: `evaluateDiffGate` 步骤 3a 收到 `mapperResult.freshness = {status:'stale'|'unknown', reason_code:'projection_revision_mismatch'}`，进入 stale 分支。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t 'projection_revision_mismatch' 2>&1 | grep -qE '✓|passed') || { echo FAIL; exit 1; }
```
**硬阈值**: 该断言用例存在且通过（Generator 实现后）；实现前该用例 FAIL（RED 复现）。

---

### Step 2: 透传 reason_code + 按确定性分类 retryable
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 2「Gate 把该 reason_code 透传到 reason 与 reason_code；确定性→retryable:false（fail-closed），瞬态/缺失→retryable:true」

**可观测行为**:
- 确定性码 → `{gate:'impact_unknown', reason:'projection_revision_mismatch', reason_code:'projection_revision_mismatch', retryable:false}`
- 瞬态 `fact_snapshot_stale` → `{gate:'impact_unknown', reason:'mapper_stale', reason_code:'fact_snapshot_stale', retryable:true}`
- reason_code=null → `{gate:'impact_unknown', reason:'mapper_stale', reason_code:null, retryable:true}`（向后兼容）

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1 | grep -qE 'Test Files.*passed') || { echo FAIL; exit 1; }
```
**硬阈值**: diff-gate.test.js 全绿，含新增确定性/瞬态/向后兼容三类断言。

---

### Step 3: orchestrator 消费 gate → 确定性码进 gateVerdict + retryable:false 终态阻断
**来源**: `[AI_ADDED]` — 理由：证明「透传」的可观测目的是让 orchestrator 得到 `deny:impact:<确定性码>`（非 `mapper_stale`）并终态阻断，闭合 PRD 背景描述的空转黑洞。**注**：loop.js/harness-gates.js 不在本 sprint 修改范围（PRD 范围限定 + 假设 2），此步以**源码行断言**佐证下游已就绪消费 diff-gate 新出口，不改代码、不需 postgres。

**可观测行为**: `loop.js:1454` 用 `impactGateReceipt.reason` 拼 `deny:impact:<reason>`；`loop.js:1542` 用 `retryable===false` 映射 `impact_contract_invalid` → 终态 failRun。diff-gate 新返回的 `reason`（确定性码）与 `retryable:false` 直接驱动该链路。

**验证命令**:
```bash
grep -q 'gateVerdict = `deny:impact:${impactGateReceipt?.reason ?? .unknown.}`' packages/brain/src/orchestrator/loop.js || { echo 'FAIL: loop.js 未按 reason 拼 gateVerdict'; exit 1; }
grep -q "impactGateReceipt?.retryable === false" packages/brain/src/orchestrator/loop.js || { echo 'FAIL: loop.js 未消费 retryable=false'; exit 1; }
```
**硬阈值**: 两行下游消费点均存在（属 [ARTIFACT] 级源码结构断言，非行为断言，见 DoD 归类）。

---

## 禁 mock 边清单

本单改动涉及**跨模块数据传递**（reason_code 从 radius.js → diff-gate → harness-gates → loop.js 接力）。逐条列被改的边与执法约定：

- **diff-gate.js 步骤 3a 分类逻辑本体（被改的核心边）**: 测试必须跑**真实** `evaluateDiffGate`（禁 `vi.mock('../diff-gate.js')` / stub 该函数）。被改的 freshness→reason/reason_code/retryable 分类在真实模块内执行。✅ 非替身。
- **diff-gate.js ↔ radius(mapClient)**: `mapClient` 是 `evaluateDiffGate` 函数签名自带的注入缝（所有现存 diff-gate.test.js 用例同款），mock 仅复刻 radius.js 逐码核对后的真实 `freshness` envelope 形状。radius.js **明确不在本 sprint 范围**（PRD 范围限定「Map/radius.js 本身 reason_code 的产出逻辑」不在内）+ `runtime_resources.postgres=false` 无法起真 radius。登记为 mock 豁免（见「## 未覆盖真实链路清单」）。
- **diff-gate.js ↔ DB(getActiveImpactContract)**: 步骤 3a 在读取 active contract 后、写任何副作用（gap_events/blockTask，步骤 5）**之前**返回——本 sprint 改动点**无 DB 写路径触达**。db-read 用 mock 复刻 contract row（现存用例同款）；postgres=false 无真库。登记为 mock 豁免。

**说明**：本单不新增/修改任何 DB 写路径、状态机迁移或生命周期钩子；改动限于纯内存分类逻辑，故上述 mock 豁免不违反「禁 mock 被改的边」——被改的边（分类逻辑）本身真跑。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | Diff Impact Gate 步骤 3a 透传 Mapper `freshness.reason_code` 到返回 `reason`/`reason_code`，并按确定性 reason_code 集合分类 `retryable`（确定性→false，瞬态/缺失→true） |
| **NFR（做得多好）** | 性能/可靠性 | 无新增外部调用/同步开销（PRD NFR：沿用 gate 现有同步开销）；不放大延迟 |
| **Invariant（永不违反）** | 不变量 | [fail-closed] 确定性不可判定 → 终态阻断（retryable:false），绝不假绿放行；瞬态 stale 不得误挡（fact_snapshot_stale 保持 retryable:true） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 确定性 reason_code 集合随 radius.js 演进；radius 新增/改名结构码时需同步本集合（合同 notes 记为维护点） |
| **死亡告警（停了谁知道）** | 停摆告警 | orchestrator run 日志 gateVerdict=`deny:impact:<reason_code>` 可追溯；确定性阻断落 `impact_gate_deterministic:<reason>` failRun（loop.js:1663） |
| **失败语义（挂了怎么办）** | 故障放行/拦截 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | gate 返回 `retryable:false` → loop.js 映射 `impact_contract_invalid` → failRun 终态（回执 = run 终态 + gateVerdict 字符串） |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ reason_code 是否「确定性（重试不自愈）」 | A. 硬编码结构码白名单集合; B. 依赖 radius 显式标 retryable 字段 | A. 结构码白名单集合（读 radius.js 核对锁定） | radius 当前不返回 retryable 语义标记，只有 reason_code 字符串；集合法确定、可测、与 radius 产出一一对账 | 误判瞬态为确定性 → 本可自愈的任务被终态阻断（误杀）；误判确定性为瞬态 → 回到无限空转黑洞（本 bug） |

> ⚠️ 该判定点误判后果严重（误杀任务 / 退回空转），属「升拍板点」级别。PrepPRD 假设 1 已拍板集合定义方式（读 radius.js 锁定），本合同据此执行。judgment-pending-user: 无（假设 1 已授权 Proposer 锁定，无需再请示）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| freshness 携带确定性 reason_code | 返回 retryable:false，orchestrator 终态阻断 | 幂等（同 reason_code 恒同分类，纯函数） | 无降级——终态即目标（fail-closed） |
| freshness 携带瞬态 fact_snapshot_stale | 返回 retryable:true，orchestrator backoff 后重试 | 幂等 | 事实重扫完成后下轮转 fresh 自愈 |
| freshness 无 reason_code / 缺失 | 回退 mapper_stale + retryable:true（向后兼容旧路径） | 幂等 | 保持旧行为不挡死 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 改动为 Brain 内部 Diff Impact Gate 判定逻辑，无对外暴露 agent / 外部可写入接口。`mapperResult` 来自内部 radius.js，非不可信外部输入。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> `runtime_resources.postgres=false`：本 sprint 改动为纯内存分类逻辑（步骤 3a 在写 DB 副作用前返回），DoD/E2E 用 `evaluateDiffGate` 真实模块 + 注入 db-read/mapClient 验证，无需真 Postgres。
> **vitest 工作目录死规则（9.25.0）**：真实回归测试位于 `packages/brain/src/impact-contract/__tests__/`，必须子 shell `(cd packages/brain && npx vitest run ...)` 跑，从仓库根跑必命中根 include（只覆盖 sprints/**、tests/**、ci/__tests__/**）→ No test files found → FAIL。sprints/** 脚手架测试才允许从根跑。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 真实回归测试（Generator 实现落 packages/brain/src/impact-contract/__tests__/diff-gate.test.js）
#    ——被改的分类逻辑本体真跑（真实 evaluateDiffGate，非 stub），子 shell 切进包根用 brain vitest 配置。
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=dot) \
  || { echo "FAIL: diff-gate.test.js 未全绿"; exit 1; }

# 2. sprint 脚手架测试（sprints/** 在根 vitest include，从仓库根跑）——同源断言双保险。
npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-code.test.ts --reporter=dot \
  || { echo "FAIL: sprint 脚手架测试未全绿"; exit 1; }

# 3. 下游消费链就绪断言（源码行存在性，佐证 PRD 假设 2「loop.js 无需改」）——非行为断言，属结构守卫。
grep -q 'deny:impact:${impactGateReceipt?.reason' packages/brain/src/orchestrator/loop.js \
  || { echo "FAIL: loop.js 未按 reason 拼 deny:impact"; exit 1; }
grep -q 'impactGateReceipt?.retryable === false' packages/brain/src/orchestrator/loop.js \
  || { echo "FAIL: loop.js 未消费 retryable=false"; exit 1; }

echo "✅ Diff Impact Gate reason_code 透传 + fail-closed 出口 验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `mapperResult.freshness.reason_code` 传集合外的未知码（如 `"garbage_code"`）→ 应回退 mapper_stale + retryable:true（不得误 fail-closed）
- 错输入: `mapperResult.freshness = {status:'stale'}`（reason_code 键完全缺失）→ 应回退 mapper_stale + retryable:true
- 边界值: `freshness.reason_code = ''`（空串）/ `freshness.status='fresh'` 但带 reason_code → status=fresh 必须继续走 3b 不进 3a 分支
- 中途中断: 确定性码但 `db=null`（无 contract 读）路径 → 步骤 1 db 分支跳过，仍应正确分类
发现分级: P0/P1（瞬态被误杀 / 确定性退回空转）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## 未覆盖真实链路清单

| 真实链路点 | 为什么被 mock/注入 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| radius.js 真实产出 freshness.reason_code（diff-gate↔radius 边） | radius.js 明确不在本 sprint 范围（PRD 范围限定）；`runtime_resources.postgres=false` 无法起真 radius/真投影库 | mapClient mock 已逐码核对 radius.js baseFreshness+步骤 261-396 的真实产出形状与全部 reason_code；radius 自身回归由其独立测试覆盖 |
| getActiveImpactContract 真实 DB 读（diff-gate↔DB 读边） | 步骤 3a 在写副作用前返回，无写路径触达；postgres=false 无真库 | db-read mock 复刻 contract row（现存 diff-gate.test.js 全部用例同款注入方式）；DB 写路径本 sprint 不触及 |
| orchestrator loop.js 真实 deny:impact 拼接 + failRun 终态（diff-gate↔loop 边） | loop.js 不在修改范围（PRD 假设 2「无需改 loop.js」）；跑真 loop 需 postgres | E2E Step 3 用源码行断言证明下游消费点已就绪；loop.js 对 impact receipt 的消费由 loop.test.js:348（deny:impact:mapper_stale 现存用例）等回归覆盖 |

---

## Test Contract

真实回归测试落 `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`（brain-ci src/** 永久保留，硬规则 20）。Generator 写的 `test()`/`it()` 名**必须包含**下表「BEHAVIOR 覆盖」列的字面子串（DoD Test: 的 `-t` 过滤按此匹配；不匹配则映射断裂）：

| 功能 | Test File | BEHAVIOR 覆盖（必须是 it() 名字面子串） | 预期红证据 |
|---|---|---|---|
| 确定性 stale 码透传 fail-closed | `diff-gate.test.js` | `projection_revision_mismatch` | 实现前返 mapper_stale/retryable:true → FAIL |
| 确定性 unknown 码透传 fail-closed | `diff-gate.test.js` | `capability_not_in_active_projection` | 实现前返 mapper_stale/retryable:true → FAIL |
| 瞬态码保持可重试 | `diff-gate.test.js` | `fact_snapshot_stale` | 实现前 reason_code=undefined → FAIL |
| 向后兼容 null reason_code | `diff-gate.test.js` | `reason_code 为 null` | 现行为已满足 → PASS（防回退守卫） |
| freshness 缺失边界不变 | `diff-gate.test.js` | `freshness 缺失` | 现行为已满足 → PASS（防回退守卫） |

sprint 脚手架同源测试 `sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-code.test.ts`（B-01..B-05）已产出 RED 证据（3 failed / 2 passed，确定性+透传三条 FAIL，向后兼容两条 PASS）。

## 自查记录（Response Schema 字段名对齐）

- contract Response Schema 字段集合 = `{gate, reason, reason_code, retryable}`（字面复用 diff-gate.js 现有 return + JSDoc，非新造）
- 禁用字段名（`retry`/`code`/`can_retry`/`freshness_reason` 等）未出现在任何断言正向位置
- `mapper_stale` 仅作为瞬态/缺失回退的 reason 值（B-04/B-05），不作确定性码 reason（B-01/B-02 用透传的结构码）
- 假绿自查：B-01/B-02/B-03 在 diff-gate.js 步骤 3a 未改前必 FAIL（已由脚手架 RED 证据证明）；非 mkdir/touch/health/404-acceptable 类假绿
