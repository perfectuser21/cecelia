# Sprint PRD — publisher runner_failure 走 INFRA_RETRY_ACTION_BY_ROLE 有界重派（消灭 route_unknown 死亡螺旋）

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（kernel harness 派发闭环少一个终态漏洞）

## 背景

thin_prd 法律：**publisher 对 runner_failure 走 INFRA_RETRY_ACTION_BY_ROLE，route_unknown 改写为有界重派，消灭 hop 累积死亡螺旋。**

现状（derive.js:240 `INFRA_RETRY_ACTION_BY_ROLE`）只登记了 planner/proposer/reviewer/generator/evaluator/judge/reporter 七个角色，**缺 publisher**。当 publisher attempt 回调 `status=failed, failure_class=runner_failure` 时，`infrastructureRetryForCallback('publisher', …)` 取 map 得 `undefined` → 落进 `!retry` 分支 → 返回 `callback_runner_failure_route_unknown` → `WAIT_HUMAN_REVIEW`。这不是有界重派，而是每次 runner 抖动都甩人审，hop 不断累积直至 run 被确定性杀死（bc9deca8/r44 同族死法）。前置 blocker（impact_anchor_missing / projection window race）已由 62d11f85/#5017 修复，本 sprint 在其上重跑。

## Golden Path（核心场景）

系统从 [publisher runner 抖动回调] → 经过 [derive 查角色重试表命中 publisher + 有界计数] → 到达 [同角色有界重派或超限进人审]。

具体：
1. [触发条件] publisher attempt 回调 `status=failed`、`failure_class=runner_failure`（容器/guard/依赖装配起不来，非产品失败），本 run 此前 runner_failure 次数 < 2。
2. [系统处理] `derive` 进入 runner_failure 分支（derive.js:575），`infrastructureRetryForCallback('publisher', …)` 从 `INFRA_RETRY_ACTION_BY_ROLE['publisher']` 命中 `{ phase: 'publish', action: PUBLISH_APPROVED_REF }`。
3. [可观测结果] 返回 `{ phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }`——**不再是** `callback_runner_failure_route_unknown` / `WAIT_HUMAN_REVIEW`。当本 run runner_failure 已累计 ≥ 2 次时，返回 `callback_runner_failure_exhausted` 进人审兜底（不静默无限重试）。

## 边界情况

- **超限**：同 run 第 3 次 publisher runner_failure（priorRunnerFailures ≥ 2）→ `WAIT_HUMAN_REVIEW` + reason `callback_runner_failure_exhausted`，不得再重派。
- **不越权他族**：publisher 的 runner_failure 只做有界重派，**不轮换账号**（那是 account_exhausted 语义），不误命中 infrastructure_blocked / account_exhausted 分支。
- **回归不破**：generator 的特殊回溯逻辑（infrastructureRetryForCallback role==='generator' 分支）与 evaluator/judge 既有 runner_failure 行为不受影响。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE` 增加 `publisher` 条目（phase=publish，action=PUBLISH_APPROVED_REF）。
- 扩展守卫测试覆盖 publisher runner_failure → 有界重派、超限进人审两条边。

**不在范围内**：
- 不改 infrastructure_blocked / account_exhausted 分支语义。
- 不改重试次数上界（沿用同族 ≤2）。
- 不动 dispatcher/execution-contract 的 publisher 派发链路，不加新 ACTION 常量。

## 假设

- [ASSUMPTION: publisher 有界重派应复用 publisher 正常派发的 phase='publish' + action=PUBLISH_APPROVED_REF（derive.js:1356 判 `!pr && candidate` 时的 publish 路由），与其它角色 INFRA_RETRY 条目"重派同角色原动作"语义一致。]
- [ASSUMPTION: step_id 锚定为 F1 step3「造完真验」，守卫落在 tests/gp/f1/ 目录，与既有 step3-runner-failure-retry.test.js 同边。]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：`INFRA_RETRY_ACTION_BY_ROLE` 补 `publisher` 键，消除 route_unknown 分支命中。
- `tests/gp/f1/step3-runner-failure-retry.test.js`：新增 publisher 角色的有界重派 + 超限进人审断言（真 derive，产物闸，不 stub attemptCallbackRoute）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step 源 + feature 源均为空数组），PrepPRD 未显式给 NFR -->
- 超时/延迟: 待定（PrepPRD 未指定，Proposer 阶段可留空）
- 频控: 重试次数上界 = 2（沿用 runner_failure 同族语义，超限进人审）
- 版本要求: 无
- 可观测: 每次路由决策必须在 decisionLog 留痕（reason 字段区分 retry / exhausted），失败不得静默

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step 源/feature 源为空；area 源命中的均为跨域 capture-triage 学习（多账号授权隔离、nightly-red 文案），与本 kernel 路由 sprint 域无关，不注入 -->
- [有界重派] runner_failure 是基础设施故障非产品失败，同角色有界重派 ≤2 次，超限进人审，不静默无限重试（来源: journey_feature，决策批次 109dd8eb）
- [不轮换账号] runner_failure 重派不轮换账号（账号轮换是 account_exhausted 的语义边界）（来源: journey_feature）
- [不误杀 run] 基础设施抖动不得落进通用 mark_failed 烧掉已收敛的 GAN/judge/PR 产物（来源: journey_feature）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/e6f803f2/golden-paths 返回空集 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入真实脚本（local_api → vitest 真 derive 断言）
# 期望验收点（自然语言）：
#  1) 构造 observed：role=publisher、attempt callback status=failed failure_class=runner_failure、
#     此前 runner_failure 计数为 0/1 → derive 返回 action='publish:approved_ref'、
#     reason='callback_runner_failure_retry'，断言 reason 不含 'route_unknown'、action 不是 WAIT_HUMAN_REVIEW。
#  2) 构造此前已 2 次 runner_failure → derive 返回 WAIT_HUMAN_REVIEW + reason='callback_runner_failure_exhausted'。
#  3) 回归：evaluator/judge 既有 runner_failure 有界重派断言仍绿。
# 执行：npx vitest run tests/gp/f1/step3-runner-failure-retry.test.js
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/ 后端调度决策层（derive.js），无 UI/远端 agent/engine 介入，纯自治后端。
## target_environment: local_api
## target_environment_reason: 验收为本地 evaluator 跑 vitest 真 derive 断言 + curl localhost:5221，无需真机/浏览器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: F1-S3
