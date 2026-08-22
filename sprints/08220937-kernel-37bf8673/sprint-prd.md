# Sprint PRD — publisher 进 INFRA_RETRY_ACTION_BY_ROLE，runner_failure 有界重派不再 route_unknown

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+0.5%（补齐 harness kernel 有界重派角色覆盖，减少假终态烧 run）

## 背景

runner_failure = 基础设施故障（容器/guard/依赖装配起不来），不是产品失败。derive 已为 evaluator/judge/generator 等角色配置有界重派（≤2 次同角色重试，超限进人审兜底），但 `INFRA_RETRY_ACTION_BY_ROLE` 缺少 `publisher` 条目。当 publisher 角色回调 runner_failure 时，`infrastructureRetryForCallback` 返回 undefined → derive 落进 `callback_runner_failure_route_unknown` 分支，把本可重派的一次性 runner 抖动误判为需人审，浪费一轮 run。本 sprint 把 publisher 补入该表，使其与 evaluator/judge 同等享受有界重派。

（r45：r43/r44 同任务前两跑死于投影换代窗口竞态 `impact_anchor_missing`，#5017 已修（1.273.117）；本轮为同任务第 3 跑，仅补 publisher 重派条目本身。）

## Golden Path（核心场景）

系统从 [publisher 回调 runner_failure] → 经过 [derive 查历史 runner_failure 计数并取角色重派动作] → 到达 [返回 publish 重派动作或人审兜底]

具体：
1. [触发条件] 一次 attempt callback 到达，`status=failed`、`failure_class=runner_failure`、`role=publisher`
2. [系统处理] derive 统计本 run 内 hop 更早的 runner_failure 次数（priorRunnerFailures，计数逻辑不动）；<2 次时查 `INFRA_RETRY_ACTION_BY_ROLE['publisher']` 取得 `{ phase: 'publish', action: 'publish:approved_ref' }`
3. [可观测结果] derive 返回 `{ phase: 'publish', action: 'publish:approved_ref', reason: 'callback_runner_failure_retry' }`；不再返回 `reason: 'callback_runner_failure_route_unknown'`。第 3 次仍走 `callback_runner_failure_exhausted` 进人审（有界语义不变）

## 边界情况

- publisher 首次 runner_failure（priorRunnerFailures=0）→ 重派 publish，不判终态
- publisher 第 3 次 runner_failure（priorRunnerFailures≥2）→ `wait:human_review`，reason `callback_runner_failure_exhausted`（兜底不变）
- 其它角色（evaluator/judge/generator）的既有重派行为不得回退（回归保护）
- runner_failure 计数只统计 hop 更早、同为 runner_failure 的 ATTEMPT_CALLBACK，publisher 的加入不改变该计数口径

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE` 增加 `publisher: { phase: 'publish', action: ACTION.PUBLISH_APPROVED_REF }`
- 新增/补充回归测试覆盖 publisher runner_failure 的 RED→GREEN

**不在范围内**：
- priorRunnerFailures 计数逻辑（不动）
- 账号轮换 / account_exhausted 语义（那是另一族）
- 投影换代窗口竞态 impact_anchor_missing（#5017 已修，非本 sprint）
- generator 专属的 `infrastructureRetryForCallback` 精确 dispatch 回溯逻辑（publisher 走 defaultRetry 分支，不进 generator 特判）

## 假设

- [ASSUMPTION: publisher 的重派动作复用现有常量 `ACTION.PUBLISH_APPROVED_REF`（'publish:approved_ref'），与 dispatcher.js 中 `publish:approved_ref` 路由（role=publisher）一致]
- [ASSUMPTION: publisher 不进 generator 特判分支，`infrastructureRetryForCallback` 对非 generator 角色直接返回 defaultRetry，故仅需补表即可生效]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：`INFRA_RETRY_ACTION_BY_ROLE` 增加 publisher 条目
- `tests/gp/f1/step3-runner-failure-retry.test.js`：新增 publisher runner_failure RED→GREEN 断言（首次重派 publish + 超限进人审），保留为永久回归

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（node 测试 runner 直跑 derive 纯函数守卫）
# 期望验收点（自然语言）：
#   RED（改前）：构造 publisher runner_failure 回调，derive 返回 reason='callback_runner_failure_route_unknown' → 断言失败复现 bug
#   GREEN（改后）：同输入 derive 返回 { phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }
#   有界兜底：同 run 第 3 次 publisher runner_failure → reason='callback_runner_failure_exhausted'（wait:human_review）
#   回归不退：evaluator/judge/generator 既有 runner_failure 重派断言仍全绿
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- （本 line 暂无挂载到本 step/feature 的 invariant 决策）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；derive 为纯函数，无 I/O 时延约束）
- 频控: 有界重派 ≤2 次同角色重试，超限进人审（语义既定，本 sprint 沿用）
- 版本要求: 无
- 可观测: derive 决策 reason 必须可从 decisionLog 判读（callback_runner_failure_retry / _exhausted）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端 derive 决策逻辑，无 UI/agent 协议/engine 参与
## target_environment: local_api
## target_environment_reason: 纯 Brain 内部 derive 纯函数守卫，本地 node 测试 runner 直跑（无需 curl/psql 外部依赖）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: F1-S3
