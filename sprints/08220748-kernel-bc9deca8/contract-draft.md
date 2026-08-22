# Sprint Contract Draft (Round 1)

fix(kernel): publisher 进 INFRA_RETRY_ACTION_BY_ROLE——runner_failure 有界重派不再 route_unknown [r44]

**journey_type**: autonomous
**target_environment**: local_api（纯 Brain kernel 逻辑；本 sprint 不依赖 Postgres——runtime_resources.postgres=false，derive 为纯函数，验收 = 仓库根跑 vitest 单测）

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 只改内部纯函数 `derive` 的路由决策表 `INFRA_RETRY_ACTION_BY_ROLE`，无新增/变更任何 HTTP 端点。derive 返回对象字段（phase/action/reason）由 PRD Golden Path 字面固定，已在 DoD [BEHAVIOR] 逐条 codify。

## Golden Path

覆盖父路 F1「工厂 · 开发闭环」第 3 步「造完真验」（边：attempt callback(runner_failure) ↔ derive 决策）

[publisher runner_failure 回调] → [derive 查 INFRA_RETRY_ACTION_BY_ROLE 命中 publisher] → [返回 publish 重派而非 route_unknown]

### Step 1: publisher attempt 以 runner_failure 回调
**来源**: `[FROM_PRD]` — Golden Path 第 1 条「某 publisher attempt 以 status='failed'、failure_class='runner_failure' 回调，此前该 run publisher runner_failure 次数 < 2」

**可观测行为**: derive 读到最新未消费的 attempt_callback 行，detail 含 `role='publisher'`、`status='failed'`、`failure_class='runner_failure'`，进入 runner_failure 分支（derive.js:575）。

**验证命令**:
```bash
npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t 'B-01'
# 期望：GREEN 后 1 passed（RED 阶段 1 failed，reason=callback_runner_failure_route_unknown）
```

**硬阈值**: `Tests 1 passed`；GREEN 后 derive 不再返回 `callback_runner_failure_route_unknown`

---

### Step 2: derive 查表命中 publisher，返回 publish 重派
**来源**: `[FROM_PRD]` — Golden Path 第 2/3 条「infrastructureRetryForCallback('publisher', ...) 从 INFRA_RETRY_ACTION_BY_ROLE 命中 publisher: { phase:'publish', action:'publish:approved_ref' }；derive 返回 { phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }」

**可观测行为**: `infrastructureRetryForCallback` 中 `role !== 'generator'` 直接返回 `INFRA_RETRY_ACTION_BY_ROLE['publisher']`（derive.js:271-272）；命中后 derive 返回 retry 对象（derive.js:597-601）。

**验证命令**:
```bash
npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t 'B-01'
# 期望：r.phase==='publish' && r.action==='publish:approved_ref' && r.reason==='callback_runner_failure_retry'
```

**硬阈值**: 三字段逐字匹配（phase/action/reason），`action` 字面 == publisher 原始服务端派发动作 `publish:approved_ref`（dispatcher.js:118 role=publisher）

---

### Step 3: 超限兜底 + 回归保护（语义不变）
**来源**: `[FROM_PRD]` — Golden Path 第 4 条 + 边界情况「publisher runner_failure ≥2 次 → 人审兜底；非 publisher 角色 / 其它 failure_class 行为完全不变」

**可观测行为**:
- publisher runner_failure 累计 ≥2（priorRunnerFailures>=2）→ 复用既有 exhausted 分支（derive.js:582-588）返回 `{ phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }`
- evaluator runner_failure 路由不变（回归）
- publisher 普通 failed（无 failure_class）仍判终态 mark_failed（边界，不被本次放宽）

**验证命令**:
```bash
npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t 'B-02'
npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t 'B-03'
npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t 'B-04'
```

**硬阈值**: B-02/B-03/B-04 各 `Tests 1 passed`（B-02/B-03/B-04 在 RED 阶段即通过——超限分支与非 publisher 角色不受映射缺失影响，是回归/边界护栏）

---

## 已知约束

（来源: 回归测试 Step 1.2 + 累积 FR Step 1.3）

- [回归测试] `tests/gp/f1/step3-runner-failure-retry.test.js` → runner_failure 是基础设施故障非产品失败；有界重派同角色（≤2 次），超限进人审兜底，不轮换账号、不无限重试。本 sprint 给 publisher 补映射，必须严守同一 ≤2 上限与 exhausted 兜底语义（不得改额度）。
- [回归测试] `packages/brain/src/orchestrator/__tests__/derive-account-exhausted.test.js` → account_exhausted 分支复用 INFRA_RETRY_ACTION_BY_ROLE[role] 的 phase/action，仅 reason 区分。给 publisher 加映射后，publisher 的 account_exhausted 路径也会随之通电（同表复用）——属预期扩展，行为与 evaluator/judge 同族，无回退风险。
- [累积 FR] context-manifest: unavailable（postgres 关闭，端点不可达；本 line 累积 FR PRD 标注「暂无历史」）
- [MAP_NOT_CONFIGURED] task.payload 未提供 map_scope/map_repo，Unified Map 影响半径未配置，不回退领域硬编码。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 在 `INFRA_RETRY_ACTION_BY_ROLE` 增加 `publisher: { phase:'publish', action:ACTION.PUBLISH_APPROVED_REF }`，使 publisher runner_failure 回调走有界重派而非 route_unknown |
| **NFR（做得多好）** | | 有界重派 ≤2 次（沿用 runner_failure 分支既有上限，非本 sprint 新增）；derive reason 字段必须区分 retry/exhausted/route_unknown 供决策日志归因 |
| **Invariant（永不违反）** | | [重试身份] 重派动作必须 == 原始服务端派发动作 `publish:approved_ref`，不得静态误映射到别的 action（否则候选不存在 → WORKSPACE_RESOLUTION_FAILED） |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | 常驻路由表条目，无过期；publisher 派发动作若未来重命名，本条目需同步（与 dispatcher.js:118 联动） |
| **死亡告警（停了谁知道）** | | 若 publisher 重派再度失效 → derive 回落 route_unknown/exhausted，run 被判死或进人审，decisionLog reason 字段留痕，Commander/主理人可查 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 通过真实 derive 单测断言返回对象三字段逐字匹配（非只看 exit 0）；GREEN 后 route_unknown 不再出现 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |

（本任务无接缝判定点，N/A —— derive 为纯函数，输入 decisionLog 已是结构化事实，不推断任何外部真实世界状态。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| publisher runner_failure 首次/第 2 次 | derive 返回 publish 重派（callback_runner_failure_retry） | 是（同角色重派，幂等键=run + 原始派发动作） | 重派 publish:approved_ref |
| publisher runner_failure 第 3 次（≥2 prior） | derive 返回人审兜底（callback_runner_failure_exhausted） | 是（有界，不再自动重派） | wait:human_review |
| publisher 普通 failed（无 failure_class） | derive 判终态 mark_failed | N/A | 不受本次改动影响 |

### 输入对抗面（对外暴露 agent 必填）

N/A —— derive 是 Brain 内部编排纯函数，输入 decisionLog 由 Brain 自身写入，非对外暴露 agent 可写入接口。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 禁 mock 边清单

- attempt callback(runner_failure) ↔ derive 决策：本单改的是状态机路由判定（derive 的 runner_failure 分支查表），测试必须**真调 derive**，不得 stub/mock `attemptCallbackRoute` / `infrastructureRetryForCallback` / `INFRA_RETRY_ACTION_BY_ROLE`，用真实 `decisionLog` 数组驱动。冻结测试 `sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js` 直接 `import { derive }` 真调，零 mock。

（本单无 DB 写路径、无跨节点数据传递、无第三方调用——derive 为纯函数，仅 mock 边为上一条状态机边，已禁。）

## 真实调用方请求 shape

N/A —— 无设备/agent 调服务端；derive 输入来自 Brain 内部 decisionLog，非外部真实调用方请求。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A —— 冻结测试真调 derive，无 force_*/stub/假数据。）

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯 vitest 单测，无 DB/HTTP 依赖）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 改动为 Brain 内部纯函数 `derive` 的路由表，无 HTTP 端点、无 Postgres 依赖（runtime_resources.postgres=false）。故 local_api E2E 退化为「从仓库根跑冻结回归测试，断言 4/4 GREEN 且不再出现 route_unknown」。sprints/** 在根 vitest include 内，允许从仓库根直接 `npx vitest run`。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
TEST_FILE="sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js"

# 1. 全量跑冻结回归测试（真调 derive，零 mock）
OUT=$(npx vitest run "$TEST_FILE" --reporter=verbose 2>&1)
echo "$OUT" | tail -40

# 2. 断言 4 条全部 GREEN（B-01 publish 重派 / B-02 exhausted / B-03 evaluator 回归 / B-04 边界终态）
echo "$OUT" | grep -qE "Tests[[:space:]]+4 passed" || { echo "FAIL: 冻结测试未 4/4 通过"; exit 1; }

# 3. 负向断言：GREEN 后 derive 对 publisher runner_failure 不得再回落 route_unknown
if echo "$OUT" | grep -q "callback_runner_failure_route_unknown"; then
  echo "FAIL: 仍出现 callback_runner_failure_route_unknown（publisher 映射未生效）"
  exit 1
fi

# 4. 产物闸：源码路由表确含 publisher 条目且映射到原始派发动作 publish:approved_ref
node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!/publisher:\s*\{\s*phase:\s*'publish',\s*action:\s*ACTION\.PUBLISH_APPROVED_REF\s*\}/.test(c)){console.error('FAIL: derive.js 缺 publisher 映射行');process.exit(1)}"

echo "publisher runner_failure 有界重派 E2E 验证通过"
```

**通过标准**: 脚本 exit 0（4/4 GREEN + 无 route_unknown + 源码含 publisher 映射行）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: 构造 role='publisher' 但 failure_class 为空/未知（如 'weird'）的 runner-like 回调，确认不误入重派分支
- 重复提交: decisionLog 含多条 publisher runner_failure（1 次 / 2 次 / 3 次）边界，确认第 3 次准确切到 exhausted 而非第 2 次或第 4 次
- 中途中断: publisher runner_failure 与 evaluator runner_failure 混排在同一 decisionLog，确认 priorRunnerFailures 计数按角色无关口径（沿用既有逻辑）不被本次改动扭曲
- 边界值: publisher runner_failure 与其它角色映射（account_exhausted 复用同表）交叉，确认 publisher account_exhausted 路径同表复用后 phase/action 正确
发现分级: P0/P1（丢数据/整跑误判死或误放行）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| publisher runner_failure 有界重派 | `sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js` | `B-01 publisher runner_failure 首次`, `B-02 publisher runner_failure 累计 ≥2`, `B-03 回归：非 publisher（evaluator）runner_failure`, `B-04 边界：publisher 普通 failed` | RED: B-01 fails, reason='callback_runner_failure_route_unknown'（复现 r40 hop175 / r41 hop54 死法）；B-02/B-03/B-04 作回归/边界护栏 RED 阶段即绿 |
| 回归护栏（既有，补充引用） | `tests/gp/f1/step3-runner-failure-retry.test.js` | evaluator/generator runner_failure 有界重派语义不变 | 既有绿测，本单不得回退 |
