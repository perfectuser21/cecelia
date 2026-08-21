# Sprint PRD — publisher 进 INFRA_RETRY_ACTION_BY_ROLE：runner_failure 有界重派不再 route_unknown

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（kernel harness 有界重派覆盖 publisher 角色，减少整跑因基础设施瞬态故障作废）

## 背景

`packages/brain/src/orchestrator/derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE` 映射表当前登记了 planner/proposer/reviewer/generator/evaluator/judge/reporter 七个角色，唯独漏了 `publisher`。当 publisher 角色的 attempt 回调以 `runner_failure`（基础设施故障，非产品失败）结束时，`derive` 进入 runner_failure 分支调用 `infrastructureRetryForCallback('publisher', ...)`，因映射缺失返回 undefined，随即命中 `!retry` 兜底，产出 `callback_runner_failure_route_unknown` —— 整条 run 被判死。r40 hop175 / r41 hop54 均实证此 route_unknown 死法。本轮（r44）功能同 r43：给 publisher 补上重派动作，使其与 evaluator/judge 同等享受有界重派（≤2 次）+ 超限人审兜底。

## Golden Path（核心场景）

系统从 [publisher runner_failure 回调] → 经过 [derive 查表得到 publish 重派动作] → 到达 [返回 publish 重派而非 route_unknown]

具体：
1. [触发条件] 某 publisher attempt 以 `status='failed'`、`failure_class='runner_failure'` 回调，且此前该 run 的 publisher runner_failure 次数 < 2
2. [系统处理] derive 进入 runner_failure 分支，`infrastructureRetryForCallback('publisher', ...)` 从 `INFRA_RETRY_ACTION_BY_ROLE` 命中 `publisher: { phase: 'publish', action: 'publish:approved_ref' }`
3. [可观测结果] derive 返回 `{ phase: 'publish', action: 'publish:approved_ref', reason: 'callback_runner_failure_retry' }`；不再返回 `callback_runner_failure_route_unknown`
4. [超限兜底] 当同一 run 的 publisher runner_failure 已累计 ≥ 2 次，derive 返回 `{ phase: 'review', action: WAIT_HUMAN_REVIEW, reason: 'callback_runner_failure_exhausted' }`（复用既有超限逻辑，语义不变）

## 边界情况

- publisher runner_failure 恰好第 3 次（priorRunnerFailures ≥ 2）→ 走人审兜底，不再重派
- 其它 failure_class（如 semantic_refusal / 无 failure_class 的普通 failed）→ 不受本次改动影响，仍走原有路由
- 非 publisher 角色的 runner_failure → 行为完全不变（回归保护）

## 范围限定

**在范围内**：仅在 `INFRA_RETRY_ACTION_BY_ROLE` 增加一行 `publisher: { phase: 'publish', action: ACTION.PUBLISH_APPROVED_REF }`；配套 RED→GREEN 回归测试。
**不在范围内**：重派额度语义（≤2 次上限、人审兜底阈值）改动；其它角色映射；publisher 派发/执行逻辑；dispatcher/attempt-store 改动。

## 假设

- [ASSUMPTION: `ACTION.PUBLISH_APPROVED_REF`（值 `'publish:approved_ref'`，constants.js:64）与 phase `'publish'` 为 publisher 的既有派发动作，dispatcher.js:118 的 `'publish:approved_ref'` role=publisher 已支撑重派落地，无需新增 action 枚举]
- [ASSUMPTION: 重派额度上限沿用现有 runner_failure 分支的 `priorRunnerFailures >= 2` 判定，publisher 与 evaluator/judge 共用同一有界重派计数逻辑]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`: 在 `INFRA_RETRY_ACTION_BY_ROLE`（约 240-248 行）增加 publisher 条目
- `packages/brain/src/orchestrator/__tests__/`（或 `tests/gp/f1/`）: 新增 publisher runner_failure 重派回归测试（RED 复现 route_unknown，GREEN 断言 publish 重派）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入 local_api 脚本（node --test 跑 derive 单测 + 断言）
# 期望验收点（自然语言）：
#   RED — 未加 publisher 映射时，对 publisher runner_failure 回调调用 derive，返回 reason='callback_runner_failure_route_unknown'（复现 r40/r41 死法）
#   GREEN — 加 publisher 映射后，同输入 derive 返回 { phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }
#   回归 — publisher runner_failure ≥2 次时返回 reason='callback_runner_failure_exhausted'（人审兜底）；非 publisher 角色路由不变
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + feature 双源均为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 有界重派 ≤2 次（沿用 runner_failure 分支既有上限，非本 sprint 新增 NFR）
- 版本要求: 无
- 可观测: derive 返回的 reason 字段必须区分 retry / exhausted / route_unknown，供决策日志留痕归因

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [重试身份] 基础设施失败必须重试原始服务端派发动作，不得静态误映射到不同动作导致候选不存在时 WORKSPACE_RESOLUTION_FAILED（来源: area，generator_infrastructure_retry_identity）
- [Planner分支] Planner workspace 必须停在服务端签发的 planner_branch，Provider 可校验但不得 checkout/switch（来源: area，planner_role_branch）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 改动仅在 packages/brain/ 后端 orchestrator/derive.js，无 UI/agent 协议/engine 触及，命中 autonomous 默认分支
## target_environment: local_api
## target_environment_reason: payload 显式提供 target_environment=local_api；纯 Brain kernel 逻辑，本地 evaluator 跑 node 单测即可验证
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
