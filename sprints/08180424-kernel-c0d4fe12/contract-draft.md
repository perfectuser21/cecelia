# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传 Map 确定性 reason_code + fail-closed 出口（r19）

contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），执行代码层 Contract Gate + skill 内置规则。
gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD 字面 / N/A）

N/A — 本任务无 HTTP 响应。改动是 Brain 内部函数 `evaluateDiffGate(...)` 的返回对象字段语义（`gate` / `reason` / `reason_code` / `retryable`），非对外 API。Reviewer 第 6 维按内部返回字段的 jq/断言覆盖度审查（下方 DoD 用 vitest 断言 codify）。

被改动的内部返回契约（`diff-gate.js` Step 3a 出口）：

```jsonc
// freshness.status === 'unknown'（确定性）→ fail-closed
{ "gate": "impact_unknown", "reason": "<map_reason_code>", "reason_code": "<map_reason_code>", "retryable": false }
// freshness.status === 'stale'（瞬态）→ 维持现状
{ "gate": "impact_unknown", "reason": "mapper_stale", "retryable": true }
// freshness.status === 'unknown' 且 reason_code 缺失（理论不应发生）→ 仍 fail-closed
{ "gate": "impact_unknown", "reason": "impact_unknown_no_reason_code", "retryable": false }
```

- `reason` (string, 必填): unknown 分支必须是 Map 的确定性 `freshness.reason_code`（原样透传）；缺失时用兜底常量 `impact_unknown_no_reason_code`。来源——PRD Golden Path 第 3 步 + 边界情况第 3 条。
- `reason_code` (string|null): unknown 分支携带同值（供 receipt `reason ?? reason_code` 二路兜底）。来源——PRD 第 3 步「原样透传到 receipt（reason/reason_code）」。
- `retryable` (boolean): unknown → `false`（fail-closed 终止）；stale → `true`（瞬态自愈）。来源——PRD 第 3/5 步。
- **禁用字段名 / 禁用取值**: unknown 分支的 `reason` **绝不允许**为 `"mapper_stale"`（那是折叠 bug 的病灶）。

## 锚定父路声明

独立小路（无父路）—— harness kernel 内部调度纠错，journey `e6f803f2`（step `aad25bdb`）现有 ability 均为 planned，无已验收父 Golden Path 可挂。

## Golden Path

[harness run 到达 beforeEvaluate Diff Impact Gate] → [evaluateDiffGate 调 Mapper 复算影响半径] → [Mapper 返回 freshness.status='unknown' + 确定性 reason_code] → [Gate 按 status 分流：unknown 透传 reason_code + retryable:false] → [loop.js 走 impact_gate_deterministic:<reason_code> 终止出口，不再 backoff 空转]

---

### Step 1: Diff Gate 复算影响半径，Mapper 给出确定性 unknown 结论
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步（`beforeEvaluate` → `evaluateDiffGate` → Mapper 返回 `freshness.status='unknown'` 携 `reason_code`）。

**可观测行为**: `evaluateDiffGate` 拿到 `mapperResult.freshness = { status:'unknown', reason_code:'capability_not_in_active_projection' }`（Mapper 外部边界，测试用注入 mapClient 复现）。

**验证命令**:
```bash
# diff-gate 单测：unknown 结论下 gate=impact_unknown（不进入 pass/extend/drift）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1) | grep -qE "Tests.*[1-9][0-9]* passed" || { echo "FAIL: diff-gate 单测未通过"; exit 1; }
```

**硬阈值**: diff-gate.test.js 全绿（含新增 unknown 用例）。

---

### Step 2: Gate 不再折叠 mapper_stale — 透传 reason_code 且 retryable:false
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 范围限定第 1 条（`diff-gate.js` Step 3a 区分 stale/unknown，透传 `reason_code`，unknown 置 `retryable:false`）。

**可观测行为**: `evaluateDiffGate` 返回 `{ gate:'impact_unknown', reason:'capability_not_in_active_projection', reason_code:'capability_not_in_active_projection', retryable:false }`；`reason !== 'mapper_stale'`。

**验证命令**:
```bash
# Golden Path 回归（真实 diff-gate 模块，被改的边不 mock）：unknown → reason_code 透传 + retryable:false
npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js 2>&1 | grep -qE "Tests.*[1-9][0-9]* passed" \
  && ! (npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js 2>&1 | grep -qE "Tests.*[1-9][0-9]* failed") \
  || { echo "FAIL: Golden Path 回归未全绿"; exit 1; }
```

**硬阈值**: `diff-gate-deterministic.test.js` 5/5 全绿（3 条 unknown/edge + 2 条 stale/unavailable 反向不变）。

---

### Step 3: loop.js 走 fail-closed 终止出口，不再无限 backoff 空转
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步（loop 观察 `deny:impact:<reason_code>` + `failure_class='impact_contract_invalid'` → `failRun('impact_gate_deterministic:<reason_code>')`，run 结束为 failed，不再 backoff）。

**可观测行为**: `runLoop` 在 `beforeEvaluate` 返回 `retryable:false` 的 impact_unknown receipt 时，`exitReason==='impact_gate_deterministic'`，`finalizeRun` reason 为 `impact_gate_deterministic:<reason_code>`，且**未调用 backoff sleep**。反向：`retryable:true`（mapper_stale）时走 infrastructure backoff（sleep 被调用），不误入终止出口。

> 说明：loop.js 现有路由（line ~1542 `retryable===false → impact_contract_invalid`，line ~1661 `impact_contract_invalid → failRun('impact_gate_deterministic:…')`）**已能正确消费** retryable:false，本 sprint **不改 loop.js 代码**——本步是端到端回归护栏，锁死「确定性 gate → 终止出口，不空转」的契约，防止未来回退。

**验证命令**:
```bash
# loop 回归：retryable:false → impact_gate_deterministic 终止 + 无 backoff sleep；retryable:true → backoff（对照）
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js 2>&1) | grep -qE "Tests.*[1-9][0-9]* passed" \
  && ! ((cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js 2>&1) | grep -qE "Tests.*[1-9][0-9]* failed") \
  || { echo "FAIL: loop.test.js 未全绿"; exit 1; }
```

**硬阈值**: loop.test.js 全绿（含新增确定性终止 + stale backoff 对照两条断言）。

---

## 已知约束（来自回归测试 + 累积 FR）

- [diff-gate.test.js] → `没有 active contract 时 fail-closed，且不调用 Mapper`（fail-closed 原则，本次不得破坏）
- [diff-gate.test.js] → `Mapper.radius() 超时时 Diff Gate 返回 blocked（不放行）`（mapper_unavailable → retryable:true，本次维持）
- [diff-gate.test.js] → `Mapper revision mismatch 时 Diff Gate 返回 blocked` reason='revision_mismatch' retryable:true（Step 3b 分支语义不变）
- [loop.test.js] → `Impact schema 确定性错误精确终止且不进入基础设施重试`（exitReason impact_gate_deterministic，sleeps=[]，既有确定性路径基线）
- [loop.test.js] → `Diff Gate 未放行时不创建 evaluator attempt，并把裁决写入 decision log`（gateVerdict `deny:impact:mapper_stale` 既有形态，本次新增 `deny:impact:<reason_code>` 形态）
- [累积FR] context-manifest: unavailable（postgres:false，无 Brain 5221 在线；本 line 现有 ability 均 planned，无累积已验收行为约束）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | Diff Impact Gate Step 3a 按 `freshness.status` 分流：`unknown`→透传 Map `reason_code` + `retryable:false`（fail-closed）；`stale`→维持 `mapper_stale` + `retryable:true`（瞬态）。 |
| **NFR（做得多好）** | | 无新增网络往返/延迟（同步判定，PrepPRD 未指定阈值）。 |
| **Invariant（永不违反）** | | [fail-closed] 任何不可判定情形绝不假绿放行；[不折叠确定性] unknown 不得被折叠成 mapper_stale 进入无限重试。 |
| **判定点（怎么知道）** | | 见下方判定点登记表。 |
| **保质期（何时过期）** | | 无（纯逻辑分支，随 Mapper freshness 语义存续）。 |
| **死亡告警（停了谁知道）** | | 回归失守 → diff-gate.test.js / diff-gate-deterministic.test.js / loop.test.js 在 brain-ci + Sprint Tests CI 变红（PR 阻断）。 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明。核心：不可判定一律 fail-closed，宁可终止 run 也不假绿。 |
| **效果确认（已发≠已生效）** | | 确定性阻断写入 run 审计 `impact_gate` receipt（含真实 reason_code），并以 `impact_gate_deterministic:<reason_code>` 作为 failRun 原因（loop.test.js 断言 finalizeRun reason）。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ Map 结论是「瞬态可重试」还是「确定性不可判」 | A. 按 `freshness.status`（fresh/stale/unknown）；B. 按 `reason_code` 值枚举白名单；C. 按 HTTP/异常类型 | A. 以 `freshness.status==='unknown'` 为确定性唯一依据，`'stale'` 一律瞬态可重试 | 与 `map/radius.js` 的 stale/unknown 语义源头一致（stale=事实快照落后可自愈；unknown=结构上判不了）；避免维护易漂移的 reason_code 白名单 | 误判 unknown→瞬态=无限重试空转（当前 bug）；误判 stale→确定性=错杀可自愈 run。二者皆严重，故 ⚠️ |
| Mapper 不可达/抛异常 | A. fail-closed 终止；B. retryable 瞬态 | B. `mapper_unavailable` → retryable:true（真瞬态，不归入本次 fail-closed） | 网络抖动/临时不可达是真瞬态，重试会自愈；与现状一致，PRD 边界情况第 1 条 | 若错判为确定性=网络抖动错杀 run |

> `judgment-pending-user`: 无——⚠️ 判定点的边界已由 PRD ASSUMPTION（`freshness.status==='unknown'` 为唯一确定性依据）在 PrepPRD 阶段拍定，proposer 沿用，不新增待确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Mapper 返回 unknown（确定性） | Gate 返回 retryable:false → loop failRun `impact_gate_deterministic:<reason_code>`，run=failed | 否（确定性，重试永不自愈，故不重试） | 无降级——fail-closed 终止，交人/后续修复 |
| Mapper 返回 stale（瞬态） | Gate 返回 retryable:true → loop infrastructure backoff + continue | 是（瞬态，重试自愈） | backoff 复探，由 run deadline 收敛 |
| Mapper 抛异常/不可达 | Gate 返回 mapper_unavailable + retryable:true | 是 | 同 stale：backoff 复探 |
| unknown 但 reason_code 缺失（理论不应发生） | 仍 retryable:false，reason 用兜底常量 `impact_unknown_no_reason_code` | 否 | fail-closed，绝不假绿放行 |

### 输入对抗面

N/A — 无对外暴露 agent 输入。改动落在 Brain 内部 impact-contract + orchestrator 调度逻辑，输入源为受信 Mapper（内部服务）与合同存储，无外部用户可写入面。

## 禁 mock 边清单

本单改动触及「状态机 / 跨模块数据传递」（Diff Gate 判定 → gateReceipt → loop failure_class 路由 → 终止/backoff 分流），按 v9.12 硬规则列禁 mock 边：

- **Mapper freshness → diff-gate 判定分支（本单改的核心边）**：`diff-gate-deterministic.test.js` 与 `diff-gate.test.js` 必须真调 **真实 `evaluateDiffGate` 模块**，只在 Mapper 外部边界注入 `mapClient`（unknown/stale freshness 的输入源）、在合同存储外部边界注入 `db`（`getActiveImpactContract` 读取，本单未改）。**禁止** mock/stub `evaluateDiffGate` 本身或其内部 Step 3a 分支逻辑。
- **diff-gate 返回 `retryable` → loop failure_class 路由 → 终止出口（下游消费边）**：loop.js 代码本单**不改**（现有路由已正确消费 retryable:false）。`loop.test.js` 回归在 loop 的既有注入接缝 `deps.impactGate.beforeEvaluate` 供入「真实 diff-gate 会产出的 receipt 形态」（retryable:false + reason_code / retryable:true + mapper_stale），断言 `runLoop` 的 exitReason / finalizeRun reason / sleep 调用——测的是 loop **未改**的路由代码，receipt 输入侧的 diff-gate→receipt 边已在上一条用真实模块覆盖，二者拼成完整链路，无一处 mock 到「被改的边」。

> 说明：本单不触碰真实 DB 写路径（无 INSERT/UPDATE 改动，postgres:false），故无「代码↔DB 表」禁 mock 边；DB 仅作为 `getActiveImpactContract` 的注入替身出现在外层边界。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 为 Brain 内部纯逻辑改动（依赖注入 db + mapClient，无真实 Postgres：runtime_resources.postgres=false），验收 oracle = vitest 单测真跑（node）。无 HTTP server / psql。
> vitest 工作目录死规则（9.25）：`packages/brain/src/**` 的测试用子 shell `(cd packages/brain && npx vitest run ...)`；`sprints/**` 的合同测试从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail

FAIL=0

# 1. Golden Path 回归（真实 diff-gate 模块）：unknown 透传 reason_code + retryable:false；stale 维持瞬态
OUT_SPRINT=$(npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-deterministic.test.js 2>&1)
echo "$OUT_SPRINT" | grep -qE "Tests.*[1-9][0-9]* passed" || { echo "FAIL: sprint 回归无通过用例"; FAIL=1; }
echo "$OUT_SPRINT" | grep -qE "Tests.*[0-9]+ failed" && { echo "FAIL: sprint 回归存在失败用例"; FAIL=1; }

# 2. diff-gate 单测全绿（含新增 unknown/stale 断言，brain-unit CI 永久回归）
OUT_DG=$( (cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1) )
echo "$OUT_DG" | grep -qE "Tests.*[1-9][0-9]* passed" || { echo "FAIL: diff-gate.test.js 无通过用例"; FAIL=1; }
echo "$OUT_DG" | grep -qE "Tests.*[0-9]+ failed" && { echo "FAIL: diff-gate.test.js 存在失败用例"; FAIL=1; }

# 3. loop 回归全绿（确定性终止 + stale backoff 对照，brain-unit CI 永久回归）
OUT_LOOP=$( (cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js 2>&1) )
echo "$OUT_LOOP" | grep -qE "Tests.*[1-9][0-9]* passed" || { echo "FAIL: loop.test.js 无通过用例"; FAIL=1; }
echo "$OUT_LOOP" | grep -qE "Tests.*[0-9]+ failed" && { echo "FAIL: loop.test.js 存在失败用例"; FAIL=1; }

[ "$FAIL" -eq 0 ] && echo "✅ Golden Path 验证通过（Diff Gate 确定性 unknown fail-closed + 瞬态 stale 不变 + loop 终止不空转）" || { echo "❌ E2E 验收失败"; exit 1; }
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `evaluateDiffGate` 拿到 `freshness={status:'unknown'}` 但整体 `freshness` 对象缺 `reason_code` 键（非 null 而是 undefined）→ 必须仍 retryable:false，reason 兜底非空字符串，不得抛异常/返回 undefined reason。
- 边界值: `freshness.status` 为既非 'fresh'/'stale'/'unknown' 的未知值（如 'degraded'）→ 应落入安全侧（当前实现折叠 mapper_stale/retryable:true 属可接受的保守瞬态；确认不会误判成 retryable:false 错杀，也不会崩）。
- 中途中断: unknown 分支必须在 Step 3b（revision/digest mismatch）**之前**短路返回，确认不会因 unknown + fact_revisions 缺失被 revision_evidence_missing 覆盖语义。
- 反向回退: 确认 `stale` 与 `mapper_unavailable` 两条瞬态路径 reason/retryable 与改前逐字一致（无回归）。
发现分级: P0/P1（fail-closed 失守=假绿放行 / 瞬态被错杀）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。
