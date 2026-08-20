# Sprint Contract Draft (Round 1)

覆盖父路 e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29（journey_id）step aad25bdb（编码后复算影响半径 → 按确定性区分可重试性并透传真实 reason_code）。

contract-gate: cecelia worktree，packages/brain/src/lib/contract-gate.js 存在，代码层 Contract Gate 生效（未跳过）。
gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本改动是 `evaluateDiffGate()` 纯内部返回对象的字段语义调整（`reason` / `reason_code` / `retryable`），不新增/不修改任何 HTTP 端点。Reviewer 第 6 维按 skill 规则对纯内部改动自动满分基线，仍以下方 [BEHAVIOR] vitest oracle 逐字段核验返回对象。

被改的返回对象契约（step 3a 非 fresh 分支）：

```json
{ "gate": "impact_unknown", "reason": "<string>", "reason_code": "<string|null>", "retryable": true }
```

- `gate` (string, 必填): 恒为 `"impact_unknown"`（本分支永不放行为 pass/extend —— fail-closed 铁律，来源 PRD Invariant）。
- `reason_code` (string|null, 本次核心): 透传 `mapperResult.freshness.reason_code`；`status==='unknown'` 且缺失时落确定性占位 `"mapper_unknown"`；`status==='stale'` 且缺失时为 `null`。来源——PRD Golden Path step 2 + 边界情况。
- `retryable` (boolean, 本次核心): `status==='unknown'`→`false`（fail-closed 出口）；`status==='stale'`（或 freshness 缺失等其它非 fresh）→`true`。来源——PRD Golden Path step 3。
- `reason` (string, 观测/deny 字符串): 供 `loop.js:1454` 拼 `deny:impact:<reason>`；取 `reason_code`，为 null 时回退字面 `"mapper_stale"`（保证 deny 字符串永不为空/undefined）。
**禁用字段名**: 不得把确定性 `unknown` 结论标为 `retryable:true`；不得吞掉 `freshness.reason_code`（不得只返回旧的固定 `reason:'mapper_stale'` 而不带 `reason_code`）。
**Error path**: 本函数不抛错进入本分支；freshness 完全缺失（`!mapperResult?.freshness`）时按非 unknown 处理 → `retryable:true`、`reason_code:null`、`reason:'mapper_stale'`（保持既有行为，不削弱 fail-closed，gate 仍 `impact_unknown`）。

## 已知约束（来自回归测试）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「没有 active contract 时 fail-closed，且不调用 Mapper」（`retryable:false`）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「Mapper.radius() 超时时 Diff Gate 返回 blocked（不放行）」（异常路径 `retryable:true`，不在本次改动语义内，须保持）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「Mapper revision mismatch 时 Diff Gate 返回 blocked」（step 3b `reason:'revision_mismatch'`、`retryable:true`，本次不动）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「fact_revisions 缺少目标 repo 时返回 impact_unknown」（`reason:'revision_evidence_missing'`，本次不动）
- [累积FR] （本 line 暂无历史 — context-manifest 无累积 FR）

> 死规则：上列 3b 及之后分支（revision/manifest/projection digest mismatch、revision_evidence_missing）的 `reason`/`retryable` 语义**保持原样**，本次只改 step 3a 非 fresh 分支。全套 diff-gate.test.js 修复后必须继续全绿（回归保护）。

## Golden Path

[编码后复算影响半径] → [Mapper 返回非 fresh freshness] → [按确定性区分可重试性并透传真实 reason_code] → [下游 deny 携带确定性根因，确定性场景不再无限重试]

---

### Step 1: Diff Impact Gate 复算，Mapper 返回非 fresh freshness（`status`+`reason_code`）
**来源**: `[FROM_PRD]` — Golden Path 第 1 条 + 背景段（step 3a `freshness.status !== 'fresh'`）。

**可观测行为**: `evaluateDiffGate` 走到 step 3a 分支，`gate` 恒为 `impact_unknown`（不进入 pass/extend/drift，fail-closed 铁律不削弱）。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t 'step 3a: 非 fresh 分支 gate 恒为 impact_unknown')
# 期望：exit 0（该用例断言 unknown/stale 两态 gate==='impact_unknown'）
```

**硬阈值**: 该用例 exit 0；`gate==='impact_unknown'`。

---

### Step 2: 透传真实 `reason_code`（不再吞没、不再折叠成 `mapper_stale`）
**来源**: `[FROM_PRD]` — Golden Path 第 2 条 + NFR「可观测」。

**可观测行为**: 返回对象 `reason_code` 携带 Mapper 的 `freshness.reason_code`（如 `capability_not_in_active_projection` / `fact_snapshot_stale`），而非被吞没为固定 `mapper_stale`。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t 'step 3a: freshness.status unknown 透传 reason_code 且 retryable false')
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t 'step 3a: freshness.status stale 透传 reason_code 且 retryable true')
# 期望：两条 exit 0；reason_code 分别 === 'capability_not_in_active_projection' / 'fact_snapshot_stale'
```

**硬阈值**: 两用例 exit 0；`reason_code` 逐字等于注入的 `freshness.reason_code`。

---

### Step 3: 按 `status` 区分可重试性（`unknown`→false fail-closed；`stale`→true）
**来源**: `[FROM_PRD]` — Golden Path 第 3 条 + Invariant「重试身份/确定性优先」+ NFR「确定性/幂等」。

**可观测行为**: `status==='unknown'`（确定性结论）→ `retryable===false`（停止无限重试，任务落 blocked 而非空转）；`status==='stale'`（瞬态）→ `retryable===true`。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t 'step 3a: freshness.status unknown 透传 reason_code 且 retryable false')
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t 'step 3a: unknown 缺 reason_code 落确定性占位且 retryable false')
# 期望：exit 0；unknown 恒 retryable===false（含 reason_code 缺失的确定性占位边界）
```

**硬阈值**: unknown 两用例 exit 0；`retryable===false`；缺 reason_code 时 `reason_code` 为非空字符串占位（`mapper_unknown`），不回退成可重试。

---

### Step 4: 出口 —— 下游 deny 携带确定性根因，确定性场景不再重复入队
**来源**: `[FROM_PRD]` — Golden Path 第 4 条 + 背景（`loop.js:1454` `deny:impact:<reason>`）。

**可观测行为**: `reason` 字段随 `reason_code` 更精确（`loop.js` 拼出 `deny:impact:<真实原因>`）；`unknown` 场景 `retryable===false` 阻断重复入队。`loop.js` 本体不改（消费既有 `reason`/`retryable` 契约，仅内容更精确）。

**验证命令**:
```bash
# 源码断言：step 3a 分支不再无条件 retryable:true，且透传 freshness.reason_code（详见 ARTIFACT 条目）
grep -nE "freshness\.reason_code|reason_code" packages/brain/src/impact-contract/diff-gate.js | head
# 全套 diff-gate 回归绿（既有分支语义不回退）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js)
# 期望：全套 exit 0
```

**硬阈值**: diff-gate.test.js 全绿 exit 0；diff-gate.js step 3a 含 `freshness.reason_code` 透传。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | step 3a 非 fresh 分支透传 `freshness.reason_code` 到返回 `reason_code`，并按 `status`（unknown/stale）区分 `retryable`。 |
| **NFR（做得多好）** | 非功能 | 确定性/幂等：同一 diff × 同一投影的 unknown 结论恒 `retryable:false`；可观测：非 fresh 返回必带真实 `reason_code`。 |
| **Invariant（永不违反）** | 不变量 | fail-closed：本分支 `gate` 恒 `impact_unknown`，绝不因 Mapper 不可判定变 pass/extend（见下 INV 映射）。 |
| **判定点（怎么知道）** | 判断假设 | 见判定点登记表。 |
| **保质期（何时过期）** | 失效 | N/A —— 纯逻辑判据，无 token/数据保质期。 |
| **死亡告警（停了谁知道）** | 告警 | 确定性 unknown 现落 `retryable:false` → 任务进 blocked，可被现有 blocked 任务巡检/运维观测；`deny:impact:<真实原因>` 落根因。 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明。Mapper 不可判定 = fail-closed（拦截，不放行）。 |
| **效果确认（已发≠已生效）** | 回执 | 返回对象 `reason_code`/`retryable` 由 vitest 逐字段断言；下游 deny 字符串取自 `reason`。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ Mapper 非 fresh 结论是否为「确定性/不可重试」 | A. `freshness.status === 'unknown'` 即确定性; B. 按具体 reason_code 白名单 | A（`status === 'unknown'`） | PRD ASSUMPTION + `map/radius.js` 现有枚举：`unknown`=确定性结论、`stale`=唯一瞬态可重试态 | 误判确定性为瞬态 → 无限重试空转（本 bug）；误判瞬态为确定性 → 可恢复任务被过早 blocked |

> ⚠️ 行说明：该判定点误判后果严重（无限空转 / 过早 blocked）。已在 PRD `[ASSUMPTION]` 与「假设」段拍定 `status==='unknown'` 为确定性判据、`stale` 为唯一瞬态态；本合同据此实现。notes: judgment-pending-user 无（PRD 假设段已明确判据，无需再升拍板）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 | 是 | 客户端重试 |
| Mapper 返回 `status==='unknown'`（确定性不可判定） | `gate:impact_unknown`、`retryable:false`（fail-closed，任务落 blocked） | 否（确定性，重算同结论） | 不重试，落 blocked，`deny:impact:<真实原因>` 暴露根因 |
| Mapper 返回 `status==='stale'`（瞬态） | `gate:impact_unknown`、`retryable:true` | 是（重扫可转 fresh） | 允许重试 |
| freshness 完全缺失/畸形 | `gate:impact_unknown`、`retryable:true`、`reason_code:null`（保持既有行为，不放行） | 是 | 允许重试（本次不改此子情形） |

### 输入对抗面（对外暴露 agent 必填）

N/A —— 本改动为 Brain 内部影响门纯逻辑，无对外暴露 agent / 无外部可写入接口。`mapperResult` 来自内部 Mapper（`map/radius.js`，本次不动其 reason_code 生成）。

## 禁 mock 边清单

- 代码 ↔ `evaluateDiffGate` step 3a 分支逻辑（本单改此分支）：failing test 必须真调 `evaluateDiffGate`（真实 diff-gate.js 模块），**禁止** mock/stub `evaluateDiffGate` 本体或桩掉其 step 3a 分支。允许注入 mock `mapClient`——它是 Mapper HTTP 客户端的**外层无关边界**（`map/radius.js` reason_code 生成逻辑 PRD 明确不在范围内，且既有 `diff-gate.test.js` 第 7-9 行已固化「evaluateDiffGate 通过依赖注入 mock mapClient」的 DI 手法）。
- DB 边：本分支在 DB 访问之前返回（step 3a 早于 step 1/4/5 的 DB 读写），故 `db:null`，无 DB 写路径改动，无需真 Postgres（本 attempt `runtime_resources.postgres=false` 与此一致）。

> 本单是影响门**纯逻辑**分支改造（非调度/非状态机迁移本体/非跨模块数据接力/非生命周期钩子/非 DB 写路径），被改的唯一实质边是「diff-gate 读 freshness 字段并计算 retryable/reason_code」，该边由 failing test 以真实模块 + 真实分支执行覆盖，无 mock 顶替。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 attempt `runtime_resources.postgres=false` 且本改动在 DB 之前返回，故 E2E 为纯逻辑 vitest + 源码断言 + DevGate，无需 Postgres。
> vitest 工作目录死规则：`packages/brain/src/**` 测试用子 shell `(cd packages/brain && npx vitest run ...)`（用该包自己的 vitest 配置）；sprint 测试从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# 1. 永久回归：brain diff-gate 全套（含本 sprint 新增 step 3a 用例）全绿 —— 用包自己的 vitest 配置
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ) \
  || { echo "FAIL: brain diff-gate.test.js 未全绿"; exit 1; }

# 2. unknown → fail-closed（确定性、retryable false、reason_code 透传）单点复跑
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js \
    -t 'step 3a: freshness.status unknown 透传 reason_code 且 retryable false' ) \
  || { echo "FAIL: unknown 未 fail-closed"; exit 1; }

# 3. stale → retryable true（瞬态可重试）单点复跑
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js \
    -t 'step 3a: freshness.status stale 透传 reason_code 且 retryable true' ) \
  || { echo "FAIL: stale 未保持 retryable"; exit 1; }

# 4. 源码断言：step 3a 分支透传 freshness.reason_code（不再吞没）
grep -qE "freshness\.reason_code" packages/brain/src/impact-contract/diff-gate.js \
  || { echo "FAIL: diff-gate.js step 3a 未透传 freshness.reason_code"; exit 1; }

# 5. 源码断言：step 3a 分支不再无条件 retryable:true（含按 status 区分的 retryable 计算）
awk '/3a\. Mapper stale/{f=1} f&&/步骤 3b/{exit} f' packages/brain/src/impact-contract/diff-gate.js \
  | grep -qE "unknown|status" \
  || { echo "FAIL: step 3a 未按 freshness.status 区分可重试性"; exit 1; }

# 6. DevGate 三闸（Brain 改动强制；含 package.json 版本 bump 后的四处同步）
node scripts/facts-check.mjs || { echo "FAIL: facts-check"; exit 1; }
bash scripts/check-version-sync.sh || { echo "FAIL: check-version-sync"; exit 1; }
node packages/quality/scripts/devgate/check-dod-mapping.cjs || { echo "FAIL: check-dod-mapping"; exit 1; }

echo "✅ Diff Impact Gate reason_code 透传 + fail-closed 出口 验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本任务为纯逻辑分支，风险面小，用默认）
高风险面:
- 错输入: `mapClient` 返回 `freshness.status` 为未知第三态（如 `'partial'`/空串/数字）—— 断言不得静默当 fresh 放行，也不得崩溃；应落非 unknown → `retryable:true` 且 `gate:impact_unknown`。
- 错输入: `freshness` 为 `null` / 缺 `status` 字段 —— 走 `!mapperResult?.freshness` 既有分支，`retryable:true`、`reason_code:null`，gate 仍 `impact_unknown`（不放行）。
- 重复提交: 同一 diff × 同一投影的 unknown 连续两次调用 —— `retryable:false` 与 `reason_code` 必须稳定一致（确定性/幂等，无漂移）。
- 边界值: `reason_code` 为空串 `''`（区别于缺失/null）—— unknown 时是否落占位由实现决定，须与合同「缺失落 mapper_unknown」语义自洽，不得回退成 `retryable:true`。
- 中途中断: N/A（同步纯函数分支，无异步中断点）。
发现分级: P0/P1（unknown 被当瞬态重试 / gate 被放行为 pass）→ 阻塞 merge；P2/P3（reason_code 占位命名细节）→ 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| step 3a unknown fail-closed | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | `freshness.status unknown 透传 reason_code 且 retryable false` | 修复前 reason_code=undefined / retryable=true → FAIL |
| step 3a stale retryable | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | `freshness.status stale 透传 reason_code 且 retryable true` | 修复前 reason_code=undefined → FAIL |
| unknown 缺 reason_code 占位 | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | `unknown 缺 reason_code 落确定性占位且 retryable false` | 修复前 retryable=true → FAIL |
| gate 恒 impact_unknown | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | `非 fresh 分支 gate 恒为 impact_unknown` | 修复前后均绿（fail-closed 回归护栏，防退化） |

> TDD Red 证据另存 `sprints/08200805-kernel-0749688a/tests/diff-gate-reason-code.test.ts`（proposer 已跑：3 failed / 1 passed，见 task-plan.json 备注）。Generator 须把上表四条用例落入**永久 CI 家** `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`（Brain CI 常驻回归，硬规则 20）。「BEHAVIOR 覆盖」列每个名均为对应 `test()` 名的字面子串。
