# Sprint Contract Draft (Round 1)

**Sprint**: fix(harness) — Diff Impact Gate 透传 reason_code 并对确定性结论 fail-closed 出口（r19）
**journey_type**: autonomous
**target_environment**: local_api（纯 kernel 决策函数，无 HTTP 端点、无 Postgres 依赖——见下方 E2E 说明）
**gate-anchor**: skipped (product-map.json not found)
**contract-gate**: cecelia worktree，packages/brain/src/lib/contract-gate.js 存在，走代码层 Contract Gate（本合同 [BEHAVIOR] 为 node 谓词，非 curl/psql，gate 惯用法不适用）

## 锚定父路声明

独立小路（无父路）——本 sprint 是对既有 `evaluateDiffGate` 步骤 3a 的定点行为修复，不覆盖某条 Golden Path 的连续步骤，PRD 累积 FR 为空（本 line 暂无历史）。

## Response Schema（推导来源: PRD 字面 + diff-gate.js 现有返回体）

### Endpoint: N/A — 无 HTTP 响应

本任务是 `evaluateDiffGate(...)` 函数返回体的语义修正，**无新增/变更 HTTP 端点**（Reviewer 第 6 维 verification_oracle_completeness 就函数返回体字段逐条核对，见下）。步骤 3a 返回对象契约：

```json
{"gate": "impact_unknown", "reason": "mapper_stale", "reason_code": "<Map 原样 code 或 null>", "retryable": "<boolean>"}
```

- `gate` (string, 必填, 字面量 `"impact_unknown"`)：来源——PRD Golden Path step 3 + diff-gate.js:203 现值不变
- `reason` (string, 必填, 字面量 `"mapper_stale"`)：来源——保留既有类别标签（diff-gate.js:205；harness-gates.js:30 消费 `reason ?? reason_code`），**不得抹除**
- `reason_code` (string|null, 必填)：来源——PRD step 2「把 `mapperResult.freshness.reason_code` 原样透传」；**新增透传字段**（当前代码丢弃）
- `retryable` (boolean, 必填)：来源——PRD step 2；确定性终态 `false`（fail-closed），否则 `true`
**禁用字段名**（不得用同义词替换上述 key）: `retry`、`can_retry`、`reasonCode`（camelCase）、`code`、`stale_reason`、`terminal`
**Error path**: 无 HTTP，错误路径即「Mapper 抛异常」分支（diff-gate.js:190-197），维持 `{gate:'impact_unknown', reason:'mapper_unavailable', retryable:true}` 不变

### 确定性 vs 暂态 reason_code 集合（PRD ASSUMPTION 锁死，本合同权威定义）

| 类别 | reason_code 集合 | retryable | 来源枚举 |
|---|---|---|---|
| **确定性终态**（fail-closed，不重试） | `no_anchor` / `anchor_missing` / `revision_mismatch` / `manifest_projection_mismatch` / `fail_current_revision` | `false` | state-resolver.js / structure-gate.js / diff-compare.js 现有枚举 |
| **暂态**（保留重试） | `map_unavailable` / `resolver_error` / `fact_stale` / `fact_snapshot_stale` | `true` | state-resolver.js:271(resolver_error) 等现有枚举 |
| **缺失**（`reason_code` null/undefined） | — | `true`（保留 mapper_stale 语义） | PRD 边界情况① |
| **未知 code**（不在两集合内） | 原样透传 | `true`（保守：非确定性默认可重试，绝不假绿放行——仍返回 impact_unknown） | PRD 范围：只有确定性集合 → false |

判定逻辑锁死为**确定性白名单**：`retryable = !DETERMINISTIC.has(freshness.reason_code)`；未知 code 落入 `true` 分支但 gate 恒为 `impact_unknown`（不放行），符合 fail-closed 不变量。

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `diff-gate.test.js` 现有用例：`revision_mismatch` / `manifest_digest_mismatch` / `revision_evidence_missing` / Mapper 抛异常 → 均 `retryable:true`（本改动**只**触碰步骤 3a mapper_stale 分支，上述分支行为不得回退）
- [回归] `mapper_unavailable`（Mapper 抛异常，diff-gate.js:190-197）在步骤 3a **之前**，本改动不得波及
- [累积FR] 本 line（journey e6f803f2）暂无历史（context-manifest 查询返回空）
- [MAP_NOT_CONFIGURED] task.payload 无 map_scope/map_repo，未跑 Unified Map radius，无 must_run_assertions 注入

## Golden Path

[Gate 复算影响半径] → [判定 Mapper freshness 与 reason_code] → [终态裁决可观测]

### Step 1: harness 任务进入 Diff Impact Gate，Mapper 返回 stale + 确定性 reason_code
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（第 18 行）

**可观测行为**: `evaluateDiffGate` 载入 active contract 后调用 mapClient 复算，Mapper 返回 `freshness.status='stale'` 且携带 `reason_code='no_anchor'`（确定性终态）。

**验证命令**:
```bash
node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case deterministic
# 期望：exit 0，stdout 含 "OK: no_anchor 透传且 retryable=false"
```
**硬阈值**: exit 0；返回体 `gate=impact_unknown` 且 `reason_code=no_anchor`

---

### Step 2: Gate 透传 reason_code 并对确定性终态置 retryable:false
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（第 19 行）+ Invariant「不无限空转」（第 54 行）

**可观测行为**: 步骤 3a 不再一律折叠为 `mapper_stale + retryable:true`；`freshness.reason_code` 原样进返回体；确定性集合 5 个 code 全部 `retryable:false`；暂态集合 4 个 code 仍 `retryable:true`。

**验证命令**:
```bash
node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case deterministic_all
node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case transient
# 期望：两条均 exit 0
```
**硬阈值**: 确定性 5/5 `retryable=false` 且透传；暂态 4/4 `retryable=true` 且透传

---

### Step 3: 终态裁决可观测，orchestrator 据 retryable:false 终止空转
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（第 20 行）

**可观测行为**: 返回体形如 `{gate:'impact_unknown', reason_code:'no_anchor', retryable:false}`，真实原因可在返回体读到；`reason_code` 缺失时保留 `mapper_stale` 语义；Mapper 抛异常出口不变；所有不可判定分支 `gate` 恒为 `impact_unknown`（fail-closed，绝不放行）。

**验证命令**:
```bash
node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case null_reason
node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case mapper_unavailable
node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case fail_closed
# 期望：三条均 exit 0
```
**硬阈值**: 缺失 code → `mapper_stale + retryable:true`；抛异常 → `mapper_unavailable + retryable:true`；所有分支 `gate=impact_unknown`

---

## 禁 mock 边清单

本单改动落在 `evaluateDiffGate` 步骤 3a 的**纯决策分支**（读取已存在于 Mapper 响应 shape 的 `freshness.reason_code` 决定 `retryable`），不写 DB、不改状态机迁移、不改跨节点数据传递协议。

- **禁 mock 边**：`evaluateDiffGate` 内部「`freshness.reason_code` → `retryable`/`reason_code` 返回」决策路径——测试必须真实调用 `evaluateDiffGate`，**禁止** stub/spy 该函数或其分支、禁止 `vi.mock('../diff-gate.js')`。
- **允许注入（外层无关边界）**：
  - `mapClient`：Mapper 的 **HTTP 外边界**（POST /api/brain/map/radius），既有 DI 约定，真实 HTTP 客户端由 `map-client` 自身回归覆盖（见 diff-gate.test.js 头注释）；本单不改 map-client→gate 的响应 shape（`reason_code` 已在 map-client.js:116 JSDoc 声明），故注入其返回值不掩盖被改的边。
  - `db`：本改动路径（步骤 3a）在任何 DB 写入**之前** return，`db` 仅需 `query` 返回一个 active contract 让流程进入步骤 2/3a；无被改的 `代码↔DB 表` 边。

（本单非调度/状态机/跨模块协议/DB 写路径改动，被改的边是函数内纯决策，已由真实 `evaluateDiffGate` 执行覆盖。）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | Gate 步骤 3a 透传 `freshness.reason_code`；确定性终态置 `retryable:false` |
| **NFR（做得多好）** | | 超时/频控 PrepPRD 未指定（N/A）；可观测：终态裁决必带可读 `reason_code`，禁止抹成通用 `mapper_stale` |
| **Invariant（永不违反）** | | ①fail-closed：不可判定恒返回 impact_unknown 绝不放行；②不无限空转：确定性终态必 `retryable:false` |
| **判定点（怎么知道）** | | 见判定点登记表 |
| **保质期（何时过期）** | | 确定性/暂态集合随 state-resolver 枚举演进；集合定义与源枚举同源，源新增终态 code 需回本清单登记（N/A 本轮） |
| **死亡告警（停了谁知道）** | | 若透传逻辑退化，orchestrator 重回无限空转 → CI 回归测试（brain 套件 + 本 sprint 测试）红即知 |
| **失败语义（挂了怎么办）** | | 见失败语义声明 |
| **效果确认（已发≠已生效）** | | 返回体 `reason_code` + `retryable` 双字段由 node oracle 断言；确定性集合全量枚举验证 |

### 判定点登记表

> ⚠️ 标注：误判后果为「无限空转（算力空烧、调度不可信）」，属需关注的判定点，但归类依据是**代码已有确定性枚举**（非模糊现实推断），无需升拍板用户。

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 某 reason_code 是否为「确定性终态」 | A. 按确定性白名单集合判定; B. 按暂态黑名单反向判定 | A. 确定性白名单 `DETERMINISTIC.has(code)` | 白名单外一律保守 `retryable:true`（不放行、仍 impact_unknown），符合 fail-closed；黑名单法会把新增终态误判为可重试 | 误判确定性为暂态 → 无限空转（本 sprint 根因）；误判暂态为确定性 → 过早 fail-closed，暂态故障不自愈 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Mapper 返回确定性 reason_code | 返回 `retryable:false`（拦截，终止空转） | N/A（终态） | orchestrator 走 deny/block 收尾 |
| Mapper 返回暂态 reason_code | 返回 `retryable:true`（放行重试） | 是（Gate 无副作用，纯读判定） | orchestrator 重试 |
| Mapper 抛异常 | `mapper_unavailable + retryable:true`（不变） | 是 | orchestrator 重试 |
| `reason_code` 缺失/未知 | `retryable:true` 但 `gate=impact_unknown`（绝不放行） | 是 | 保守可重试，不假绿 |

### 输入对抗面

N/A — 本 sprint 是 kernel 内部决策函数，无对外暴露 agent 输入面；`reason_code` 来自内部 Mapper 服务（可信内网），非外部用户可写。

## 已知约束（来自回归测试）

见上方「已知约束（来自回归测试 + 累积 FR）」段。

## E2E 验收（final-e2e — target_environment=local_api，node oracle）

> **环境说明**：本 sprint 改的是 `evaluateDiffGate` 纯 kernel 决策函数，**无新增 HTTP 端点、runtime_resources.postgres=false**。因此 local_api final-e2e 退化为 node oracle：真实 import 并调用 `evaluateDiffGate`（决策逻辑不 mock），仅注入外层 Mapper 边界与最小 active contract（mock db，本改动路径不触 DB 写）。psql/curl 不适用（无端点、无库）——honestly 记录于此，非规避真验。
> **vitest 工作目录死规则（9.25.0）**：brain 永久回归测试位于 `packages/brain/src/**`，必须子 shell `(cd packages/brain && npx vitest run ...)` 执行；sprint 自身测试位于 `sprints/**`，可从仓库根跑（根 vitest include 覆盖 sprints/**）。

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/08180424-kernel-c0d4fe12"

# 1. node oracle：逐场景真实执行 evaluateDiffGate（Golden Path step 1-3 + 边界 + 不变量）
node "$SPRINT_DIR/verify/check-reason-code.mjs" --case deterministic
node "$SPRINT_DIR/verify/check-reason-code.mjs" --case deterministic_all
node "$SPRINT_DIR/verify/check-reason-code.mjs" --case transient
node "$SPRINT_DIR/verify/check-reason-code.mjs" --case null_reason
node "$SPRINT_DIR/verify/check-reason-code.mjs" --case mapper_unavailable
node "$SPRINT_DIR/verify/check-reason-code.mjs" --case fail_closed

# 2. sprint TDD 回归（从仓库根跑，根 vitest include 覆盖 sprints/**）
npx vitest run "$SPRINT_DIR/tests/diff-gate-reason-code.test.ts" --reporter=dot

# 3. brain 永久回归套件（子 shell 切进包根，用包自己的 vitest 配置——9.25.0 死规则）
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=dot )

echo "✅ Diff Impact Gate reason_code 透传 + fail-closed 出口验收通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本 sprint 为纯决策函数，风险面小）
高风险面:
- 错输入: `freshness.reason_code` 传入意外类型（数字/空字符串/对象）→ 应落入非确定性分支 `retryable:true` 且 `gate=impact_unknown`，不得抛未捕获异常
- 边界值: `reason_code=''`（空串）应等价于缺失/未知 → `retryable:true`；确定性集合大小写敏感（`No_Anchor` 应视为未知）
- 中途中断: 确定性判定不得依赖 db/mapClient 顺序假设——db 返回 contract 但 mapClient 后到 stale，仍须正确透传
- 重复提交: Gate 纯读判定无副作用，重复调用同 reason_code 结果幂等（`[接缝×2]` 重复执行两次应一致）
发现分级: P0/P1（确定性终态被误判为可重试 = 无限空转复现 / fail-closed 破防放行）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| reason_code 透传 + fail-closed | `sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-code.test.ts` | `确定性结论 no_anchor 透传 reason_code 且 retryable:false`；`确定性终态集合每个 code 均 retryable:false`；`暂态原因 map_unavailable 仍 retryable:true`；`reason_code 缺失时保留 mapper_stale 语义`；`Mapper 抛异常时维持 mapper_unavailable`；`fail-closed 不变量：所有不可判定分支 gate 恒为 impact_unknown` | 6 tests | 3 failed（确定性/确定性全量/暂态 未透传 red；缺失/抛异常/fail-closed 3 条为回归 guard 现绿） |

> Test Contract「BEHAVIOR 覆盖」列每个名均为对应 `test()` 名的字面子串（可 `grep -F` 命中）。
