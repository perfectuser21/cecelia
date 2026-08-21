# Sprint Contract Draft (Round 1)

**锚定父路声明**: 覆盖父路 F1「工厂·开发闭环」第 3 步「造完真验」（step_id L-F1-S3 — attempt callback ↔ derive 决策边）

**journey_type**: autonomous
**target_environment**: local_api（纯 Node vitest 真 derive，无 HTTP/DB/浏览器/真机）

gate-anchor: n/a
gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在，走代码层 Contract Gate）

---

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

N/A — 任务无 HTTP 响应。本改动是 `derive()` 纯函数状态机内的一条路由表补全（`INFRA_RETRY_ACTION_BY_ROLE` 新增 `publisher` 条目），不新增/修改任何 API 端点、DB schema 或对外响应。唯一「响应」是 `derive()` 返回的决策对象 `{ phase, action, reason }`，其字段值由 vitest 真 derive 断言（见 DoD [BEHAVIOR]）。Reviewer 第 6 维按 vitest 断言覆盖度审查，非 jq schema。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [tests/gp/f1/step3-runner-failure-retry.test.js] → runner_failure 有界重派，不再一刀杀 run；evaluator 首次 runner_failure → spawn:evaluator 重派；generator 首次 → generator-fix 路由；第 3 次 → 人审兜底；product 类失败/cancelled 照旧终态。**本 sprint 必须保持这些断言逐字通过（非 publisher 零漂移）。**
- [derive-account-exhausted.test.js] → account_exhausted 复用 INFRA_RETRY_ACTION_BY_ROLE[role]，reason=callback_account_exhausted，phase 不为终态。

### 累积 FR（Step 1.3）
- context-manifest: unavailable（postgres=false，本 attempt 无 Brain API 可达；PRD「累积 FR」段声明本 line 暂无历史）

### must_run_assertions（Unified Map radius，Step 1.0）
- [MAP_NOT_CONFIGURED]（task.payload 无 map_scope/map_repo，radius 未配置，不回退领域硬编码）

---

## Golden Path

[publisher attempt 回调基础设施故障] → [derive.attemptCallbackRoute 进 runner_failure 分支] → [infrastructureRetryForCallback('publisher',…) 查 INFRA_RETRY_ACTION_BY_ROLE 命中 publisher] → [返回 publish 重派动作，不再 route_unknown] → [超限进人审兜底]

### Step 1: publisher attempt 回调落库为基础设施故障
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条直接定义（触发条件）

**可观测行为**: decisionLog 末尾出现一条 `verdict:attempt_callback` 行，detail 为 `status='failed'`、`failure_class='runner_failure'`、`role='publisher'`（容器/guard/依赖装配起不来，非产品失败）。

**验证命令**（真 derive，构造该回调 → 断言 derive 出口）:
```bash
npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js \
  -t '返回 publish 重派动作' --no-cache
# 期望：exit 0（真 derive 对 publisher runner_failure 回调返回 publish 重派）
```

**硬阈值**: 对应 it() 断言 `r` 逐字段匹配 `{ phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }`，且 `r.reason !== 'callback_runner_failure_route_unknown'`。

---

### Step 2: derive 查角色重派表命中 publisher，返回 publish 重派动作
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2-3 条直接定义（系统处理 + 可观测结果）

**可观测行为**: `attemptCallbackRoute()` 进 `runner_failure` 分支（derive.js:575）→ `infrastructureRetryForCallback('publisher',…)`（derive.js:270-272，非 generator 走 `defaultRetry`）→ 查 `INFRA_RETRY_ACTION_BY_ROLE['publisher']` **命中** `{ phase:'publish', action:ACTION.PUBLISH_APPROVED_REF }`（唯一实现改动，derive.js:240-248）→ derive 返回 `{ phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }`。修前该表无 publisher 条目 → `retry=undefined` → 落 `callback_runner_failure_route_unknown` 人审死等。

**验证命令**: 同 Step 1（同一 it() 覆盖首次重派）。

**硬阈值**: `ACTION.PUBLISH_APPROVED_REF === 'publish:approved_ref'`（constants.js:64 已定义，dispatcher 亦以该 action 派 role=publisher，重派动作可被正确消费）。

---

### Step 3: 同族收益 — publisher 的 infrastructure_blocked / account_exhausted 一并命中表
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 条（同一表条目一并修复同族出口）

**可观测行为**: 同一 `INFRA_RETRY_ACTION_BY_ROLE['publisher']` 条目补全后，`infrastructure_blocked` 分支（derive.js:456-473）与 `account_exhausted` 分支（derive.js:478-491）对 publisher 回调也从 `undefined→route_unknown` 变为返回 publish 重派：`infrastructure_blocked` → `reason='callback_infrastructure_blocked'`；`account_exhausted` → `reason='callback_account_exhausted'`（皆 `phase:'publish', action:'publish:approved_ref'`）。

**验证命令**:
```bash
npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js \
  -t 'infrastructure_blocked' --no-cache && \
npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js \
  -t 'account_exhausted' --no-cache
# 期望：exit 0
```

**硬阈值**: 两条 it() 断言 `r.reason` 不为对应 `*_route_unknown`，且 `{ phase:'publish', action:'publish:approved_ref' }` 匹配。

---

### Step 4: 超限出口 — ≥2 次 publisher runner_failure 后进人审兜底（计数语义不变）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 条 + 「边界情况」（有界重派 ≤2 次）

**可观测行为**: decisionLog 已含 2 条 publisher `runner_failure` 回调后，第 3 条命中 `priorRunnerFailures >= 2`（derive.js:576-588，计数逻辑不动）→ 返回 `{ phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }`。此分支在查重派表**之前**，故修前修后行为一致（本条是有界性证明，防「无限重试」）。

**验证命令**:
```bash
npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js \
  -t '进人审兜底' --no-cache
# 期望：exit 0
```

**硬阈值**: `r` 匹配 `{ phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }`。

---

### Step 5: 非 publisher 角色零漂移（回归出口）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD「边界情况」要求「非 publisher 角色路由行为必须与本改动前逐字一致」+ Invariant「回归用源码巡检」；补表是纯增量，必须证明不污染 evaluator/judge/generator 既有路由。

**可观测行为**: evaluator runner_failure → `spawn:evaluator`；judge runner_failure → `spawn:judge`；均 `reason='callback_runner_failure_retry'`，与改动前逐字一致；generator 的 hop 对齐特判（derive.js:272-292）不受影响。

**验证命令**（本 sprint 新增回归 + 既有回归双跑）:
```bash
npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js \
  tests/gp/f1/step3-runner-failure-retry.test.js --no-cache
# 期望：exit 0（两文件全绿；既有 sibling 5 条断言零漂移）
```

**硬阈值**: 两文件全部通过；既有 `step3-runner-failure-retry.test.js` 5 条断言不动。

---

## 禁 mock 边清单

本单改动涉及**状态机（derive 路由决策）** + **回调数据在模块间的路由（attemptCallbackRoute → infrastructureRetryForCallback → INFRA_RETRY_ACTION_BY_ROLE 查表）**，故：

- `derive()` ↔ 内部 `attemptCallbackRoute()` / `infrastructureRetryForCallback()`（本单改的就是这条决策边）：测试必须调**真 derive**（`import { derive }`），**禁止** `vi.mock`/stub `attemptCallbackRoute`、`infrastructureRetryForCallback` 或 `INFRA_RETRY_ACTION_BY_ROLE`——只从 `decisionLog` 构造真实回调行，让真 derive 走完整查表分支。冻结测试 `sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js` 全程无 mock，符合此约束（evaluator 可机械 grep `vi.mock`/`stub` 核查，命中即 CONTRACT-IS-LAW FAIL）。
- **代码 ↔ DB 表**：本单**无 DB 写路径**（derive 是纯函数状态机，PRD「NFR」明示「纯内存 derive 决策，无 IO」），故无 DB 边需真 Postgres。postgres=false 与此一致。

（无其他接缝边——纯内存决策函数，唯一被改的边是 derive 内部查表路由，已真验。）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `INFRA_RETRY_ACTION_BY_ROLE` 新增 `publisher: { phase:'publish', action:ACTION.PUBLISH_APPROVED_REF }`，使 publisher 的 runner_failure/infrastructure_blocked/account_exhausted 回调享有界重派（≤2 次）+ 超限人审兜底，不再 route_unknown。 |
| **NFR（做得多好）** | 性能/并发 | 纯内存 derive 决策，无 IO；有界重派 ≤2 次/角色（复用既有 `priorRunnerFailures` 阈值，不新增）。 |
| **Invariant（永不违反）** | 不变量 | ①非 publisher 角色路由逐字不变（零漂移）；②`priorRunnerFailures` 计数/阈值语义不动；③基础设施类重派保持同角色身份不轮换账号（generator_infrastructure_retry_identity）；④INFRA_RETRY_ACTION_BY_ROLE 仍 `Object.freeze`。 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方登记表（本任务无接缝判定点，N/A）。 |
| **保质期（何时过期）** | 何时失效 | 无过期语义——路由表条目为常驻决策规则，随角色枚举存在而有效。 |
| **死亡告警（停了谁知道）** | 停止工作谁知道 | derive 决策对象 `reason` 字段是唯一留痕；若 publisher 重派语义回退，冻结回归测试 + sibling `step3-runner-failure-retry.test.js` 在 CI（root vitest include sprints/**、tests/**）立即变红告警。 |
| **失败语义（挂了怎么办）** | 故障放行/拦截 | fail-closed 到人审：≥2 次 runner_failure → `wait:human_review`（不静默无限重试，不误判 run 终态）；重派本身幂等（幂等键=同 run 同角色 priorRunnerFailures 计数）。 |
| **效果确认（已发≠已生效）** | 回执确认 | derive 返回对象即同步回执（纯函数，无异步动作）；重派动作 `publish:approved_ref` 由 dispatcher 以 role=publisher 消费（ASSUMPTION 已列，非本单实现）。 |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝判定点，N/A — derive 是确定性纯函数，输入 decisionLog 回调行的 `status`/`failure_class`/`role` 均为已落库确定值，无「系统自行推断外部真实状态」的判定。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| publisher runner_failure（首/次次，<2） | 返回 publish 重派动作，不判 run 终态 | 是（幂等键=同 run 同角色 runner_failure 计数） | 同角色有界重派 |
| publisher runner_failure（≥2 次） | 返回 wait:human_review，进人审 | 是（计数确定，不重复触发） | 人工兜底，不无限重试 |
| 非 runner_failure/infra/account 的 product 类 failed | 照旧 mark_failed（callback_failed） | N/A | 不被本次放宽 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本改动是 kernel 内部 `derive()` 纯函数状态机，不对外暴露 agent 接口，无外部可写入入口，无 Prompt Injection 面。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯函数决策，风险面小）
高风险面:
- 错输入: 构造 `role='publisher'` 但缺 `failure_class`（product 类 failed）→ 应走 `callback_failed` 终态，不得被误路由成重派
- 重复提交: decisionLog 含多条 publisher runner_failure 回调但穿插 spawn 行 → 验证 `priorRunnerFailures` 计数只数 `< 当前 hop` 的 ATTEMPT_CALLBACK 行，不重复计
- 中途中断: publisher runner_failure 与 evaluator runner_failure 混合在同一 decisionLog → 验证各自角色计数独立、路由不串（`priorRunnerFailures` 当前实现按 failure_class 全局计数，探索确认是否符合「≤2 次/角色」PRD 语义，若不符记 findings 不阻塞——属既有计数逻辑，本单不改）
- 边界值: `role` 为未知角色（如 `'unknown'`）→ 应仍返回 route_unknown（表无条目），确认本单只补 publisher 不误放宽其他未登记角色
发现分级: P0/P1（publisher 单点回归 / 非 publisher 漂移）→ 阻塞 merge；P2/P3（计数语义边角）→ 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 是 kernel 纯 derive 决策改动，无 HTTP/DB/浏览器/真机。E2E = 从仓库根跑 vitest 真 derive（不 stub `attemptCallbackRoute`/`infrastructureRetryForCallback`）。冻结测试与既有 sibling 回归均在 `sprints/**`、`tests/**`，root vitest include 覆盖，允许从仓库根 `npx vitest run`（无需子 shell cd 包根）。postgres=false 与本任务「纯内存 derive，无 IO」一致。

```bash
#!/bin/bash
set -euo pipefail

cd "${WORKSPACE_PATH:-/workspace}"

# 1. 冻结回归测试全绿（真 derive：publisher 有界重派 + 超限人审 + 同族 infra/account + 非 publisher 零漂移 + 负向终态）
npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js --no-cache --reporter=verbose

# 2. 既有 sibling 回归零漂移（evaluator/generator runner_failure 路由逐字不变）
npx vitest run tests/gp/f1/step3-runner-failure-retry.test.js --no-cache --reporter=verbose

# 3. 源码巡检（Invariant「调度接线类回归用 source-code inspection」）：唯一实现改动确在 INFRA_RETRY_ACTION_BY_ROLE
node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8'); const m=c.match(/const INFRA_RETRY_ACTION_BY_ROLE = Object.freeze\(\{[\s\S]*?\}\);/); if(!m){console.error('FAIL: 未找到 INFRA_RETRY_ACTION_BY_ROLE 定义块'); process.exit(1);} if(!/publisher:\s*\{\s*phase:\s*'publish',\s*action:\s*ACTION\.PUBLISH_APPROVED_REF\s*\}/.test(m[0])){console.error('FAIL: 表内缺 publisher 条目或 action 非 ACTION.PUBLISH_APPROVED_REF'); process.exit(1);} console.log('OK: INFRA_RETRY_ACTION_BY_ROLE 含 publisher 条目');"

echo "✅ Golden Path 验证通过（publisher 进 INFRA_RETRY_ACTION_BY_ROLE，有界重派不再 route_unknown）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| publisher 有界重派（首次 + 同族 infra/account） | `sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js` | 返回 publish 重派动作 / infrastructure_blocked / account_exhausted / 进人审兜底 | 修前 3 failed（route_unknown 复现）→ 修后全绿 |
| 非 publisher 零漂移回归（既有，补充行） | `tests/gp/f1/step3-runner-failure-retry.test.js` | evaluator 的 runner_failure（首次）/ 第 3 次 runner_failure | 修前 5 passed（本单不得使其变红） |
