# Sprint PRD — commander lease 过期自动重派（有界），根除每轮 route_unknown 人审 [r73]

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（补齐无人值守 kernel 最后一块石头——commander 角色重试路由缺席）

## 背景

r70/r71/r72 三轮实证：kernel commander attempt 被 lease 过期收割
（`effect:expired_attempt_reconciled`，`failure_class=infrastructure_blocked`，
signature=`worker_attempt_replacement_required_after_lease`）后，
`infrastructureRetryForCallback(role='commander', …)` 因 `INFRA_RETRY_ACTION_BY_ROLE`
无 commander 键返回 undefined → derive 落 `wait:human_review`
（reason=`callback_infrastructure_route_unknown`）→ 每轮都要人批一次 diagnostic。
八角色（planner/proposer/reviewer/generator/evaluator/judge/publisher/reporter）都已有
重试路由，commander 是唯一缺席者。r72 全程通过但死于毕业步产物被 impact gate
误杀（已由 #5063 修复，Brain 1.273.139 已部署），本轮干净重跑。

## Golden Path（核心场景）

系统从 [commander attempt 被 lease 过期收割] → 经过 [derive 纯函数按 phase 有界重派 commander] → 到达 [主链续跑，不再落人审]

具体：
1. [触发条件] orchestrator_decision_log 出现 `spawn:commander` 后紧跟
   `effect:expired_attempt_reconciled`（role=commander、status=failed、
   failure_class=infrastructure_blocked）——即 commander lease 过期终态回调。
2. [系统处理] derive 识别 commander 为 infrastructure 类失败，按当前 phase
   重派 commander（commander 是监理角色，重派无副作用）；重试有界：同 run 内
   commander infrastructure 类失败累计达上限（5 次）后不再重派。
3. [可观测结果]
   - 未达上限：derive 返回重派 commander 的 action（reason 归属 infrastructure 重试族），
     主链续跑，日志不出现 `wait:human_review`。
   - 达到上限：derive 仍返回 `wait:human_review`
     （reason=`callback_infrastructure_route_unknown`，带 callbackHop 锚），fail-closed 兜底。

## 边界情况

- **达上限后**：第 6 次 commander infra 失败仍走 route_unknown 人审（禁止无限重派）。
- **非 commander 角色**：planner/generator 等既有角色的重试语义完全不变。
- **非 infrastructure 类失败**：commander 的 semantic_refusal / runner_failure / account_exhausted / needs_context 等其它失败类语义完全不变。
- **纯函数可重放**：只依赖 `orchestrator_decision_log` 行时序统计历史失败次数，不引入新状态存储、不改 lease 时长与收割器。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/derive.js`：commander 纳入 infrastructure 重试路由，重试有界（上限 5）。
- Brain 版本四处 bump + DoD + 冻结测试。

**不在范围内**：
- 不改 lease 时长 / 收割器（expired-attempt-reconciler）本身；不动回执传输层（execution-transport，深根因另立任务）。
- 不改 diagnostic 人审批准消费逻辑（#5058 已闭环）；不动 account_exhausted / runner_failure / semantic_refusal 既有分支。

## 假设

- [ASSUMPTION: commander 重试上限取 5 次（thin_prd 建议值），达上限后回落 route_unknown 人审。]
- [ASSUMPTION: 重派用 `spawn:commander` action、沿用当前 commander 监理相位；具体常量由 Proposer 读代码后 codify。]
- [ASSUMPTION: 失败计数口径 = 同 run 内 role=commander 且 failure_class=infrastructure_blocked 的 expired/failed 回调数，与 runner_failure 的 priorRunnerFailures 同构。]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：为 commander 增加 infrastructure 重试路由 + 有界计数（唯一实现文件）。
- `tests/gp/f1/step3-commander-infra-retry-r73.test.js`：RED→GREEN 冻结测试（真 import derive.js，禁 mock 被改边；文件名避让 main 已毕业的 `step3-commander-infra-retry-bounded`）。
- `packages/brain/package.json` / `packages/brain/package-lock.json` / `.brain-versions` / `DEFINITION.md`：Brain 版本四处同步 bump。
- `DoD.md`：本 sprint DoD→Test 映射。
- `sprints/08251720-kernel-r73-commander-retry/**`：合同四件套落地。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；纯函数无网络调用，无延迟约束）
- 频控: commander infrastructure 类重试上限 = 5 次/run（fail-closed 兜底，禁止无限重派）
- 版本要求: Brain 版本四处同步（package.json + package-lock.json + .brain-versions + DEFINITION.md）
- 可观测: 达上限落 `wait:human_review` 必须带 callbackHop 锚（承接 r70 案卷双锚定要求）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [纯函数可重放] derive 只依赖 orchestrator_decision_log 行时序，不得引入新状态存储（来源: 本 sprint thin_prd 硬约束，承接 kernel 纯函数契约）
- [fail-closed] 有界重试上限触顶后必须回落人审，禁止无限重派（来源: 本 sprint thin_prd 硬约束）
- [凭据隔离] 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无已验收历史：journey e6f803f2 下 ability 均为 planned 状态，无 done/working 累积 FR）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（node 运行冻结测试真 import derive.js）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. RED：复刻 r70 场景（spawn:commander → effect:expired_attempt_reconciled commander/infrastructure_blocked），现状 derive 返回 wait:human_review(callback_infrastructure_route_unknown)。
# 2. GREEN：同场景修后 derive 返回重派 commander 的 action（reason 属 infrastructure 重试族），主链续跑不落人审。
# 3. 负向①：commander infra 失败达上限（第 6 次）仍返回 wait:human_review，带 callbackHop 锚。
# 4. 负向②：非 commander 角色 infra 重试路由输出不变；负向③：commander 非 infra 类失败路由不变。
```

## journey_type: autonomous
## journey_type_reason: 改动纯落在 packages/brain/src/orchestrator/ kernel 纯后端 derive 逻辑，无 dashboard/agent-bridge/engine 触点，属自治后台调度。
## target_environment: local_api
## target_environment_reason: 验收为 node 单测真 import derive.js 纯函数，在本地 evaluator 执行（无需 UI/远端机器/微信/Windows）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
