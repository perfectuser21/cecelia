# Sprint PRD — publisher 进 INFRA_RETRY_ACTION_BY_ROLE：runner_failure 有界重派不再 route_unknown

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 publisher 单点，harness run 抗基础设施抖动闭环补齐）

## 背景

r40 hop175 与 r41 生产实证：publisher 的 `runner_failure` / `infrastructure_blocked` 回调进入
`derive.js` 的 `infrastructureRetryForCallback(role,…)` 时，查 `INFRA_RETRY_ACTION_BY_ROLE`
表里**没有 `publisher` 条目** → 返回 `undefined` → derive 落 `callback_runner_failure_route_unknown`
/ `callback_infrastructure_route_unknown` → 无出口，进人审死等。judge 已 PASS、候选已就绪，
publisher 的 runner 一次没起来就把整条 run 卡成人工兜底，publisher 成为唯一没有有界重派待遇的角色。
决策 109dd8eb 批次已确立：runner_failure 是基础设施故障而非产品失败，与
`infrastructure_blocked` / `account_exhausted` 同族，应有界重派同角色（≤2 次）+ 超限人审兜底。
本 sprint 把 publisher 补进该表，使其与 evaluator/judge 同等享受该待遇。

## Golden Path（核心场景）

系统从 [publisher 回调基础设施故障] → 经过 [derive 查角色重派表命中 publisher] → 到达 [返回 publish 重派动作，不再 route_unknown]

具体：
1. [触发条件] publisher attempt 回调落库：`status='failed'`、`failure_class='runner_failure'`、`role='publisher'`（容器/guard/依赖装配起不来，非产品失败）
2. [系统处理] `derive()` → `attemptCallbackRoute()` 进 runner_failure 分支 → 调 `infrastructureRetryForCallback('publisher', …)` → 查 `INFRA_RETRY_ACTION_BY_ROLE['publisher']` **命中** `{ phase: 'publish', action: 'publish:approved_ref' }`
3. [可观测结果] derive 返回 `{ phase: 'publish', action: 'publish:approved_ref', reason: 'callback_runner_failure_retry' }`（有界重派），而非 `WAIT_HUMAN_REVIEW` + `callback_runner_failure_route_unknown`
4. [超限出口] 已发生 ≥2 次 publisher runner_failure 后，`priorRunnerFailures >= 2` 命中 → 返回 `WAIT_HUMAN_REVIEW` + `callback_runner_failure_exhausted`（人审兜底，计数语义不变）
5. [同族收益] 同一表条目一并修复 publisher 的 `infrastructure_blocked`（原 `callback_infrastructure_route_unknown`）与 `account_exhausted`（原 `callback_account_exhausted_route_unknown`）出口

## 边界情况

- publisher 连续 2 次 runner_failure：第 3 次不再重派，走人审兜底（`priorRunnerFailures` 计数逻辑与阈值不动）
- 非 publisher 角色（evaluator/judge/generator 等）路由行为必须与本改动前逐字一致（回归零漂移）
- generator 的 hop 对齐分支（`infrastructureRetryForCallback` 内 `role === 'generator'` 特判）不受影响，仍走精确 dispatch 回溯

## 范围限定

**在范围内**：`INFRA_RETRY_ACTION_BY_ROLE` 新增一条 `publisher: { phase: 'publish', action: ACTION.PUBLISH_APPROVED_REF }`；对应 RED→GREEN 回归测试落到 `tests/gp/f1/step3-*`。
**不在范围内**：修改 `priorRunnerFailures` 计数/阈值语义；改 dispatcher 的 publisher 派发规则；改其他角色条目；改 `infrastructure_blocked` / `account_exhausted` 分支的判定逻辑本体（仅受益于表补全）。

## 假设

- [ASSUMPTION: `ACTION.PUBLISH_APPROVED_REF` 常量值为 `'publish:approved_ref'`（constants.js:64 已定义），dispatcher.js 亦以该 action 派发 role=publisher，故重派动作可被正确消费]
- [ASSUMPTION: publisher 回调 detail 携带 `role: 'publisher'`，与 evaluator/judge 回调同构（`callbackDetail(row).role` 解构）]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：`INFRA_RETRY_ACTION_BY_ROLE` 新增 publisher 条目（唯一实现改动）
- `tests/gp/f1/step3-publisher-infra-retry-route.test.js`（新增，RED→GREEN 回归锚）：复现 route_unknown，验证修后返回 publish 重派 + 超限人审

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + feature 双源均返回空数组），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；纯内存 derive 决策，无 IO）
- 频控: 有界重派 ≤2 次/角色（复用既有 `priorRunnerFailures` 阈值，不新增）
- 版本要求: 无
- 可观测: derive 返回的 `reason` 字段是唯一决策留痕（`callback_runner_failure_retry` / `callback_runner_failure_exhausted`），测试须断言该字段

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 级空）；仅列与本 kernel 改动直接相关者 -->
- [基础设施重派身份] generator/基础设施类重派必须保持同角色身份，不轮换账号（来源: area — generator_infrastructure_retry_identity）
- [回归用源码巡检] 调度接线类回归用 source-code inspection 验证比 mock 覆盖更直接有效（来源: area）
- [真环境验证] 真环境验证才算 done，禁止写死环境假设值（来源: area — [系统]）
- [测试多租户] 测试默认多租户；租户隔离、端点鉴权、凭据安全、日志脱敏为系统级铁律（来源: area — [系统]）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 journey 已完成 ability 的 golden_path；本 journey 现存 ability 均为 planned 态，无已验收行为 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入 local_api 脚本（vitest 真 derive，不 stub attemptCallbackRoute）
# 期望验收点（自然语言）：
#  RED（修前）：构造 publisher runner_failure 回调 → derive 返回 action=wait:human_review、
#              reason=callback_runner_failure_route_unknown（复现单点死等）。
#  GREEN（修后）：
#   ① 首次 publisher runner_failure 回调 → derive 返回 { phase:'publish',
#      action:'publish:approved_ref', reason:'callback_runner_failure_retry' }。
#   ② 已有 ≥2 次 publisher runner_failure → derive 返回 wait:human_review +
#      reason=callback_runner_failure_exhausted（超限人审兜底，计数语义不变）。
#   ③ 回归：evaluator/judge 同场景路由逐字不变（非 publisher 角色零漂移）。
#  命令形态：npx vitest run tests/gp/f1/step3-publisher-infra-retry-route.test.js
```

## journey_type: autonomous
## journey_type_reason: 改动仅落 packages/brain/ 后端 orchestrator/derive.js，纯调度决策逻辑，无 UI / 远端 agent 协议 / engine hooks。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；纯 Node 单测（vitest 真 derive）在本地 evaluator 跑，无需真机/浏览器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: L-F1-S3（F1「工厂·开发闭环」步骤 3「造完真验」— attempt callback ↔ derive 决策边）
