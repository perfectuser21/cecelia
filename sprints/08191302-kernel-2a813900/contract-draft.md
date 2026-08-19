# Sprint Contract Draft (Round 1)

Sprint: `08191302-kernel-2a813900` — Diff Impact Gate 步骤 3a `mapper_stale` 无限重试根因：透传 reason_code + fail-closed 出口

**锚定父路声明**: 独立小路（无父路） — 本 sprint 修 `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a 的确定性结论折叠 bug，无既有 Golden Path 父路。

**map scope**: `[MAP_NOT_CONFIGURED]` — task.payload `map_scope=["F1"]` 但 `map_repo=null`、`expected_files=null`，无法计算影响半径（Step 1.0 要求 scope+repo 同时非空）；不回退领域硬编码，`must_run_assertions` 空。

**contract-gate**: `packages/brain/src/lib/contract-gate.js` 存在（cecelia worktree）→ 走代码层 Contract Gate，本合同断言按速查表写成 gate-clean 形态。

**gp-anchor**: skipped (product-map.json not found) — 当前仓库根无 `product-map/generated/product-map.json`（cecelia 非 zenithjoy），GP-Anchor 段整体跳过，不阻塞。

---

## Response Schema（推导来源: PRD 字面 + 现有 `evaluateDiffGate` 返回契约；registry 不可达 → 无 HTTP 端点，按函数返回对象 codify）

本任务**无 HTTP 响应**（内部 gate 函数 `evaluateDiffGate` 返回对象，非 REST 端点）。验收 oracle = 函数返回对象字段断言（vitest `expect`，非 jq）。步骤 3a `impact_unknown` 分支返回契约（本 sprint 唯一改动面）：

### Function: `evaluateDiffGate(...) → Promise<object>`（步骤 3a 分支，Mapper 非 fresh 时）

**确定性结论（存在非空 reason_code）**:
```json
{"gate": "impact_unknown", "reason": "<Mapper 原始 reason_code 字面>", "reason_code": "<同 reason>", "retryable": false}
```
- `gate` (string, 必填): 固定 `"impact_unknown"` — 来源: PRD line 22-29 + 现有代码 step 3a 语义不变（仍归 impact_unknown 类，只改 reason/retryable）。
- `reason` (string, 必填): **透传** Mapper 原始 reason_code（如 `projection_revision_mismatch` / `map_unavailable` / provider/deny 类）— 来源: PRD line 28「Gate 出口 reason = Mapper 原始 reason_code」。
- `reason_code` (string, 必填): 回填与 `reason` 同值，作为透传证据 — 来源: PRD line 16-17「自带 reason_code」，AI_ADDED 便于下游区分透传值。
- `retryable` (boolean=false, 必填): 确定性结论 ⇒ fail-closed 终态 — 来源: PRD line 29 + NFR line 61。

**真·瞬时 stale（无确定性 reason_code）**:
```json
{"gate": "impact_unknown", "reason": "mapper_stale", "retryable": true}
```
- `reason` (string=`"mapper_stale"`): 保留瞬时语义 — 来源: PRD line 30-31 对照。
- `retryable` (boolean=true): 保留重试 — 来源: PRD line 31。

**确定性判据（reason_code 取值精确定义 — 判定点，见八要素登记表）**:
```
reason_code = mapperResult.reason_code ?? mapperResult.freshness?.reason_code ?? null
确定性 ⇔ typeof reason_code === 'string' && reason_code.trim().length > 0
```
- 顶层 `reason_code` 优先于 `freshness.reason_code`（PRD assumption line 49「顶层或 freshness 内」）。
- **禁用字段名/写法**（不得引入新键或改现有键）: 不得新增 `stale_reason` / `deny_code` / `error_code` 等同义替换键；`reason` 键名字面固定，不得改成 `message`/`detail`。

**Error/边界（本 sprint 不动的既有分支，语义不变）**: `db_unavailable` / `contract_missing` / `mapper_unavailable` / `revision_evidence_missing` / `revision_mismatch` / `manifest_digest_mismatch` / `projection_digest_mismatch`（PRD line 39「其它 impact_unknown 分支语义不变」）。

---

## 已知约束

### 回归测试约束（来源: Step 1.2 — `packages/brain/src/impact-contract/__tests__/`）
- [diff-gate.test.js] → 「没有 active contract 时 fail-closed，且不调用 Mapper」（`impact_unknown`/`contract_missing`/`retryable:false`）
- [diff-gate.test.js] → 「Mapper.radius() 超时时 Diff Gate 返回 blocked（不放行）」（异常 → `impact_unknown`/`retryable:true`）
- [diff-gate.test.js] → 「fact_revisions 缺少目标 repo 时返回 impact_unknown」（`revision_evidence_missing`）
- [diff-gate.test.js] → 「Mapper revision mismatch 时 Diff Gate 返回 blocked」（`revision_mismatch`）
- [map-client.test.js] → 「接受显式 stale 的旧 revision 证据，让 Gate 返回 mapper_stale 而非误报不可达」（`freshness:{status:'stale',reason_code:'projection_revision_mismatch'}` — map-client 层容忍 stale，不 throw）
- [harness-gates.test.js] → 「merge 前重新查询 Mapper freshness，stale 时即使旧 Diff receipt 存在也阻断」（beforeMerge 透传 diffGate 的 reason+retryable）
- [structure-gate.test.js] → 「Mapper stale 响应包含 reason=mapper_stale」（**structure-gate**，本 sprint 不动，仅登记以防误改邻居）

> **兼容性注记（AI_ADDED，防回退）**: 上述 diff-gate.test.js 既有 20 条测试全部使用 `freshness:{status:'fresh'}` 或 Mapper 抛异常路径，无一条通过 `evaluateDiffGate` 构造「stale + reason_code」流入步骤 3a，故本 sprint 改动**不破坏任何既有 diff-gate 断言**（已实测 baseline 20/20 green）。harness-gates 的 merge 测试 mock 掉整个 diffGate，不流经步骤 3a，透传后返回 `{gate:'blocked', reason:<透传值>, retryable:<透传值>}` 语义正确。

### 累积 FR（来源: Step 1.3 context-manifest / journey golden-paths）
- context-manifest: unavailable（端点返回空）；journey e6f803f2 golden-paths 空 → 本 line 暂无历史累积 FR，无回退风险。

### Unified Map must_run_assertions
- `[MAP_NOT_CONFIGURED]`（map_repo 缺失）→ 无额外必跑断言。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | Diff Impact Gate 步骤 3a：Mapper 返回非 fresh 且携带非空确定性 reason_code 时，`reason` 透传该 reason_code、`reason_code` 回填、`retryable=false`；仅无 reason_code 的真·瞬时 stale 保留 `mapper_stale`+`retryable=true`。 |
| **NFR（做得多好）** | | 确定性 deny 不得无限重试（retryable=false 终态）；改动为纯同步分支判定，无新增 I/O，无性能影响；PrepPRD 未指定超时/延迟阈值（待定）。 |
| **Invariant（永不违反）** | | [fail-closed] 任何不可判定情形（无 freshness 且无 reason_code）仍返回 `impact_unknown`，绝不假绿为 pass/extend/drift。既有其它 impact_unknown 分支语义不变。 |
| **判定点（怎么知道）** | | 见下方登记表（Mapper 结论确定性判定）。 |
| **保质期（何时过期）** | | 判定逻辑随 Mapper `/map/radius` 返回契约（`freshness.reason_code`）演进；若 Mapper 契约变更 reason_code 语义，需同步复核本判据。无 token/凭据。 |
| **死亡告警（停了谁知道）** | | 若本 fix 回退，`deny:impact:mapper_stale` 会再次无限重试空转 → kernel harness run 卡死（runs f62c7e87/d1360a48 即症状）；回归测试红即告警。 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明。确定性 deny → 拦截（终态 retryable=false）；瞬时 stale/不可判定 → 保守重试（retryable=true）。 |
| **效果确认（已发≠已生效）** | | 回归测试断言 `reason`/`reason_code`/`retryable` 三字段实际取值；beforeMerge 透传后 attempt 得终态裁决（非无限重试）即生效证据。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ Mapper 返回的 stale 结论是否「确定性」（可 fail-closed 终态）vs「真·瞬时（应重试）」 | A. 存在非空 `reason_code`（顶层或 freshness 内）即确定性; B. 维护瞬时 reason_code 白名单（如 `ttl_exceeded` 归瞬时），仅白名单外 reason_code 才算确定性 | **A. 非空 reason_code 即确定性** | PRD line 30-31 对照明确定义「真·瞬时 stale = 无确定性 reason_code」；assumption line 50「精确判据由 Proposer codify」；方法 B 需要枚举全部 reason_code 取值（registry 不可达无法穷举），过度设计违反精简纪律 | 误把瞬时当确定 → 过早终态 deny，漏放本该重试的 attempt；误把确定当瞬时 → 无限重试空转（本 bug 根因）。均属直接影响 harness 裁决的严重误判 |

> ⚠️ 该判定点属「升拍板点」级别（误判后果严重）：PRD assumption line 50 明示精确判据留给 Proposer codify，未经 PrepPRD 拍板。见 notes `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 | 是（幂等键 task_id） | 客户端重试 |
| Mapper 返回确定性 reason_code（非 fresh） | 透传 reason，`retryable=false` 终态拦截 | N/A（终态不重试） | attempt 得终态裁决，交上层按 reason 处理 |
| Mapper 真·瞬时 stale（无 reason_code） | `reason='mapper_stale'`，`retryable=true` | 是（同 attempt 重查 Mapper 幂等） | 保守重试待事实投影刷新 |
| Mapper 结果既无 freshness 也无 reason_code | fail-closed，`reason='mapper_stale'`，`retryable=true`，绝不假绿 | 是 | 保守重试（不可判定不放行） |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A | | | |

> 本任务为内部 harness gate 决策逻辑，无对外暴露 agent / 用户可写入接口，`reason_code` 来自内部 Universal Mapper 服务返回（受内部 token 保护），非外部不可信输入。输入对抗面 N/A。

---

## 禁 mock 边清单

- （本单为 diff-gate 步骤 3a 的**纯决策分支**改动：`return` 前不写 DB、不做跨模块数据接力、不触发生命周期钩子/状态机迁移。改动只读 `mapperResult` 内存对象并返回判定结果。）
- `diff-gate ↔ Universal Mapper（mapClient / queryImpactRadius）`：mapClient 是**外层 HTTP 边界**（POST `/map/radius`），非本单被改的边——本单不改 mapper 调用契约，只改对其返回结果的解释。全 `diff-gate.test.js`（既有 20 条）均以依赖注入构造 mapClient 返回，属「更外层无关依赖」允许 mock 范畴；本合同回归测试沿用同一惯例。
- `diff-gate ↔ DB（active contract 读取）`：步骤 1 读 contract 用 mock db 存根即可（步骤 3a 在 DB 写路径之前 return，不触及 gap_events/tasks 写入）。本单不改任何 DB 写路径，故无「真 Postgres 验行落库」要求。

> 结论：本单无「调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径」被改的接缝边，禁 mock 边清单实质为空（纯决策分支）；上列两条为说明性登记，非禁 mock 项。

---

## Golden Path

[Diff Impact Gate 复算影响半径] → [Mapper 返回非 fresh + 确定性 reason_code] → [步骤 3a 透传 reason_code + retryable=false fail-closed 退出，不再空转]

### Step 1: harness attempt 进入 Diff Impact Gate，`evaluateDiffGate` 调用 Mapper 复算影响半径
**来源**: `[FROM_PRD]` — PRD line 25「触发条件」。

**可观测行为**: `evaluateDiffGate` 读取 active contract（步骤 1）后调用 mapClient（步骤 2），拿到 Mapper 复算结果对象。

**验证命令**:
```bash
(cd packages/brain && ../../node_modules/.bin/vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1 | grep -qE 'Tests[[:space:]]+.*passed')
# 期望：既有 diff-gate 契约（含步骤 1/2 调用路径）全绿
```
**硬阈值**: diff-gate.test.js 全部通过，0 failed。
**验证命令**: `(cd packages/brain && ../../node_modules/.bin/vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1 | grep -q '0 failed\|Tests .* passed') || { echo FAIL; exit 1; }`

---

### Step 2: Mapper 返回非 fresh，但携带确定性 reason_code
**来源**: `[FROM_PRD]` — PRD line 26-27「系统处理」。

**可观测行为**: mapClient 返回 `{ freshness:{ status:'stale'|'unknown', reason_code:<非空> } }`（或顶层 `reason_code`），进入步骤 3a 分支。

**验证命令**:
```bash
node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts -t '确定性 reason_code 透传' --no-cache 2>&1 | grep -qE '1 passed|Tests .* passed'
# 期望：确定性透传用例通过（RED→GREEN）
```
**硬阈值**: 该用例 1 passed，0 failed。
**验证命令**: `node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts -t '确定性 reason_code 透传' --no-cache 2>&1 | grep -q '0 failed' || { echo FAIL; exit 1; }`

---

### Step 3: 步骤 3a 透传 reason_code 且 retryable=false（fail-closed 终态），attempt 得终态裁决而非无限重试
**来源**: `[FROM_PRD]` — PRD line 28-29「可观测结果」。

**可观测行为**: `evaluateDiffGate` 返回 `{ gate:'impact_unknown', reason:<Mapper reason_code 字面>, reason_code:<同 reason>, retryable:false }`。`reason` 不再是通用 `mapper_stale`。

**验证命令**:
```bash
node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts --no-cache 2>&1 | grep -qE 'Tests[[:space:]]+5 passed|0 failed'
# 期望：5 条 sprint 契约用例全绿（含透传 + retryable=false + 顶层 reason_code 边界）
```
**硬阈值**: 5 passed，0 failed。
**验证命令**: `node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts --no-cache 2>&1 | grep -q '0 failed' || { echo FAIL; exit 1; }`

---

### Step 4: 对照——真·瞬时 stale（无 reason_code）仍保留 mapper_stale + retryable=true
**来源**: `[FROM_PRD]` — PRD line 30-31「对照」。

**可观测行为**: mapClient 返回 `{ freshness:{ status:'stale', reason_code:null } }` → `evaluateDiffGate` 返回 `{ reason:'mapper_stale', retryable:true }`（重试语义保留，不回退）。

**验证命令**:
```bash
node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts -t '真·瞬时 stale' --no-cache 2>&1 | grep -qE '1 passed|0 failed'
# 期望：瞬时 stale 保留用例通过（防重试语义回退）
```
**硬阈值**: 该用例通过，0 failed。
**验证命令**: `node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts -t '真·瞬时 stale' --no-cache 2>&1 | grep -q '0 failed' || { echo FAIL; exit 1; }`

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 改动为内部 harness gate 决策逻辑，无自有 HTTP 端点；DB 在单元层以 mock 存根注入（步骤 3a 在 DB 写路径前 return，实测无需真 Postgres，与 runtime_resources.postgres=false 一致）。E2E = 从正确工作目录跑回归全绿：sprint 契约测试从仓库根跑（root vitest include 覆盖 sprints/**），package 永久回归从 packages/brain 子 shell 跑（9.25 死规则：packages/<pkg>/src/** 的 vitest 必须子 shell 切进包根，否则命中根 include「No test files found」）。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. sprint 契约测试（RED→GREEN）— 从仓库根跑（sprints/** 在 root vitest include 内）
node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts --no-cache 2>&1 | tee /tmp/e2e-sprint.log
grep -qE 'Tests[[:space:]]+5 passed' /tmp/e2e-sprint.log || { echo "FAIL: sprint 契约 5 用例未全绿"; exit 1; }
grep -q '1 failed\|[1-9][0-9]* failed' /tmp/e2e-sprint.log && { echo "FAIL: sprint 契约有失败用例"; exit 1; }

# 2. package 永久回归 diff-gate.test.js — 子 shell 切进 packages/brain（9.25 死规则）
(cd packages/brain && ../../node_modules/.bin/vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1) | tee /tmp/e2e-pkg.log
grep -qE 'Tests[[:space:]]+[0-9]+ passed' /tmp/e2e-pkg.log || { echo "FAIL: package 回归未通过"; exit 1; }
grep -q '[1-9][0-9]* failed' /tmp/e2e-pkg.log && { echo "FAIL: package 回归有失败用例（既有断言被破坏）"; exit 1; }

# 3. 断言步骤 3a 透传语义真实落在源码中（防止 mock/绕过实现假绿）：确定性 reason_code 分支存在且 retryable:false
node -e '
const c = require("fs").readFileSync("packages/brain/src/impact-contract/diff-gate.js","utf8");
// 步骤 3a 必须读取 reason_code（顶层或 freshness 内）并在确定性时透传
if (!/reason_code/.test(c)) { console.error("FAIL: diff-gate.js 未引用 reason_code"); process.exit(1); }
if (!/mapper_stale/.test(c)) { console.error("FAIL: diff-gate.js 丢失 mapper_stale 瞬时分支"); process.exit(1); }
console.log("OK: 源码含 reason_code 透传 + mapper_stale 保留分支");
'

echo "✅ Diff Impact Gate 步骤 3a reason_code 透传 + fail-closed E2E 验证通过"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapClient 返回 `freshness.reason_code` 为空字符串 `""` 或纯空格 `"  "` → 必须归瞬时（trim 后长度 0），不得当确定性；顶层 `reason_code: 123`（非字符串）→ 必须归不可判定/瞬时，不得透传数字。
- 重复提交: 同一 attempt 连续两次调用步骤 3a（相同 stale + reason_code）→ 两次返回一致（幂等，无副作用）。
- 中途中断: 确定性 reason_code 分支 return 后，绝不进入步骤 4 对账/步骤 5 DB 写（不得产生 gap_events/block tasks 副作用）。
- 边界值: 顶层 `reason_code` 与 `freshness.reason_code` 同时非空且不同值 → 按精确判据优先顶层；freshness 存在但 `status==='fresh'` 时不进入 3a（正常放行）。
发现分级: P0/P1（确定性被误判成无限重试 / 瞬时被误判成终态 deny / 步骤 3a 误触发 DB 写副作用）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 步骤 3a reason_code 透传 + fail-closed | `sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts` | `确定性 reason_code 透传且 retryable=false`、`确定性 reason_code 也回填到 reason_code 字段`、`真·瞬时 stale`、`既无 freshness 也无 reason_code`、`有 reason_code ⇒ 非重试` | → 3 failed / 2 passed（确定性 3 条红，瞬时+不可判定 2 条守卫已绿） |

> 「BEHAVIOR 覆盖」列每个覆盖名均为对应 `it()` 名的字面子串（可 `grep -F` 命中 tests 文件）。
