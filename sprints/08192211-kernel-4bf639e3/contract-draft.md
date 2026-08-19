# Sprint Contract Draft (Round 1)

**journey_type**: autonomous
**target_environment**: local_api（纯 Brain 后端 Gate 判定逻辑；本 sprint 无 HTTP 端点、无 DB 写路径改动，验收 = vitest 真跑 diff-gate.js 真实判定逻辑）
**contract-gate**: applies (cecelia worktree, packages/brain/src/lib/contract-gate.js 存在，本合同过代码层 Contract Gate)
**gp-anchor**: skipped (product-map.json not found — cecelia 第三方于 GP-Anchor 闸)

## 锚定父路声明

独立小路（无父路）— PrepPRD `step_id: none`，本 sprint 为 kernel harness 基础设施加固，不锚定业务 Golden Path。

## Response Schema（推导来源: 代码 diff-gate.js 现有返回形 + PRD 边界情况；本任务无 HTTP 响应，Schema 指 `evaluateDiffGate(...)` 返回的 gateVerdict 对象）

### Function: `evaluateDiffGate({ db, taskId, mapClient, headRevision, changedFiles, repo })` — 步骤 3a（freshness 非 fresh）分支返回

修复后步骤 3a 返回对象（当 `mapperResult.freshness.status !== 'fresh'` 或 freshness 缺失时）：

```json
{"gate": "impact_unknown", "reason": "<string 具体 reason_code 或占位 unknown>", "reason_code": "<string|null 原始 reason_code>", "retryable": <boolean>}
```

- `gate` (string, 必填): 恒为 `"impact_unknown"`（来源——代码现有枚举，PRD 不改此值）
- `reason` (string, 必填): 透传 `freshness.reason_code`；缺失时占位 `"unknown"`。**绝不等于 `"mapper_stale"`**（来源——PRD 第 2/3 点 + 边界情况第 3 点）
- `reason_code` (string|null, 必填新增): 原始 `freshness.reason_code`，缺失为 `null`（来源——PRD NFR「透传的 reason_code 必须原样进 gateVerdict」；与成功路径已有的 `reason_code` 字段同名对齐 `[api_registry推导: diff-gate.js 步骤6 返回体已有 reason_code]`）
- `retryable` (boolean, 必填): `freshness.status === 'stale'` → `true`（瞬态可重试）；`'unknown'` / 缺字段 / 未知 status → `false`（fail-closed）（来源——PRD 第 2/3 点 + 边界情况第 1 点）

**禁用值（reason 字段在非 fresh 分支绝不允许出现）**: `mapper_stale`（旧折叠值，是本 bug 根因；仅允许出现在 `## 未覆盖真实链路清单` 之类说明文本或注释，禁止作为返回值）

**freshness 输入形（来源——`contract-schema.js` FreshnessEvidenceSchema + `map-client.js` 返回契约，已 GAN 校正 PRD ASSUMPTION）**:
```json
{"status": "fresh|stale|unknown", "reason_code": "<string 可选>", "checked_at": "<datetime 可选>", "mapper_revision": "<string 可选>"}
```
判定字段 = `freshness.status`（枚举 fresh/stale/unknown）与 `freshness.reason_code`。PRD ASSUMPTION（字段名 `freshness.reason` / `freshness.class`）已按真实代码契约校正为 `freshness.status` + `freshness.reason_code`。

## 已知约束（来自回归测试 + 累积 FR）

- [diff-gate.test.js] Mapper 抛异常 → fail-closed → `gate:'impact_unknown', retryable:true`（reason `mapper_unavailable`，**本 sprint 不改**，边界情况第 2 点）
- [diff-gate.test.js] revision mismatch → `gate:'impact_unknown', reason:'revision_mismatch', retryable:true`（步骤 3b，**本 sprint 不改**）
- [diff-gate.test.js] fresh + 影响 ⊆ 声明 → `gate:'pass'`（步骤 4/6，不受本改动影响）
- [harness-gates.test.js] `beforeMerge` 收到 diffGate `{gate:'impact_unknown', reason:'mapper_stale', retryable:true}`（**mock 直接注入 diffGate 返回值**）→ 折叠为 `{gate:'blocked', reason:'mapper_stale', retryable:true}`。该测试 mock 掉真实步骤 3a，本改动不触达，无需同步即保持绿（已实测 35/35 通过）。
- [累积FR] 本 line（journey e6f803f2）暂无历史已验收行为（PRD 载明 ability 均 planned）。context-manifest 端点未在本机验证 → 记 `context-manifest: not-fetched (fleet-worker 本地无对应 line context)`。

## 历史约束三源（EVA v2 — 铁律逐条映射）

| 铁律（INV） | 本 sprint 映射 |
|---|---|
| INV-1 [重试身份] Generator 基础设施失败重试原始服务端派发动作 | **本质相关**：本 sprint 正是修复「确定性 unknown 被误判为可重试 → 无限重派」的黑洞；见 DoD INV-1 断言（fail-closed 后 retryable=false，kernel 不再无限重派）|
| INV-2 [planner分支] | N/A：本 sprint 不碰 planner workspace/分支逻辑 |
| INV-3 [BrainURL权威] | N/A：本 sprint 不碰 dispatcher/fleet HARNESS_BRAIN_URL 注入 |
| INV-4 [验证时钟] | N/A：本 sprint 不建/改 validation clock |
| INV-5 [真验才done] | **相关**：本 sprint 无真机/真实调用方接缝，验收在真实 diff-gate.js 逻辑上跑 vitest（L2 服务端真验），非 mock 被改的边 |
| INV-6 [多租户测试] | N/A：diff-gate 步骤 3a 为纯判定，不碰租户数据（无 DB 读写触达） |
| INV-7 [租户隔离] | N/A：同上，非 fresh 分支在步骤 3a 提前返回，不进入 DB 写路径 |
| INV-8 [端点鉴权] | N/A：本 sprint 不新增/修改 API 端点（内部函数改动） |
| INV-9 [凭据安全] | N/A：无凭据引入 |
| INV-10 [日志脱敏] | N/A：reason_code 是系统枚举码，非 PII/聊天内容 |

## Golden Path

[kernel 派发 attempt 调 `evaluateDiffGate`] → [步骤 3a 区分瞬态 stale / 确定性 unknown] → [透传具体 reason_code + 正确 retryable] → [kernel 收 retryable:false 终止 Gate 无限重试]

### Step 1: kernel 调 `evaluateDiffGate({...})`，走到步骤 3a 校验 Mapper freshness

**来源**: `[FROM_PRD]` — Golden Path 第 1 步（PRD 第 24 行）。

**可观测行为**: Mapper 返回 `freshness.status !== 'fresh'` 时，Gate 进入步骤 3a 分支（不再统一折叠 mapper_stale）。

**验证命令**:
```bash
# 瞬态 stale 输入 → 命中步骤 3a 瞬态分支（见 Step 2 完整断言）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1 | grep -qE "Tests[[:space:]]+[0-9]+ passed")
```
**硬阈值**: 步骤 3a 分支被执行，返回对象含 `reason_code` 字段（新增）。
**验证命令**: 见 Step 2/3 的 vitest 断言（`result.reason_code` 存在且为 string|null）。

---

### Step 2: Mapper 返回瞬态陈旧（freshness.status==='stale' 且带瞬态 reason_code）→ retryable:true + 透传具体 reason_code

**来源**: `[FROM_PRD]` — Golden Path 第 2 步（PRD 第 25-26 行）。

**可观测行为**: `evaluateDiffGate` 返回 `gate:'impact_unknown', retryable:true, reason:<具体码 如 fact_snapshot_stale>`，`reason` **不等于** `'mapper_stale'`。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache sprints/../../sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js) # 见下方 E2E 段权威命令
```
**硬阈值**: `retryable === true` 且 `reason === 'fact_snapshot_stale'`（透传）且 `reason !== 'mapper_stale'`。
**验证命令**: E2E 段 B-01 vitest 断言（`expect(result.reason).toBe('fact_snapshot_stale')` + `.not.toBe('mapper_stale')`）。

---

### Step 3: Mapper 返回确定性 unknown（freshness.status==='unknown' 或缺字段）→ retryable:false（fail-closed）+ 透传具体 reason_code

**来源**: `[FROM_PRD]` — Golden Path 第 3 步（PRD 第 27-28 行）+ 边界情况第 1 点（PRD 第 35-36 行）。

**可观测行为**: `evaluateDiffGate` 返回 `gate:'impact_unknown', retryable:false, reason:<具体码 如 impact_unknown>`；freshness 缺 reason_code / 未知 status 时 `reason='unknown'` 占位，**绝不回退 `mapper_stale`**。

**验证命令**:
```bash
# 见 E2E 段 B-02/B-03 vitest 断言
```
**硬阈值**: `retryable === false`（fail-closed）且 `reason === 'impact_unknown'`（透传）；缺字段场景 `reason === 'unknown'` 且 `reason !== 'mapper_stale'`。
**验证命令**: E2E 段 B-02（`expect(retryable).toBe(false); expect(reason).toBe('impact_unknown')`）+ B-03（缺字段 → `retryable:false, reason:'unknown', not 'mapper_stale'`）。

---

### Step 4: 出口 — kernel 收 retryable:false 终止该 attempt 的 Gate 重试，不再无限循环

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入的「无残留」出口断言。理由：仅断言单次返回不足以证明「无限重试黑洞」被堵死；需矩阵断言所有非 fresh 分支 reason 永不为 `mapper_stale`（旧折叠值），否则任一漏网分支仍会被 kernel 当瞬态无限重派（对齐 INV-1 重试身份 + fail-closed 精神）。

**可观测行为**: 遍历瞬态/确定性/缺字段多种 freshness，`evaluateDiffGate` 返回的 `reason` 均不等于 `'mapper_stale'`；确定性一类 `retryable` 恒为 `false`。

**验证命令**:
```bash
# 见 E2E 段 B-04 矩阵断言
```
**硬阈值**: 4 组 freshness 输入下 `reason !== 'mapper_stale'` 全成立；`retryable` 类型恒为 boolean。
**验证命令**: E2E 段 B-04 循环矩阵 vitest 断言。

---

## 禁 mock 边清单

本 sprint 改动落在 `diff-gate.js` 步骤 3a —— 对 Mapper `freshness` 输入的**判定逻辑**（同一函数内返回值精化），产出 `retryable` 标志经 kernel 消费（跨模块，但 kernel 重试调度显式在 PRD 范围外，本 sprint 不改）。判定属「跨模块数据传递」的解释侧，故列禁 mock 边：

- **`evaluateDiffGate` 判定逻辑 ↔ `mapperResult.freshness` 输入**：测试必须**真调 `evaluateDiffGate`**（不 mock 本函数、不 mock `diff-compare.js` / `contract-schema.js`），仅允许注入 `mapClient` 提供 freshness 输入——`mapClient` 是 Mapper 的外层 HTTP 边界，是本仓库既有标准测试接缝（`diff-gate.test.js` 注释明确「evaluateDiffGate（需 DB + mapClient）→ 注入 mock mapClient」），非本单被改的边。
- **`diff-gate.js` ↔ DB 写路径（gap_events / tasks）**：本 sprint **未改** DB 写路径；非 fresh 分支在步骤 3a 提前返回，不触达步骤 5 的 `recordDriftAndBlockTask`。故测试用 `db: null` 走无 DB 路径合法（无需真 Postgres）。若 generator 误改到 DB 写路径 → 越界，需真 Postgres 集成测试覆盖，本合同不授权此扩张。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 步骤 3a 区分瞬态 stale（retryable:true）与确定性 unknown（retryable:false, fail-closed），两类都透传 `freshness.reason_code` 进 gateVerdict `reason`/`reason_code`，消除 `mapper_stale` 无限重试黑洞 |
| **NFR（做得多好）** | | 纯同步判定，无新增 IO/延迟；无频控/版本要求（PRD NFR 段） |
| **Invariant（永不违反）** | | 非 fresh 分支返回值 `reason` 绝不等于 `mapper_stale`；确定性 unknown 恒 `retryable:false`（fail-closed，不假绿放行、不无限重试）|
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | 判定依据 = freshness 枚举语义，随 map/radius 合同版本演进；本 sprint 判定表与 contract-schema.js FreshnessEvidenceSchema 绑定，schema 改枚举则需同步 |
| **死亡告警（停了谁知道）** | | 回归测试 `diff-gate-reason-passthrough.test.js` 入 CI（sprints/** 与 brain-unit include）；若步骤 3a 回退 mapper_stale → CI 红，kernel 侧亦会因 attempt 无限重试触发既有 harness 观测 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | gateVerdict 返回对象即同步效果；vitest 直接断言返回 `reason`/`retryable`，无异步回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ Mapper 结论是「瞬态陈旧」还是「确定性 unknown」 | A. 看 `freshness.status`（stale=瞬态 / unknown=确定性）; B. 看 `freshness.reason_code` 语义白名单; C. 一律 fail-closed | A. `freshness.status` 分流 + 缺字段/未知 status 归 fail-closed（保守）| map-client 返回契约与 contract-schema.js FreshnessEvidenceSchema 均以 `status` 枚举为权威判定字段（已 GAN 读代码校正 PRD ASSUMPTION）；`reason_code` 仅作透传不作判定，避免耦合易变白名单 | 误判「确定性」为「瞬态」→ 无限重试黑洞（本 bug）；误判「瞬态」为「确定性」→ 过早 fail-closed 阻断合法重试。缺字段时选保守 fail-closed（宁可停不空转，PRD 边界情况第 1 点）|

> ⚠️ 该判定点误判后果严重（无限重试黑洞 / 过早阻断），属「升拍板点」级别。PrepPRD ASSUMPTION 已就「freshness 携带可区分字段」拍过方向，本合同将字段名从假设的 `freshness.reason/class` 校正为真实的 `freshness.status`+`freshness.reason_code`（读 map-client.js/contract-schema.js 得证），属实现细节校正、未改变 PrepPRD 决策方向，无需再升用户。notes: `judgment-resolved-by-code: freshness.status`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| freshness.status === 'stale'（瞬态） | 返回 impact_unknown + retryable:true | 是（纯判定，同输入同输出） | kernel 按瞬态重试原动作（INV-1 重试身份，PRD 范围外调度不改）|
| freshness.status === 'unknown' / 缺字段 / 未知 status（确定性）| 返回 impact_unknown + retryable:false（fail-closed）| 是（纯判定幂等）| kernel 终止 Gate 重试，走 fail-closed 出口，绝不无限循环、绝不假绿放行 |
| Mapper 抛异常（不可达）| 返回 impact_unknown + reason mapper_unavailable + retryable:true | 是 | **本 sprint 不改**（边界情况第 2 点，维持既有行为）|

### 输入对抗面

N/A — 本 sprint 为内部 Gate 判定函数，不直接暴露给外部 agent/用户输入；`freshness` 来自受信内部 Mapper 服务端契约（map-client.js 已做 assertMapperContract 校验）。

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯判定逻辑无 DB/HTTP，验收 = vitest 真跑真实 diff-gate.js）

> 本 sprint 无 HTTP 端点、无 DB 写路径改动（非 fresh 分支步骤 3a 提前返回），故 local_api 模板的 migration/signup/curl 均 N/A。验收 oracle = 在真实 `diff-gate.js` 判定逻辑上跑 vitest（L2 服务端真验，非 mock 被改的边，仅注入 mapClient 外层边界）。
> vitest 工作目录死规则：`packages/brain/src/**` 测试用 `(cd packages/brain && npx vitest run ...)`；`sprints/**` 回归测试从仓库根 `npx vitest run`。

```bash
#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
SPRINT_TEST="sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js"

# 1. 修复后回归测试全绿：瞬态透传(B-01) / 确定性 fail-closed(B-02) / 边界占位(B-03) / 禁 mapper_stale 残留(B-04)
OUT_SPRINT=$(npx vitest run --no-cache "$SPRINT_TEST" 2>&1)
echo "$OUT_SPRINT" | grep -qE "Tests[[:space:]]+[0-9]+ passed" || { echo "FAIL: sprint 回归未全绿"; echo "$OUT_SPRINT" | tail -30; exit 1; }
echo "$OUT_SPRINT" | grep -qE "[1-9][0-9]* failed" && { echo "FAIL: sprint 回归有失败用例"; echo "$OUT_SPRINT" | tail -30; exit 1; }
for TAG in "B-01" "B-02" "B-03" "B-04"; do
  echo "$OUT_SPRINT" | grep -q "\[$TAG\]" || { echo "FAIL: 缺 $TAG 场景用例"; exit 1; }
done
echo "OK: sprint 回归 B-01..B-04 全绿"

# 2. 既有 brain 单测无回退（diff-gate.test.js + harness-gates.test.js，mapper_stale 既有断言保持绿）
cd packages/brain
OUT_BRAIN=$(npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/harness-gates.test.js 2>&1)
echo "$OUT_BRAIN" | grep -qE "Tests[[:space:]]+[0-9]+ passed" || { echo "FAIL: brain 既有单测未全绿"; echo "$OUT_BRAIN" | tail -30; exit 1; }
echo "$OUT_BRAIN" | grep -qE "[1-9][0-9]* failed" && { echo "FAIL: brain 既有单测有失败"; echo "$OUT_BRAIN" | tail -30; exit 1; }
cd "$REPO_ROOT"
echo "OK: brain 既有单测无回退"

echo "✅ Diff Impact Gate reason_code 透传 + fail-closed 验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯判定函数风险面窄）
高风险面:
- 错输入: `freshness.reason_code` 为非 string（如数字/对象/空串）→ 应归 null 占位 unknown，不得崩溃、不得回退 mapper_stale
- 边界值: `freshness.status` 为 fresh 以外的未预期枚举（如 'error'、''、大小写变体）→ 应走 fail-closed（retryable:false），不得误判瞬态
- 中途中断: `mapperResult.freshness` 为 null vs undefined vs `{}` 三态 → 均应 fail-closed 占位 unknown
- 残留检查: 全仓 grep `reason: 'mapper_stale'` 应只剩注释/说明，无返回值路径残留（步骤 3a 之外的 3b 各分支仍各带具体码，不受影响）
发现分级: P0/P1（确定性一类仍返回 retryable:true 无限重试 / reason 回退 mapper_stale）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 瞬态 stale 透传 reason_code | `sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js` | `瞬态 stale：透传具体 reason_code 且 retryable:true` | → 4 failed（当前 mapper_stale 折叠，已实测红）|
| 确定性 unknown fail-closed | 同上 | `确定性 unknown：fail-closed retryable:false 且透传具体 reason_code` | → 同上 |
| 边界占位 unknown | 同上 | `边界：缺 reason_code / 未知 status → fail-closed 占位 unknown 不回退 mapper_stale` | → 同上 |
| 禁 mapper_stale 残留 | 同上 | `禁 mapper_stale 残留：所有非 fresh 分支 reason 绝不等于 mapper_stale` | → 同上 |
