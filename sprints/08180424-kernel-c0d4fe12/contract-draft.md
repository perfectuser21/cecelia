# Sprint Contract Draft (Round 1)

**锚定父路声明**：独立小路（无父路）——本 sprint 是 harness 编排层 Diff Impact Gate 的确定性缺陷修复，`累积 FR` 段声明本 line 暂无历史已验收 ability，无父 Golden Path 可挂。

gp-anchor: skipped (product-map.json not found)
contract-gate: applies (packages/brain/src/lib/contract-gate.js present, cecelia worktree)

## Response Schema（推导来源: PRD 明确 N/A — 任务无 HTTP 响应）

本 sprint 只改内部模块 `diff-gate.js` 的 `evaluateDiffGate()` 返回对象，**不新增/不修改任何 HTTP 路由**。故无 `## Response Schema` HTTP 段，Reviewer 第 6 维 verification_oracle_completeness 自动满分档（PRD 无 Response Schema 段）。

被改函数 `evaluateDiffGate()` 3a 分支的返回对象契约（内部函数返回值，非 HTTP body，字面沿用现有 JSDoc `diff-gate.js` 已声明字段）：

```json
{"gate": "impact_unknown", "reason": "<string>", "reason_code": "<string|null>", "retryable": "<boolean>"}
```

- `gate` (string, 必填): 恒为 `"impact_unknown"`（3a 分支不变，来源——现有 JSDoc）
- `reason` (string, 必填): 透传后的裁决码；有 `reason_code` 时字面等于 `freshness.reason_code`，缺失时兜底 `"mapper_stale"`（来源——PRD Golden Path step2 + 边界情况）
- `reason_code` (string|null, 必填): 透传 `mapperResult.freshness.reason_code`；缺失为 `null`（来源——现有 JSDoc 已声明 `reason_code?: string|null`，本 sprint 通电 3a 分支）
- `retryable` (boolean, 必填): `status==='stale'` 且有 reason_code → `true`；`status==='unknown'` 或 freshness/reason_code 缺失 → `false`（来源——PRD Golden Path step2 + 边界情况）

**禁用字段名**: 无（不引入新字段，字面复用 PRD 与现有 JSDoc 给定的 `gate`/`reason`/`reason_code`/`retryable`）

## Golden Path

[编码后 Diff Gate 复算] → [读取并透传 freshness.reason_code + 按 status 区分 stale/unknown] → [orchestrator 收携真实 reason_code 裁决并对确定性结论终止，不再空转]

---

### Step 1: 编码完成，orchestrator 以真实 diff 复算 Diff Gate，Mapper 返回确定性 unknown 结论
**来源**: `[FROM_PRD]` — PRD 第 24 行 Golden Path 具体点 1（`freshness = { status: 'unknown', reason_code: 'impact_anchor_missing' }`）

**可观测行为**: `evaluateDiffGate({ mapClient })` 中注入的 Mapper 复算返回 `freshness.status === 'unknown'`、`freshness.reason_code === 'impact_anchor_missing'`，进入 diff-gate.js 步骤 3a 分支（`freshness.status !== 'fresh'`）。

**验证命令**（node/vitest，postgres:false，db=null 即到达 3a）:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js) 2>&1 | grep -E "impact_anchor_missing|passed"
```

**硬阈值**: `evaluateDiffGate` 对 unknown 输入返回 `gate === "impact_unknown"`（分支进入 3a）。

---

### Step 2: Gate 透传 freshness.reason_code 并按 status 做 fail-closed 区分
**来源**: `[FROM_PRD]` — PRD 第 25 行 Golden Path 具体点 2（透传 reason_code + `unknown` fail-closed `retryable:false`，与 `stale` 瞬时滞后 `retryable:true` 明确区分）

**可观测行为**:
- `status === 'unknown'` 且有 reason_code → 返回 `{ reason: <reason_code>, reason_code: <reason_code>, retryable: false }`（确定性结论 fail-closed 终止）。
- `status === 'stale'` 且有 reason_code → 返回 `{ reason: <reason_code>, reason_code: <reason_code>, retryable: true }`（瞬时滞后可重试）。
- `freshness` 缺失 或 `reason_code` 为 null → 保守兜底 `{ reason: 'mapper_stale', retryable: false }`（不得因缺 reason_code 而误标可无限重试）。

**目标实现分支形态**（generator 参考，非强制逐字，行为等价即可）:
```js
// 3a. Mapper freshness 非 fresh（含 stale 瞬时滞后 / unknown 确定性结论）→ impact_unknown
const freshness = mapperResult?.freshness;
if (!freshness || freshness.status !== 'fresh') {
  const reasonCode = freshness?.reason_code ?? null;
  if (!reasonCode) {
    // freshness 缺失 / reason_code 为 null → 保守 fail-closed 兜底
    return { gate: 'impact_unknown', reason: 'mapper_stale', reason_code: null, retryable: false };
  }
  if (freshness.status === 'stale') {
    // 瞬时投影滞后，重投影可自愈 → 透传 reason_code 且可重试
    return { gate: 'impact_unknown', reason: reasonCode, reason_code: reasonCode, retryable: true };
  }
  // unknown（及任何非 fresh 且带 reason_code 的确定性结论）→ 透传 + fail-closed 终止
  return { gate: 'impact_unknown', reason: reasonCode, reason_code: reasonCode, retryable: false };
}
```

**验证命令**（真实 evaluateDiffGate，不 mock 被改的边）:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js) 2>&1 | grep -E "3a|reason_code|retryable|passed"
```

**硬阈值**: unknown → `retryable === false` 且 `reason === reason_code === "impact_anchor_missing"`；stale → `retryable === true` 且 `reason === reason_code === "fact_snapshot_stale"`；freshness/reason_code 缺失 → `reason === "mapper_stale"` 且 `retryable === false`。

---

### Step 3: orchestrator 消费透传后的 reason_code，确定性结论终止而非空转
**来源**: `[FROM_PRD]` — PRD 第 26 行 Golden Path 具体点 3（携真实 reason_code 的裁决 `deny:impact:impact_anchor_missing` 并终止，不再重复发 `deny:impact:mapper_stale`）

**可观测行为**: orchestrator loop（`packages/brain/src/orchestrator/loop.js:1454`）以 `deny:impact:${impactGateReceipt?.reason}` 生成 gateVerdict——透传后 reason=`impact_anchor_missing` → `gateVerdict === "deny:impact:impact_anchor_missing"`（不再是 `deny:impact:mapper_stale`）。且 loop.js:1542-1544 消费 `retryable === false` → `failure_class === "impact_contract_invalid"`（确定性终止路径），而非 `retryable:true` 的 `infrastructure_blocked`（退避复探空转路径）。

> **接线现状说明（[FROM_PRD] 溯源）**：orchestrator 消费侧（loop.js:1454 生成 `deny:impact:<reason>`、loop.js:1542-1544 依 `retryable` 派生 failure_class）**已存在且正确**——本 sprint 无需改 loop.js 生产代码；只要 diff-gate.js 3a 透传真实 reason_code 且对 unknown 置 `retryable:false`，既有消费侧即自动产出 `deny:impact:impact_anchor_missing` + `impact_contract_invalid` 终止。loop.test.js 补一条断言固化此透传契约（PRD 第 50 行「可能需补充」）。

**验证命令**（orchestrator loop 单测，真实消费路径，vitest）:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js) 2>&1 | grep -E "deny:impact|impact_contract_invalid|passed"
```

**硬阈值**: loop 收到 `{ gate:'impact_unknown', reason:'impact_anchor_missing', retryable:false }` 时 `gateVerdict === "deny:impact:impact_anchor_missing"`，且不再产出 `deny:impact:mapper_stale`；确定性结论走 `impact_contract_invalid` 终止，不进 `infrastructure_blocked` 无限退避。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [diff-gate.test.js] `fact_revisions 缺少目标 repo 时返回 impact_unknown`（reason:`revision_evidence_missing`, retryable:`true`）— 不得回退。
- [diff-gate.test.js] `Mapper.radius() 超时时 Diff Gate 返回 blocked（不放行）`（异常路径 → impact_unknown, retryable:true）— 不得回退。
- [diff-gate.test.js] `Mapper revision mismatch 时 Diff Gate 返回 blocked`（reason:`revision_mismatch`, retryable:true）— 不得回退。
- [harness-gates.test.js] `merge 前重新查询 Mapper freshness，stale 时即使旧 Diff receipt 存在也阻断`——该测试 stub diffGate 返回值，断言消费侧原样透传 `reason`/`retryable` 到 `blocked`；本 sprint 改 diff-gate.js 内部不触其 stub，消费侧透传语义保持。
- [diff-gate.test.js] `情形一/情形二` happy path `freshness:{status:'fresh'}` → `reason_code:null` — fresh 分支不变，不得回退。

### Unified Map 半径
- [MAP_NOT_CONFIGURED]：task.payload.map_scope=`['F1']` 但 `map_repo` 缺失，`/api/brain/map/radius` 未配置 → 无 `must_run_assertions` 可注入；不回退领域硬编码，仅以本 sprint PRD 显式回归约束（上方回归测试清单）为准。

### 累积 FR（context-manifest，来源 [累积FR]）
- context-manifest: 本 line（journey e6f803f2）历史 ability 均为 planned 态，无 done/working 记录（PRD 第 70 行）——无累积 FR 约束。若 Brain `/api/brain/line/e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29/context-manifest` 端点在评测机可达可复核；不可达记一行 `context-manifest: unavailable`，不静默跳过。

## 禁 mock 边清单

本单改动属「状态机 / 跨模块数据传递」类（Diff Gate 裁决派生 + reason_code/retryable 跨 diff-gate→orchestrator 传递），按 v9.12 硬规则逐条列禁 mock 的边：

- **代码 ↔ `evaluateDiffGate` freshness→verdict 派生逻辑**（本单改的正是 3a 分支内 `freshness.reason_code`/`status` → `reason`/`retryable` 的派生）：failing test **必须调用真实 `evaluateDiffGate`**，禁止 `vi.mock('../diff-gate.js')` 或 stub 该函数；仅允许注入 `mapClient` 作为受控输入（Mapper HTTP 客户端是本 sprint 范围外的外层边界，radius.js 明确不在范围内）。
- **diff-gate ↔ orchestrator loop 的 reason_code/retryable 传递边**：loop.test.js 断言消费侧时，`deny:impact:<reason>` 与 `retryable→failure_class` 派生必须由**真实 loop.js 消费逻辑**执行（现有 loop.test.js 用受控 `impactGate.beforeEvaluate.mockResolvedValue` 提供 gate 返回值输入，断言真实 loop 生成的 `gateVerdict`——这是合法的：被改的传递边由真实 loop 逻辑跑，mock 的是更外层的 gate 输入）。

**无真 DB 边说明**：3a 分支在任何 DB 写入（步骤 5 drift block）**之前**即 return，本 sprint 改动路径零 DB 写入，故无「代码↔DB 表」边需真 Postgres——与 `runtime_resources.postgres=false` 一致。failing test 用 `db:null` 直达 3a，不涉持久化。

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」接缝，改的是 Brain 内部模块函数返回值派生，无外部真实调用方。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）——failing test 调真实 `evaluateDiffGate` 与真实 loop 消费逻辑，无 `force_*`/stub/假数据顶替被测核心；`mapClient` 注入是 PRD 第 80-83 行 E2E 明确要求的受控 Mapper 输入，非豁免。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | diff-gate.js 3a 分支透传 `freshness.reason_code`；`status==='stale'` → retryable:true，`status==='unknown'` → retryable:false（fail-closed），freshness/reason_code 缺失 → 兜底 mapper_stale + retryable:false |
| **NFR（做得多好）** | 性能/可靠性 | 沿用 Mapper 现有 10s 超时不变（PRD NFR 段）；无新增延迟/频控要求（PRD 标待定） |
| **Invariant（永不违反）** | 不变量 | [fail-closed] Mapper 不可判定绝不假绿、确定性结论终止而非无限重试；[reason 透传] 不得用泛化 mapper_stale 掩盖真实 reason_code（PRD Invariant 段，见 INV-1/INV-2） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | N/A — 纯逻辑分支修复，无 token/数据保质期 |
| **死亡告警（停了谁知道）** | 告警手段 | 现有 nightly-red 归因铁律覆盖（连续 ≥3 晚同 job 红贴失败 step 最后 20 行 stdout）；本修复恰为消除 `deny:impact:mapper_stale` 空转告警噪音 |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 见下方失败语义声明——核心即本 sprint：unknown=拦截终止（fail-closed），stale=拦截可重试，缺失=保守拦截终止 |
| **效果确认（已发≠已生效）** | 回执方式 | orchestrator gateVerdict `deny:impact:<reason_code>` 写入 decision log（可观测）；确定性结论产出 `impact_contract_invalid` failure_class 而非 `infrastructure_blocked`，即真实生效回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| Mapper 复算结论是否「确定性不可判定」（重试不自愈） | A. 按 `freshness.status` 值（unknown vs stale）判定; B. 枚举 reason_code 硬编码分类 | A. 按 `freshness.status` 值判定 | radius.js 现有分类以 status 承载语义（unknown=结构结论/stale=瞬时滞后，PRD 第 13-15 行）；枚举 reason_code 会与 radius.js 耦合而 radius.js 明确不在范围 | 若误把 unknown 当 stale（retryable:true）→ orchestrator 无限空转（即本 sprint 修复的原 bug）；若误把 stale 当 unknown（retryable:false）→ 瞬时滞后被过早终止，可自愈任务被误 blocked |

> 本 sprint 无真机/RPA 接缝判定点；上表唯一判定点为 Gate 内部对 Mapper status 语义的解读（纯逻辑，非真实世界接缝）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是（幂等键=task_id） | 客户端重试，Brain 端 dedup |
| Mapper freshness=`unknown`（确定性结论） | 返回 `impact_unknown` + 真实 reason_code + `retryable:false`，拦截不假绿 | N/A（确定性，重试不自愈，终止） | orchestrator → `impact_contract_invalid` 终止，任务转 blocked/escalate |
| Mapper freshness=`stale`（瞬时滞后） | 返回 `impact_unknown` + 真实 reason_code + `retryable:true`，拦截可重试 | 是（重投影后可自愈） | orchestrator 退避复探，run deadline 收敛 |
| `freshness` 缺失 / `reason_code` 为 null | 兜底 `reason:'mapper_stale'` + `retryable:false`，保守 fail-closed | N/A（保守终止，不无限重试） | orchestrator → `impact_contract_invalid` 终止 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 改 Brain 内部编排层模块函数，无对外暴露 agent、无外部用户可写入接口。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 3a unknown 透传+终止 | `sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-passthrough.test.js` | `unknown 确定性结论透传` | 现 reason=mapper_stale/retryable=true → FAIL |
| 3a stale 透传+可重试 | 同上 | `stale 瞬时滞后透传` | 现 reason=mapper_stale → FAIL |
| 3a freshness 缺失兜底 | 同上 | `freshness 缺失时保守` | 现 retryable=true → FAIL |
| 3a reason_code null 兜底 | 同上 | `reason_code 为 null` | 现 retryable=true → FAIL |

> 「BEHAVIOR 覆盖」列每个名均为对应 `it()` 名的字面子串（`grep -F` 可命中）：`unknown 确定性结论透传` / `stale 瞬时滞后透传` / `freshness 缺失时保守` / `reason_code 为 null`。
> 当前 4 用例全部 RED（已实测：`Tests 4 failed`），实现后转 GREEN。generator 另需把等价回归补进 `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` 与 `packages/brain/src/orchestrator/__tests__/loop.test.js`。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api，node/vitest 复算 Gate）

**journey_type**: autonomous
**target_environment**: local_api

> **说明**：本 sprint 改的是内部模块 `diff-gate.js` 的裁决派生逻辑，**无新增/修改 HTTP 路由、无 DB 写入路径**（3a 分支在持久化前 return），故 `runtime_resources.postgres=false`。target_environment=local_api 的真实 oracle 即 PRD 第 90 行明示的「node 单测复算 Gate」——用 `packages/brain` 自身 vitest 配置对真实 `evaluateDiffGate` 与真实 orchestrator loop 消费逻辑复算，不需要 DB_URL / HTTP server / curl。
> **vitest 工作目录死规则（9.25.0）**：对 `packages/brain/src/**` 的测试必须子 shell 切进包根跑（用该包自己的 vitest 配置），从仓库根跑会命中根 vitest include（仅 sprints/**、tests/** 等）→ "No test files found"。sprint 契约测试位于 `sprints/**`，可从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail

# 1. 契约测试（sprints/** 下，从仓库根跑合法）——本 sprint TDD Red→Green 见证
npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-passthrough.test.js 2>&1 | tee /tmp/sprint-e2e.log
grep -qE "Tests[[:space:]]+4 passed|4 passed" /tmp/sprint-e2e.log || { echo "FAIL: sprint 契约测试未全绿"; exit 1; }

# 2. 包内 diff-gate 回归（子 shell 切进 packages/brain，用其 vitest 配置）——3a 分支 + 既有 fail-closed 不回退
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ) 2>&1 | tee /tmp/diffgate-e2e.log
grep -qE "Tests[[:space:]]+[0-9]+ passed" /tmp/diffgate-e2e.log || { echo "FAIL: diff-gate 包内测试未全绿"; exit 1; }
grep -qE "Tests[[:space:]]+[0-9]+ failed" /tmp/diffgate-e2e.log && { echo "FAIL: diff-gate 存在失败用例"; exit 1; } || true

# 3. 包内 harness-gates 回归（消费侧透传语义不回退）
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/harness-gates.test.js ) 2>&1 | tee /tmp/harness-e2e.log
grep -qE "Tests[[:space:]]+[0-9]+ passed" /tmp/harness-e2e.log || { echo "FAIL: harness-gates 包内测试未全绿"; exit 1; }
grep -qE "Tests[[:space:]]+[0-9]+ failed" /tmp/harness-e2e.log && { echo "FAIL: harness-gates 存在失败用例"; exit 1; } || true

# 4. 包内 orchestrator loop 回归（deny:impact:<reason_code> 透传 + retryable→failure_class）
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js ) 2>&1 | tee /tmp/loop-e2e.log
grep -qE "Tests[[:space:]]+[0-9]+ passed" /tmp/loop-e2e.log || { echo "FAIL: loop 包内测试未全绿"; exit 1; }
grep -qE "Tests[[:space:]]+[0-9]+ failed" /tmp/loop-e2e.log && { echo "FAIL: loop 存在失败用例"; exit 1; } || true

echo "✅ Golden Path 验证通过：reason_code 透传 + unknown fail-closed 终止 + 消费侧不再空转"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `freshness.status` 取 `['fresh','stale','unknown']` 之外的非法值（如 `'pending'`/空串/数字），或 `freshness` 为非对象（数组/字符串）时，3a 是否稳健兜底为 `retryable:false`（不得抛异常、不得误判可重试）
- 重复提交: 同一 unknown 结论连续多次调用 `evaluateDiffGate`，返回是否幂等一致（`retryable:false` 恒定，无副作用累积）
- 中途中断: `mapClient` 返回 `freshness={status:'stale'}` 但 `reason_code` 字段缺失（非 null，是 undefined）时，是否走「缺 reason_code → 兜底 mapper_stale + retryable:false」而非误判 stale 可重试
- 边界值: `reason_code` 为空串 `''`、`status='fresh'` 但仍带 `reason_code`（fresh 应正常放行不进 3a）、既有 4 类 impact_unknown 出口（mapper_unavailable/revision_mismatch/manifest_digest_mismatch/projection_digest_mismatch）retryable 是否全部保持原值不被本改动波及
发现分级: P0/P1（确定性结论仍被标可重试导致空转，或 stale 被误终止）→ 阻塞 merge；P2/P3（reason 文案/日志细节）→ 记 findings 不阻塞
