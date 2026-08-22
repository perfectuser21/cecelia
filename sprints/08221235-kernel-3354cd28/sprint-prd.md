# Sprint PRD — publisher 纳入 INFRA_RETRY_ACTION_BY_ROLE：runner_failure 有界重派，不再 route_unknown

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（收敛 kernel 编排最后一个 runner_failure 死角）

## 背景

runner_failure = 基础设施故障（容器/guard/依赖装配起不来），不是产品失败。决策 109dd8eb
批次已定：与 infrastructure_blocked / account_exhausted 同族——有界重派同角色（≤2 次），
超限进人审兜底。derive.js 里 evaluator/judge/generator 已挂进 `INFRA_RETRY_ACTION_BY_ROLE`，
唯独 **publisher 缺表项**：publisher 的 runner 起不来时（judge 已 PASS、候选已授权），
`infrastructureRetryForCallback('publisher', …)` 返回 undefined → derive 落
`callback_runner_failure_route_unknown` 进人审，享受不到与 evaluator/judge 同等的有界重派。
本 sprint 补齐 publisher，语义与其他角色一致。

本轮为同任务第 4 跑（r46）。r45 死于合同缺 `## Test Contract` 表 × 冻结守卫死锁（#5019 /
1.273.118 已修）。故本合同**必须**含 `## Test Contract` 表登记全部冻结测试。冻结纪律：run
在途 Commander 不合任何 PR。

## Golden Path（核心场景）

系统从 [publisher 回调 runner_failure] → 经过 [derive 查 INFRA_RETRY_ACTION_BY_ROLE] →
到达 [返回 publish 重派动作，不再 route_unknown]

具体：
1. [触发条件] publisher attempt callback 回来 `status=failed, failure_class=runner_failure,
   role=publisher`，且本 run 之前 publisher runner_failure 次数 < 2。
2. [系统处理] derive 走 runner_failure 分支 → `infrastructureRetryForCallback('publisher', …)`
   命中 `INFRA_RETRY_ACTION_BY_ROLE.publisher = { phase: 'publish', action: 'publish:approved_ref' }`。
3. [可观测结果] derive 返回 `{ phase: 'publish', action: 'publish:approved_ref',
   reason: 'callback_runner_failure_retry' }`——同 run 有界重派 publisher，`reason` 不再是
   `callback_runner_failure_route_unknown`。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **超限**：第 3 次 publisher runner_failure（priorRunnerFailures ≥ 2）→ 仍走既有
  `callback_runner_failure_exhausted` 进人审，补表不改超限兜底语义。
- **额度不变**：≤2 次重试计数口径沿用现有 `priorRunnerFailures`，不新增额度。
- **非 runner_failure**：publisher 的 blocked / semantic_refusal / 普通 failed 走各自既有分支，不触碰。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE` 增加一行
  `publisher: { phase: 'publish', action: ACTION.PUBLISH_APPROVED_REF }`。
- 冻结回归测试：RED 复现 publisher runner_failure → route_unknown，GREEN 后返回 publish 重派。

**不在范围内**：
- 不改 runner_failure 重派额度（≤2 次）语义、不改超限人审兜底逻辑。
- 不动 generator 的特殊 dispatch 回溯分支、不动 account_exhausted / infrastructure_blocked 分支。
- 不改 publisher 的授权/merge fence 逻辑（dispatcher.js publisher_judge_authority）。

## 假设

- [ASSUMPTION: publisher 重派动作为 `publish:approved_ref`（ACTION.PUBLISH_APPROVED_REF），
  与 derive.js:1358 及 workspace-spec/dispatcher 里 publisher 既有 action 一致，非 spawn:*]。
- [ASSUMPTION: publisher 无需 generator 那种"按 dispatch hop 回溯"特殊处理，走 defaultRetry 直取表项]。

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`: `INFRA_RETRY_ACTION_BY_ROLE` 增 publisher 表项。
- `tests/gp/f1/step3-*.test.js`（新增冻结测试，proposer 定名）: RED→GREEN 守卫 publisher 重派路由。

## Test Contract 表要求（1.273.118 封印硬闸）

> proposer 的 contract-draft.md **必须**含 `## Test Contract` 表逐条登记本 sprint 全部冻结测试
> （Behavior | Test File | Case）。缺表 / rows=0 触封印校验拒绝打回 proposer（r45 死锁根因闸）。

## E2E 验收

```bash
# 占位：proposer 按 target_environment=local_api 填真实脚本（vitest 直跑 derive 单测）。期望验收点：
#   1. RED —— 未加表项时 publisher runner_failure 经真 derive 返回 reason=callback_runner_failure_route_unknown。
#   2. GREEN —— 加表项后同输入返回 { phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }。
#   3. 超限守恒 —— 第 3 次 publisher runner_failure 仍返回 callback_runner_failure_exhausted 进人审。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [重派同族] runner_failure 与 infrastructure_blocked / account_exhausted 同族：有界重派同角色 ≤2 次，超限进人审，不轮换账号、不无限重试（来源: journey_feature 决策 109dd8eb 批次）
- [基础设施重试身份] generator_infrastructure_retry_identity —— 基础设施重派复用同角色相位/动作，不变更执行身份（来源: area）
- [冻结在途] run 在途 Commander 不合任何 PR，冻结纪律（来源: area）
- [封印强制登记] 合同 `## Test Contract` 表必须登记全部冻结测试，缺表拒封印打回 proposer（来源: journey_feature #5019 / 1.273.118）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- runner_failure 有界重派: evaluator/judge/generator 等角色 runner_failure 首次→同 run 重派同角色（reason=callback_runner_failure_retry），第 3 次→进人审（callback_runner_failure_exhausted），本 sprint 只补 publisher，不得回退这些行为
- 封印强制表登记: 合同缺 `## Test Contract` 表拒封印打回 proposer（#5019 / 1.273.118），本 sprint 合同须自身满足此闸

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 重派 ≤2 次（沿用既有额度，不新增）
- 可观测: derive reason 字段必须可区分 route_unknown / retry / exhausted 三态

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 编排层 derive.js，纯后端调度决策，无 UI/agent 协议
## target_environment: local_api
## target_environment_reason: 纯 Brain 编排单测，本地 vitest + derive.js 直跑（无需真机/浏览器）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: F1-step3
