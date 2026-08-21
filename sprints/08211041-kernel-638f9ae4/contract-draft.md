# Sprint Contract Draft (Round 1)

**锚定父路声明**: 独立小路（无父路）— 本 sprint 修复 harness 派发链上 Diff Impact Gate 步骤 3a 一处确定性结论被折叠成无限重试的裁决 bug，不隶属某条业务 Golden Path。

**Unified Map**: `[MAP_NOT_CONFIGURED]` — task.payload.map_scope=["F1"] 但 map_repo=null、expected_files=null，radius 无法计算；不回退领域硬编码，无 must_run_assertions 需并入。

**contract-gate**: 本仓存在 `packages/brain/src/lib/contract-gate.js`（cecelia worktree），走代码层 Contract Gate，本速查表惯用法已对齐。

**gp-anchor**: skipped (product-map.json not found)

## Response Schema（推导来源: PRD 字面 + 被测函数返回对象；非 HTTP 端点）

本 sprint 无 HTTP 端点新增/变更（纯 Brain 内部函数改动）。验收 oracle 是被测函数
`evaluateDiffGate(...)` 的**返回对象**（receipt），其 schema 由 diff-gate.js 现有出口字面定义：

### Function: `evaluateDiffGate({ db, taskId, repo, headRevision, changedFiles, mapClient, ... })` → `Promise<receipt>`

**步骤 3a 出口（本 sprint 改动的唯一出口）**:
```json
{"gate": "impact_unknown", "reason": "<string>", "retryable": <boolean>}
```
- `gate` (string, 必填): 恒为 `"impact_unknown"`（本 sprint **不改** gate，只改 reason/retryable）。来源——PRD Golden Path 第 3 步 + diff-gate.js 现有 3a 出口。
- `reason` (string, 必填): **透传** `mapperResult.freshness.reason_code`；缺失/null 时回退常量 `"mapper_stale"`（保底不假绿）。来源——PRD 步骤 2 + 边界情况第 1 条。
- `retryable` (boolean, 必填): `freshness.status === 'stale'` → `true`（可自愈滞后，保留重试）；其它（`'unknown'` 结构性确定结论 / freshness 缺失）→ `false`（fail-closed 终局）。来源——PRD 步骤 2 分流规则 + 边界情况。

**禁用值**: `reason` 严禁在 `status==='unknown'` 且存在真实 `reason_code` 时仍字面返回 `"mapper_stale"`（那正是本 sprint 要消除的伪装）。`retryable` 严禁对 `status==='unknown'` 返回 `true`（无限重试根因）。

**不变出口（本 sprint 不得改动）**: `db_unavailable`(retryable:true) / `contract_missing`(retryable:false) / `mapper_unavailable`(retryable:true) / `revision_evidence_missing` / `revision_mismatch` / `manifest_digest_mismatch` / `projection_digest_mismatch`（步骤 1/2/3b），以及 pass/extend/drift 裁决（步骤 4/5）。

---

## Golden Path

[Diff Impact Gate 调 Mapper 复算影响半径] → [按 `freshness.status` 分流 reason/retryable] → [终局 deny（unknown）或可重试 deny（stale）]

### Step 1: Gate 调 Mapper，Mapper 返回 `freshness.status !== 'fresh'`
**来源**: `[FROM_PRD]` — sprint-prd.md Golden Path 第 1 步（第 28-29 行）：Mapper 返回 `freshness: { status, reason_code }` 且 `status !== 'fresh'`。

**可观测行为**: `evaluateDiffGate` 进入步骤 3a 分支（`diff-gate.js:202`），不再进入 pass/extend/drift 裁决。

**验证命令**:
```bash
# 注入 status='unknown' 的 Mapper 结果，db=null 直达 3a；断言进入 impact_unknown 出口
npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js -t "非 fresh 分流恒保持 gate=impact_unknown"
# 期望：exit 0（gate 恒 impact_unknown）
```
**硬阈值**: `gate === 'impact_unknown'`；vitest exit 0。

---

### Step 2: 按 `freshness.status` 分流 —— 透传 reason_code + 决定 retryable
**来源**: `[FROM_PRD]` — sprint-prd.md Golden Path 第 2 步（第 30-33 行）：`status==='stale'→retryable:true`；`status==='unknown'→retryable:false`；`reason` 透传 `freshness.reason_code`。

**可观测行为**:
- `status==='unknown'`（结构性确定结论）→ receipt `{gate:'impact_unknown', reason:<真实 reason_code>, retryable:false}`；
- `status==='stale'`（事实快照滞后）→ receipt `{gate:'impact_unknown', reason:<真实 reason_code>, retryable:true}`。

**验证命令**:
```bash
# unknown 五种结构性 reason_code 均终局不可重试 + reason 透传
npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js -t "unknown 结构性确定结论产出终局 deny"
# stale 两种滞后 reason_code 均可重试 + reason 透传（不回退）
npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js -t "stale 事实快照滞后仍可重试"
# 期望：两条均 exit 0
```
**硬阈值**: unknown → `retryable===false && reason===reason_code`；stale → `retryable===true && reason===reason_code`。

---

### Step 3: 终局/可重试 deny —— dispatcher 依 `retryable` 停止或继续点火
**来源**: `[FROM_PRD]` — sprint-prd.md Golden Path 第 3 步（第 34-36 行）+ 边界情况第 1 条（第 42-43 行）：确定性结论 `retryable=false` → dispatcher 停止重新点火；`reason_code` 缺失回退 `mapper_stale` 但仍按 status fail-closed。

**可观测行为**: `reason_code` 缺失/null 时 reason 回退 `mapper_stale`，retryable 仍按 status（unknown→false、stale→true）；freshness 整体缺失时最不可判定 → reason=`mapper_stale`、retryable=false（不假绿）。dispatcher 消费端不改（PRD 范围外），仅依赖已透出的 `retryable` 字段。

**验证命令**:
```bash
# reason_code 缺失回退 mapper_stale，retryable 仍按 status；freshness 缺失 fail-closed
npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js -t "reason_code 缺失时回退 mapper_stale"
# 期望：exit 0
```
**硬阈值**: unknown 缺 code → `reason==='mapper_stale' && retryable===false`；stale 缺 code → `retryable===true`；无 freshness → `retryable===false`。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → `实际影响 ⊆ 声明影响时 pass`
- [同上] → `新增节点缺断言必须 drift（CONTRACT_IMPACT_DRIFT）`
- [同上] → `没有 active contract 时 fail-closed，且不调用 Mapper（contract_missing, retryable:false）`
- [同上] → `Mapper 抛异常 fail-closed → impact_unknown（mapper_unavailable, retryable:true）`
- [同上] → `revision_evidence_missing / revision_mismatch / manifest_digest_mismatch / projection_digest_mismatch 各自 impact_unknown 出口`
- 约束意义：本 sprint 只改步骤 3a 的 mapper_stale 常量出口，以上 20 个既有断言必须全绿（无回退）。

### 累积 FR（[累积FR] Step 1.3）
- context-manifest: unavailable（`/api/brain/line/e6f803f2.../context-manifest` 返回空；PRD 累积 FR 段自述「本 line 暂无历史」）。

## 已知回归约束（Unified Map must_run_assertions）
- `[MAP_NOT_CONFIGURED]`（map_repo=null，无 radius 结论）——无额外 must_run_assertions。

## 禁 mock 边清单

本单改动落在「裁决/状态判定」类（Diff Impact Gate 由 freshness.status 裁决 retryable/reason）：

- **代码 ↔ diff-gate 内部 freshness→receipt 映射逻辑**（本单改的就是这条边）：测试**不 mock 被测函数** `evaluateDiffGate`，真实执行其步骤 3a 分流逻辑；断言对象是它的真实返回 receipt。
- **diff-gate ↔ Mapper（`queryImpactRadius`/map-client.js）边**：这是**越界外部 HTTP 边界**，PRD 明确「Mapper 产 reason_code 逻辑不动」（范围外）；沿用本文件既有依赖注入惯例注入 `mapClient` 构造确定性 freshness——**允许 mock**（更外层无关依赖，非被改的边）。
- **diff-gate ↔ DB（tasks/harness_gaps 写路径）边**：本单改动的步骤 3a 在**任何 DB 写入前提前 return**，不触达 DB 写路径；测试用 `db=null` 直达 3a，故无 DB 写边被改，**无需真 Postgres**（runtime_resources.postgres=false 一致）。

## 真实调用方请求 shape

N/A — 本 sprint 不涉及设备/agent/webhook 等外部真实调用方；被测入口是 Brain 内部函数 `evaluateDiffGate`，调用方是 dispatcher/harness-gates（同进程内部调用，消费 `retryable` 字段，本次不改消费端）。

## 未覆盖真实链路清单

（本合同无第三方 API / force_* / stub 假数据；注入的 `mapClient` 是 PRD 明确范围外的 Mapper 边界，按既有单测惯例依赖注入，非真实链路 mock 豁免，N/A）

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 步骤 3a 由常量 `mapper_stale` 改为透传 `freshness.reason_code`，并按 `freshness.status` 决定 `retryable`（stale→true、unknown/缺失→false）。 |
| **NFR（做得多好）** | 非功能 | PRD NFR 段：超时/频控未指定（不引入退避）；deny receipt 必须落 `deny:impact:<真实 reason_code>` 便于运维区分 stale 与确定性结论。 |
| **Invariant（永不违反）** | 不变量 | [不假绿] Mapper 任何不可判定情形绝不返回 pass/extend/假绿，必须落 impact_unknown（gate 恒 impact_unknown；reason_code 缺失也 fail-closed 不假绿）。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 失效 | 无 token/数据保质期；分流规则以 `map/radius.js` 的 status 枚举为准，枚举变更时需同步（本次不改 Mapper）。 |
| **死亡告警（停了谁知道）** | 告警 | 若分流退化回无限重试，dispatcher 空转会在 run 层表现为同一 deny 反复点火；nightly-red 铁律负责≥3 晚同 job 红时贴原始日志（本 sprint 不涉及该告警实现）。 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明。核心：不可判定一律 fail-closed（deny），确定性结论 retryable=false 终止。 |
| **效果确认（已发≠已生效）** | 回执 | receipt `{gate,reason,retryable}` 即回执；vitest 断言 receipt 字段确认生效；dispatcher 消费 `retryable=false` 停止点火（消费端 PRD 假设，不在本次验证范围）。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ freshness 是「可自愈滞后」还是「结构性确定结论」 | A. 按 `status`（stale vs unknown）分流；B. 按 `reason_code` 前缀白名单分流 | A. 按 `status` 分流 | PRD 假设段：`status==='unknown'` 恒为结构性确定、`'stale'` 恒为可自愈（以 `map/radius.js` 枚举为准）；status 是 Mapper 的一级语义字段，比 reason_code 字符串匹配稳 | 若把 unknown 误判为可重试 → 回到无限重试空转根因；若把 stale 误判为终局 → 误杀可自愈重试（行为回退）。故此判定点为 ⚠️ 级 |
| reason_code 缺失/null 时的 reason 取值 | A. 回退常量 `mapper_stale`；B. 报错抛出 | A. 回退 `mapper_stale` | PRD 边界情况第 1 条：保底不假绿，retryable 仍按 status | 若缺失时误标 retryable=true（unknown）→ 空转；已由 `retryable=status==='stale'` 兜底为 false |

> ⚠️ 判定点「status 分流」属升拍板级，但 PrepPRD 假设段已显式拍定（第 62 行 ASSUMPTION 以 `map/radius.js` 枚举为准），本次不另请示。notes: judgment-pending-user 无（已在 PRD ASSUMPTION 拍过）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Mapper 返回 status='unknown'（结构性确定结论） | deny，retryable=false 终局 | 幂等（同输入恒同 deny） | 一次性终局 deny，dispatcher 停止点火 |
| Mapper 返回 status='stale'（事实快照滞后） | deny，retryable=true | 幂等；重跑 Map 可能自愈 | 保留重试（不引入退避，PRD 频控未约束） |
| freshness/reason_code 缺失 | deny，reason=mapper_stale，retryable 按 status（无 status→false） | 幂等 | fail-closed 保底，不假绿 |
| Mapper 不可达 / DB 不可达（范围外） | 保持既有 mapper_unavailable / db_unavailable，retryable=true | 幂等 | 本 sprint 不改 |

### 输入对抗面

N/A — 无对外暴露 agent；输入来源是同进程内 Mapper 返回对象（可信内部边界），无 prompt injection / 越权指令面。

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 纯 Brain 内部函数改动，无需 Postgres：`evaluateDiffGate` 步骤 3a 在任何 DB 写入前提前 return，
> 用依赖注入的 `mapClient`（越界外部 Mapper 边界，本 sprint 不改）与 `db=null` 直达 3a。
> vitest 工作目录死规则：`sprints/**` 走仓库根 vitest 配置（根 include 含 sprints/**），
> `packages/brain/src/**` 必须切进包根用其自身 vitest 配置（子 shell `cd packages/brain`）。

```bash
#!/bin/bash
set -euo pipefail

# Diff Impact Gate reason_code 透传 + fail-closed 终局 —— local_api 全链验收
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
SPRINT_TEST="sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js"

# 1. 新增 red 回归（sprints/** 走仓库根 vitest 配置）：
#    unknown 终局不可重试 / stale 可重试 / reason_code 透传与缺失回退 / gate 恒 impact_unknown
npx vitest run "$SPRINT_TEST" --reporter=dot

# 2. 全仓既有 diff-gate 单测无回退（packages/brain/src/** 切进包根用其自身 vitest 配置）
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=dot )

echo "OK: Diff Impact Gate reason_code 透传 + fail-closed 全链验收通过"
```

**通过标准**: 脚本 exit 0（sprint red 回归 4 条全绿 + 既有 20 条无回退）。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `mapClient` 返回 `freshness.status` 为意料外枚举值（如 `'degraded'` / 空字符串 / 数字）→ 应落入非 stale 分支 → retryable=false（fail-closed），不得当可重试。
- 错输入: `freshness.reason_code` 为非字符串（数字/对象）→ reason 应仍可透传或回退，不得抛异常使 Gate 崩溃改变出口语义。
- 重复提交: 同一 unknown 输入连续两次调用 `evaluateDiffGate` → 两次 receipt 完全一致（幂等，确认「重试也自愈不了」）。
- 中途中断: N/A（纯同步函数返回，无中途状态）。
- 边界值: `status==='fresh'` 但 `reason_code` 存在 → 必须仍走 fresh 正常裁决路径，不被 3a 改动误伤（回归面）。
发现分级: P0/P1（unknown 又变可重试 / gate 非 impact_unknown / 既有 20 测回退）→ 阻塞 merge；P2/P3（异常枚举日志噪音等）→ 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| unknown 终局 deny | `sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js` | `unknown 结构性确定结论产出终局 deny` | retryable 期望 false 实得 true → FAIL |
| stale 可重试 + reason 透传 | `sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js` | `stale 事实快照滞后仍可重试` | reason 期望真实 code 实得 mapper_stale → FAIL |
| reason_code 缺失回退 | `sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js` | `reason_code 缺失时回退 mapper_stale` | unknown 缺 code retryable 期望 false 实得 true → FAIL |
| gate 恒 impact_unknown（无回退不变量） | `sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js` | `非 fresh 分流恒保持 gate=impact_unknown` | 不变量（green-now 守卫，实现后仍绿）|
| 全仓既有 diff-gate 无回退 | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | 既有 20 断言（repo 既有测试，路径闸豁免）| green-now 守卫，实现后仍绿 |

> Red 证据（本轮实跑）：`npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js` → 3 failed | 1 passed（前 3 条新行为红，第 4 条 gate 不变量绿）。
