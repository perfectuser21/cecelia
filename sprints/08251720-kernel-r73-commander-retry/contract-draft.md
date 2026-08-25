# Sprint Contract Draft (Round 1) — commander lease 过期自动重派（有界）[r73]

**锚定父路声明**: 独立小路（无父路） — 本 sprint 是 kernel derive 路由的独立缺陷修复（commander 角色 infrastructure 重试路由缺席），journey e6f803f2 下无已验收父路可锚。

**contract-gate**: 本仓库存在 `packages/brain/src/lib/contract-gate.js`（cecelia worktree）→ 代码层 Contract Gate 生效，本合同断言按合规惯用法速查表书写。
**gp-anchor**: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 纯改 `packages/brain/src/orchestrator/derive.js` 的
`derive(observed)` 纯函数路由分支，返回值是内部决策对象 `{phase, action, reason[, callbackHop]}`，
非对外 HTTP 端点。字段约束由 Test Contract 的 vitest 断言 codify（见 tests/gp/f1/）。

## 已知约束（来自回归测试 + 累积 FR）

- [tests/gp/f1/step3-route-unknown-review-approve-consume.test.js] → route_unknown 决策对象必须带 `callbackHop`（loop 落盘请求行锚来源）；本地候选（pr=null）批准走候选头锚消费。本 sprint 达上限回落人审必须**沿用**该 callbackHop 契约（不得回退）。
- [tests/gp/f1/step3-runner-failure-retry.test.js] → runner_failure 有界重派同角色（≤2 次）后进人审；`commander` 的 runner_failure 语义本 sprint **不得改动**（负向锁死）。
- [tests/gp/f1/step3-recollect-lagging-pr-head-bounded.test.js 等] → infrastructure 类有界重派家族一致性（reason=callback_infrastructure_blocked）。
- [累积FR] journey e6f803f2 下 ability 均为 planned，无 done/working 累积 FR（context-manifest: 本 line 暂无已验收历史）。
- [MAP_NOT_CONFIGURED] task.payload.map_scope/map_repo 未配置 → 不引用 Unified Map 半径，按 PRD 范围限定收敛。

## Golden Path

[commander attempt lease 过期被收割器 reconcile] → [derive 纯函数识别 commander infrastructure 失败并按当前 phase 有界重派 commander] → [主链续跑不落人审；达上限 fail-closed 回落人审]

---

### Step 1: commander lease 过期终态回调进入 derive
**来源**: `[FROM_PRD]` — PRD「Golden Path 步骤 1」直接定义：orchestrator_decision_log 出现 `spawn:commander` 后紧跟 `effect:expired_attempt_reconciled`（role=commander、status=failed、failure_class=infrastructure_blocked、signature=worker_attempt_replacement_required_after_lease）。

**可观测行为**: `derive(observed)` 从 `latestUnconsumedAttemptResult` 捞到该 commander 过期 infra 终态行，进入 `attemptCallbackRoute` 的 infrastructure_blocked 分支（role=commander）。

**验证命令**:
```bash
# 真 import derive.js，传单条 commander 过期 infra 重放链，断言路由到重派而非人审
npx vitest run tests/gp/f1/step3-commander-infra-retry-r73.test.js -t 'route_unknown 人审' --reporter=dot
# 期望：该 it PASS（修后 derive 返回 spawn:commander，不再 wait:human_review）
```

**硬阈值**: `derive(...).action === 'spawn:commander'` 且 `reason === 'callback_infrastructure_blocked'`；`action !== 'wait:human_review'`。
**验证命令**: `npx vitest run tests/gp/f1/step3-commander-infra-retry-r73.test.js -t '重派 commander 续主链' 2>&1 | grep -qE '1 passed' || exit 1`

---

### Step 2: derive 有界重派 commander（累计 < 5 次）
**来源**: `[FROM_PRD]` — PRD「Golden Path 步骤 2 + NFR 频控」：同 run 内 commander infrastructure 类失败累计 < 上限（5）时按当前 phase 重派 commander（监理角色，重派无副作用）。计数口径 = 同 run 内 role=commander 且 failure_class=infrastructure_blocked 的 expired/failed 回调数（只读 orchestrator_decision_log 行时序，纯函数可重放）。

**可观测行为**: 第 5 次（含）以内的 commander infra 失败 → `derive` 返回 `{action:'spawn:commander', reason:'callback_infrastructure_blocked'}`，主链续跑。

**验证命令**:
```bash
npx vitest run tests/gp/f1/step3-commander-infra-retry-r73.test.js -t '未达上限' 2>&1 | grep -qE '1 passed' || exit 1
# 期望：4 次历史过期 infra + 当前第 5 次 → 仍重派 commander
```

**硬阈值**: `prior(hop<current)=4 < 5` → `action === 'spawn:commander'`。
**验证命令**: `npx vitest run tests/gp/f1/step3-commander-infra-retry-r73.test.js -t '未达上限' 2>&1 | grep -qE 'Tests.*1 passed' || exit 1`

---

### Step 3: 达上限 fail-closed 回落人审（第 6 次失败）
**来源**: `[FROM_PRD]` — PRD「Golden Path 步骤 3 达到上限 + Invariant fail-closed」：累计达上限（第 6 次失败）后仍返回 `wait:human_review`（reason=`callback_infrastructure_route_unknown`，带 `callbackHop` 锚），禁止无限重派。

**可观测行为**: 5 次历史过期 infra + 当前第 6 次 → `derive` 返回 `{action:'wait:human_review', reason:'callback_infrastructure_route_unknown', callbackHop:<current hop>}`，承接 r70 案卷双锚定要求。

**验证命令**:
```bash
npx vitest run tests/gp/f1/step3-commander-infra-retry-r73.test.js -t '达上限' 2>&1 | grep -qE '1 passed' || exit 1
# 期望：prior=5 ≥ 5 → wait:human_review + callbackHop=111
```

**硬阈值**: `action === 'wait:human_review'` 且 `reason === 'callback_infrastructure_route_unknown'` 且 `callbackHop === 111`。
**验证命令**: `npx vitest run tests/gp/f1/step3-commander-infra-retry-r73.test.js -t '达上限' 2>&1 | grep -qE 'Tests.*1 passed' || exit 1`

---

### Step 4: 既有分支零回归（负向护栏）
**来源**: `[AI_ADDED]` — 理由：commander 复用 `infrastructureRetryForCallback` 的三条共享分支（infrastructure_blocked / account_exhausted / runner_failure）。若实现把 commander 塞进共享 `INFRA_RETRY_ACTION_BY_ROLE` map，会连带污染 account_exhausted / runner_failure，违反 PRD「不动既有分支」。本步锁死非 commander 角色与 commander 非 infra 类失败语义完全不变。

**可观测行为**:
- planner 过期 infra 回调 → `{phase:'planning', action:'spawn:planner', reason:'callback_infrastructure_blocked'}`（不变）。
- commander semantic_refusal → `wait:human_review` / `callback_semantic_refusal`（不变）。
- commander account_exhausted → `wait:human_review` / `callback_account_exhausted_route_unknown`（不变）。
- commander runner_failure（首次）→ `wait:human_review` / `callback_runner_failure_route_unknown`（不变）。

**验证命令**:
```bash
npx vitest run tests/gp/f1/step3-commander-infra-retry-r73.test.js -t '负向' 2>&1 | grep -qE '4 passed' || exit 1
# 期望：4 条负向护栏全过（planner 不变 + commander 三类非 infra 失败不变）
```

**硬阈值**: 4 条负向 it 全 PASS；实现只在 infrastructure_blocked 分支内加 commander 有界重派，不改共享 map 语义。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | commander 的 infrastructure_blocked 终态回调纳入 derive 有界自动重派（action=spawn:commander，reason=callback_infrastructure_blocked），根除每轮 route_unknown 人审 |
| **NFR（做得多好）** | 非功能需求 | 纯函数无网络无延迟约束；重试上限 5 次/run（fail-closed 兜底）；零回归（非 commander 角色 + commander 非 infra 类失败语义不变） |
| **Invariant（永不违反）** | 不变量 | ①纯函数可重放：只依赖 orchestrator_decision_log 行时序，不引入新状态存储；②fail-closed：上限触顶必回落人审，禁无限重派；③callbackHop 锚不回退（承接 r70） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效条件 | 常量上限 5 内嵌 derive.js 源码，无 token/证书类保质期；随收割器 lease 策略变更需复审计数口径 |
| **死亡告警（停了谁知道）** | 告警 | 达上限落 wait:human_review 即主理人可见信号；derive 纯函数由 tests/gp/f1 冻结测试守卫，回归即 CI 红 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | derive 返回决策对象即被 loop 消费；重派效果由「主链不再落 route_unknown 人审」的冻结测试 GREEN 确认 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| commander 失败是否属 infrastructure 类（可安全重派） | A. 读 detail.failure_class==='infrastructure_blocked'; B. 读 signature 字符串 | A. detail.failure_class==='infrastructure_blocked'（同时是 expired_attempt_reconciled 终态） | 与既有八角色重试路由同口径，dispatcher 已可派 spawn:commander | 误判非 infra 为 infra → 对不可重派失败无限重派（已由上限 5 + 分支隔离兜底） |
| 同 run 内 commander infra 失败累计次数（是否达上限） | A. 统计 decisionLog 中 role=commander 且 failure_class=infrastructure_blocked 的 expired/failed 回调行（hop<current）; B. 新增计数状态存储 | A. 只读 decisionLog 行时序统计（纯函数可重放） | Invariant 纯函数可重放，禁新状态存储；与 runner_failure priorRunnerFailures 同构 | 计数偏大 → 过早回落人审（可控，仍 fail-closed）；计数偏小 → 超限重派（由分支隔离 + 冻结测试锁死边界 5/6） |

（本任务无对外 agent 暴露的接缝判定点，判定点均为内部 decisionLog 重放推断。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| commander infra 失败累计 < 5 | 重派 commander（action=spawn:commander） | 是（幂等：commander 监理角色重派无副作用，纯函数按 decisionLog 重放同输入同输出） | 主链续跑 |
| commander infra 失败累计达上限（第 6 次） | 回落 wait:human_review（callback_infrastructure_route_unknown + callbackHop 锚） | 是（重放同输入同输出） | fail-closed 人审兜底，禁无限重派 |
| commander 非 infra 类失败（semantic_refusal / account_exhausted / runner_failure） | 沿用既有分支（语义完全不变） | 是 | 既有兜底不变 |

### 输入对抗面

N/A — 本 sprint 无对外暴露 agent 输入；derive 消费的是 kernel 内部 orchestrator_decision_log 行（服务端投影权威写入），非外部用户可写通道。

## 禁 mock 边清单

本单改动属**状态机 / 调度路由**（derive 的 attemptCallbackRoute 分支）——禁 mock 被改的边：

- derive() ↔ orchestrator_decision_log 行时序（本单按真实 decisionLog 数组重放 commander 失败计数，测试必须传真数组，**禁 stub** attemptCallbackRoute / latestUnconsumedAttemptResult / infrastructureRetryForCallback / INFRA_RETRY_ACTION_BY_ROLE）。
- derive() ↔ 决策对象消费方（loop）：合同只锁 derive 返回值形状（action/reason/callbackHop），tests 真 import `packages/brain/src/orchestrator/derive.js` 的导出 `derive`，不替身。

（本单为纯函数 kernel 改动，无 DB 写路径边；无跨进程边。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— DoD/测试无任何 force_*/stub/假数据；tests 真 import derive.js 传真实 decisionLog 数组，无第三方 API、无设备/agent 调用方接缝。真实链路四硬规则：规则A（真实调用方 shape）N/A（无设备/agent 调服务端）；规则B（第三方真调）N/A（无第三方依赖）；规则C 本段显式登记 N/A；规则D（target_environment 路由）local_api 与纯函数 node 单测运行环境匹配。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 纯函数 kernel 改动：E2E 即从仓库根 node/vitest 真 import derive.js 跑冻结合同测试（tests/** 在根 vitest include 内，无需 psql / 无需 Brain 服务 / 无需 DB_URL）。RED→GREEN：改前 2 条正向重派断言 FAIL、改后 7 条全过。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 源码落地断言：derive.js 已加 commander infrastructure 有界重派（含上限常量 5 + spawn:commander）
node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!c.includes('spawn:commander')&&!/SPAWN_COMMANDER/.test(c)){console.error('FAIL: derive.js 无 spawn:commander 重派');process.exit(1)}if(!/\b5\b/.test(c)){console.error('FAIL: derive.js 无上限常量 5');process.exit(1)}console.log('OK: derive.js 落地 commander 有界重派')"

# 2. F1 seal 冻结测试全绿（真 import derive.js，7 条：2 正向重派 + 1 上限 fail-closed + 4 负向零回归）
npx vitest run tests/gp/f1/step3-commander-infra-retry-r73.test.js --reporter=dot 2>&1 | tee /tmp/r73-gp.log
grep -qE '7 passed' /tmp/r73-gp.log || { echo "FAIL: F1 seal 冻结测试未 7 passed"; exit 1; }

# 3. sprint 冻结测试全绿（同族守卫，双落盘）
npx vitest run sprints/08251720-kernel-r73-commander-retry/tests/commander-infra-retry-r73.test.ts --reporter=dot 2>&1 | tee /tmp/r73-sprint.log
grep -qE '7 passed' /tmp/r73-sprint.log || { echo "FAIL: sprint 冻结测试未 7 passed"; exit 1; }

# 4. 零回归护栏：既有 route_unknown 消费 + runner_failure 有界测试仍全绿（不得被本次改动打破）
npx vitest run tests/gp/f1/step3-route-unknown-review-approve-consume.test.js tests/gp/f1/step3-runner-failure-retry.test.js --reporter=dot 2>&1 | tee /tmp/r73-reg.log
grep -qE 'passed' /tmp/r73-reg.log || { echo "FAIL: 既有 infra 家族回归测试未通过"; exit 1; }

echo "✅ r73 commander 有界重派 Golden Path 验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: decisionLog 缺 detail.hop / detail.failure_class（undefined）→ commander 分支不得崩溃或误重派，应落既有兜底（mark_failed / route_unknown）。
- 重复提交: 同一 commander 过期 infra 行被重复 append（相同 hop）→ 计数不得重复膨胀，重放幂等。
- 中途中断: 上限边界附近（prior=4 与 prior=5 交界）计数 off-by-one，验证 5/6 边界精确。
- 边界值: 恰好 5 次、6 次、0 次 commander infra 失败；混入 1 条非 commander infra 行（planner）是否被误计入 commander 计数。
发现分级: P0/P1（误判死循环无限重派 / commander 计数把别的角色算进来导致过早人审）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| commander infra 有界重派（冻结·必需） | `sprints/08251720-kernel-r73-commander-retry/tests/commander-infra-retry-r73.test.ts` | 重派 commander 续主链 / 未达上限 / 达上限 / 负向 | 改前 2 failed / 5 passed |
| commander infra 有界重派（F1 seal·CI 必需） | `tests/gp/f1/step3-commander-infra-retry-r73.test.js` | 重派 commander 续主链 / 未达上限 / 达上限 / 负向 | 改前 2 failed / 5 passed |
| 既有 infra 家族回归（补充行·不新增） | `tests/gp/f1/step3-route-unknown-review-approve-consume.test.js` | route_unknown / callbackHop | 既有全绿（零回归护栏） |
