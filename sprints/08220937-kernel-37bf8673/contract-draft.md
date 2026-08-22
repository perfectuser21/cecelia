# Sprint Contract Draft (Round 1) — publisher 进 INFRA_RETRY_ACTION_BY_ROLE，runner_failure 有界重派

**journey_type**: autonomous
**target_environment**: local_api（纯 Brain 内部 derive 纯函数守卫，node/vitest 直跑，无 DB/HTTP 外部依赖）
**map**: `[MAP_NOT_CONFIGURED]`（本 attempt runtime postgres=false，Brain 未起，无法查 /api/brain/map；不回退领域硬编码）
gp-anchor: skipped (product-map.json not found)
contract-gate: present (cecelia worktree，走代码层 Contract Gate + 本 skill 内置规则)

## Response Schema（推导来源: PRD 字面 / N/A）

N/A — 任务无 HTTP 响应。本 sprint 改的是 `derive()` 纯函数的**返回对象 shape**（非 HTTP endpoint）。
derive 对 publisher runner_failure 回调的目标返回对象（字面，不可漂移）：

```json
{"phase": "publish", "action": "publish:approved_ref", "reason": "callback_runner_failure_retry"}
```

- `phase` (string, 必填): 字面 `"publish"` — 来源 PRD Golden Path step2/3 + `INFRA_RETRY_ACTION_BY_ROLE` 现有 phase 命名约定
- `action` (string, 必填): 字面 `"publish:approved_ref"` — 来源 PRD 假设（复用常量 `ACTION.PUBLISH_APPROVED_REF`，constants.js:64）
- `reason` (string, 必填): 字面 `"callback_runner_failure_retry"` — 来源 derive.js:600 既有 retry 分支 reason
**禁用字段/禁用值**: `reason` 不得为 `"callback_runner_failure_route_unknown"`（=本 bug 症状）；不得回退 `phase:"failed"`/`action:"mark_failed"`
超限兜底返回对象（priorRunnerFailures≥2，语义不变）：
```json
{"phase": "review", "action": "wait:human_review", "reason": "callback_runner_failure_exhausted"}
```

## 锚定父路声明

覆盖父路 F1「工厂·开发闭环」golden path 第 3 步（造完真验 / runner_failure 有界重派，step_id F1-S3，journey_id e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29）。

## Golden Path

[publisher 回调 runner_failure] → [derive 统计 priorRunnerFailures 并查 INFRA_RETRY_ACTION_BY_ROLE['publisher']] → [返回 publish 重派动作 或 超限人审兜底]

### Step 1: publisher attempt callback runner_failure 到达
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条「一次 attempt callback 到达，status=failed、failure_class=runner_failure、role=publisher」

**可观测行为**: derive 输入 `observed.decisionLog` 末条为 `{action:'verdict:attempt_callback', detail:{status:'failed', failure_class:'runner_failure', role:'publisher'}}`，进入 runner_failure 有界重派分支（derive.js:575）。

**验证命令**:
```bash
# 真跑 derive 纯函数（不 stub），断言 publisher 首次 runner_failure 不落终态
npx vitest run sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js -t '重派 publish' --no-cache
# 期望：exit 0（改后 GREEN）；改前 RED（reason=callback_runner_failure_route_unknown）
```
**硬阈值**: 该用例 exit 0；`r.phase != 'failed'`

---

### Step 2: derive 查历史 runner_failure 计数并取角色重派动作
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条「统计 priorRunnerFailures（计数逻辑不动）；<2 次时查 INFRA_RETRY_ACTION_BY_ROLE['publisher'] 取 {phase:'publish', action:'publish:approved_ref'}」

**可观测行为**: `priorRunnerFailures<2` 时 `infrastructureRetryForCallback('publisher', ...)` 走 defaultRetry 分支（role!=='generator' 直接返回 `INFRA_RETRY_ACTION_BY_ROLE['publisher']`，derive.js:271-272），返回非空 retry 对象；`priorRunnerFailures>=2` 时进人审兜底（derive.js:582）。

**验证命令**:
```bash
# 超限（第 3 次）→ 人审兜底，有界语义不变
npx vitest run sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js -t '人审兜底 callback_runner_failure_exhausted' --no-cache
# 期望：exit 0，返回 {phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted'}
```
**硬阈值**: 该用例 exit 0；priorRunnerFailures 计数口径不变（仍只统计 hop 更早、同为 runner_failure 的 ATTEMPT_CALLBACK）

---

### Step 3: derive 返回 publish 重派动作，不再 route_unknown
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条「返回 {phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry'}；不再返回 reason:'callback_runner_failure_route_unknown'」

**可观测行为**: 补 `publisher` 条目后 `retry` 非空 → derive 走 derive.js:597-601 retry 分支，reason=`callback_runner_failure_retry`；不再落 derive.js:591-595 的 route_unknown 分支。

**验证命令**:
```bash
# 精确断言返回 shape + reason 非 route_unknown（本 bug 症状）
npx vitest run sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js --no-cache
# 期望：exit 0，全部 4 用例通过（含 reason != callback_runner_failure_route_unknown）
```
**硬阈值**: 4 用例全 exit 0

---

## 已知约束（来自回归测试 + 累积 FR）

- [tests/gp/f1/step3-runner-failure-retry.test.js] → evaluator 的 runner_failure（首次）→ 同 run 重派 evaluator，不判终态
- [tests/gp/f1/step3-runner-failure-retry.test.js] → generator 的 runner_failure（首次）→ 重派 generator-fix 路由，不判终态
- [tests/gp/f1/step3-runner-failure-retry.test.js] → 同一 run 第 3 次 runner_failure → 进人审（有界，不无限重试）
- [tests/gp/f1/step3-runner-failure-retry.test.js] → 负向：product 类失败（无 failure_class）照旧判终态
- [tests/gp/f1/step3-runner-failure-retry.test.js] → 负向：cancelled 照旧判终态
- [累积FR] context-manifest: unavailable（runtime postgres=false，Brain 未起，端点不可达）
- 本次改动**不得回退**上述 evaluator/judge/generator 既有重派与终态行为（回归保护）

## 禁 mock 边清单

本单改动涉及**状态机（runner_failure 回调 → derive 路由决策）**，属"禁 mock 被改的边"范畴：

- attempt callback（`role=publisher`, `failure_class=runner_failure`）↔ `derive()` 决策：测试必须真调 `derive`（真导入 `packages/brain/src/orchestrator/derive.js`），**禁止** stub/mock `attemptCallbackRoute` / `infrastructureRetryForCallback` / `INFRA_RETRY_ACTION_BY_ROLE`。冻结测试 `sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js` 已按此写（`import { derive }` 真函数，无 vi.mock）。
- 无 DB 写路径（derive 为纯函数，无 I/O）→ 本单无"代码↔DB 表"边。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `INFRA_RETRY_ACTION_BY_ROLE` 增加 `publisher: { phase:'publish', action:ACTION.PUBLISH_APPROVED_REF }`，使 publisher runner_failure 享有界重派 |
| **NFR（做得多好）** | 非功能 | derive 纯函数无 I/O 时延约束；有界重派 ≤2 次同角色，超限人审（语义既定沿用） |
| **Invariant（永不违反）** | 不变量 | priorRunnerFailures 计数口径不变（只统计 hop 更早、同为 runner_failure 的 ATTEMPT_CALLBACK）；evaluator/judge/generator 既有重派/终态行为不回退 |
| **判定点（怎么知道）** | 模糊现实判断 | （本任务无接缝判定点，N/A — 纯函数按 detail 字段确定性分支，不推断外部真实状态） |
| **保质期（何时过期）** | 失效退役 | N/A — 静态路由表条目，随 ACTION.PUBLISH_APPROVED_REF 常量生命周期 |
| **死亡告警（停了谁知道）** | 告警 | N/A — 决策 reason 进 decisionLog，异常路由由回归测试 + kernel run 观测捕获 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | derive 返回对象即效果本身（同步纯函数）；BEHAVIOR 用例断言返回 shape/reason 字面值 |

### 判定点登记表

（本任务无接缝判定点，N/A — derive 依据 callback detail 的 status/failure_class/role 字段做确定性分支，不涉及对外部真实状态的推断。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| publisher runner_failure 首次/次次（priorRunnerFailures<2） | 不判终态，重派 publish（callback_runner_failure_retry） | 是（同角色有界重派，计数按 decisionLog 幂等推导） | ≤2 次后转人审 |
| publisher runner_failure 第 3 次（priorRunnerFailures≥2） | wait:human_review（callback_runner_failure_exhausted） | 是 | 人审兜底，不静默无限重试 |
| publisher product 类失败（无 failure_class） | 照旧 mark_failed（callback_failed） | N/A | 不被本次放宽，判终态 |

### 输入对抗面

N/A — 非对外暴露 agent，输入为 kernel 内部 derive 的 observed/decisionLog 结构。

## E2E 验收（final-e2e 跑 — target_environment=local_api，node/vitest 纯函数守卫）

> 本 sprint 为纯 Brain 内部 derive 纯函数守卫（无 DB/HTTP）：E2E 即从仓库根跑冻结 sprint 测试 + repo 既有回归测试。
> 两者均在 `sprints/**`、`tests/**` 白名单内，允许从仓库根 `npx vitest run`（符合 vitest 工作目录规则）。

```bash
#!/bin/bash
set -euo pipefail

SPRINT_TEST="sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js"
REGRESSION_TEST="tests/gp/f1/step3-runner-failure-retry.test.js"

# 1. 冻结 sprint 测试：publisher runner_failure RED->GREEN（首次重派 + 超限人审 + 负向 + evaluator 回归）
npx vitest run "$SPRINT_TEST" --no-cache --reporter=basic || { echo "FAIL: publisher 有界重派冻结测试未过"; exit 1; }

# 2. repo 既有回归：evaluator/judge/generator 既有 runner_failure 重派行为不回退
npx vitest run "$REGRESSION_TEST" --no-cache --reporter=basic || { echo "FAIL: 既有 runner_failure 回归退化"; exit 1; }

# 3. 产物断言：derive.js 确已含 publisher 路由条目（防空实现假绿）
node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8'); if(!/publisher:\s*\{\s*phase:\s*'publish',\s*action:\s*ACTION\.PUBLISH_APPROVED_REF\s*\}/.test(c)){console.error('FAIL: derive.js 缺 publisher 路由条目');process.exit(1)}" || exit 1

echo "✅ Golden Path 验证通过：publisher runner_failure 有界重派 + 回归不退 + 产物到位"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `role` 拼写变体（`Publisher`/`publish`/大小写）→ 应仍走 route_unknown（表 key 精确匹配），不得被误命中
- 重复提交: 同 hop 的 publisher runner_failure 回调在 decisionLog 出现多次 → priorRunnerFailures 计数是否仍幂等（只按 hop< 当前、同类计数）
- 中途中断: publisher 重派后紧跟一次 evaluator runner_failure 混合序列 → 计数口径是否跨角色误累加（应按 detail 各自 role 分支，但计数只看 failure_class=runner_failure 不分角色——确认与既有语义一致）
- 边界值: priorRunnerFailures 恰为 2（第 3 次）边界 → exhausted；恰为 1（第 2 次）→ 仍 retry
发现分级: P0/P1（把 publisher 重派误路由成终态 mark_failed / 或把既有角色行为改坏）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
