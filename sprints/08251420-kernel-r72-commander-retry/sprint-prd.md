# Sprint PRD — commander lease 过期自动重派（有界），根除每轮 route_unknown 人审

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（无人值守自举链路补齐最后一块石头）

## 背景

自举第一刀。r70/r71 连续两轮生产实证：kernel commander 的 attempt 被 lease 过期收割
（`effect:expired_attempt_reconciled`，`failure_class=infrastructure_blocked`，
signature=`worker_attempt_replacement_required_after_lease`），
`infrastructureRetryForCallback` 对 `role='commander'` 无重试路由（`INFRA_RETRY_ACTION_BY_ROLE`
唯一缺席的角色）→ 返回 null → derive 落进 `wait:human_review(callback_infrastructure_route_unknown)`
→ 每轮都要人批一次 diagnostic 才能续跑。#5058 已修消费锚，但根因（commander 缺重试路由）未除。
planner/proposer/evaluator/judge 等角色都已有重试路由，commander 是唯一漏网。

## Golden Path（核心场景）

系统从 [commander attempt 被 lease 过期收割] → 经过 [derive 纯函数按 decision_log 时序判定重派] → 到达 [同 run 内自动重派 commander，续主链，不挂人审]

具体：
1. [触发条件] decision_log 出现 `spawn:commander`，随后出现
   `effect:expired_attempt_reconciled`（detail: `role=commander`, `status=failed`,
   `failure_class=infrastructure_blocked`），且该收割行未被消费、晚于最近一次 spawn。
2. [系统处理] derive 识别 commander 为 infrastructure 重试角色，按当前 phase 重派 commander
   （commander 是监理角色，重派安全、无副作用），reason 归入 `callback_infrastructure_blocked` 同族。
3. [可观测结果] derive 返回重派 commander 的 action（非 `wait:human_review`），主链继续，无人工介入。

## 边界情况

- **有界兜底**：同一 run 内 commander 的 infrastructure 类失败（expired/failed + infrastructure_blocked）
  累计达上限（5 次）后，仍返回 `wait:human_review`，reason 保持 route_unknown 语义并带触发 callback hop 锚
  （fail-closed，禁止无限重派）。
- **角色隔离**：非 commander 角色（planner/proposer/evaluator…）的重试语义完全不变。
- **失败类隔离**：非 infrastructure 类失败（runner_failure / account_exhausted / 产品失败 / needs_context）
  的 commander 路由语义完全不变。
- **纯函数可重放**：只依赖 `orchestrator_decision_log` 行时序，不引入任何新状态存储。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/derive.js` 内 commander 角色的 infrastructure 重试路由与有界计数。
- 复刻 r70/r71 场景的冻结回归测试（RED 先行）。

**不在范围内**：
- 不改 lease 时长 / 收割器（reconciler）本身。
- 不动回执传输层（错误码 `worker_attempt_replacement_required_after_lease` 的深根因另立任务）。
- 不改 diagnostic 人审批准消费逻辑（#5058 已闭环）。

## 假设

- [ASSUMPTION: 重派上限取 5 次（thin_prd 建议值），计数口径 = 同 run 内 role=commander 且
  failure_class=infrastructure_blocked 的历史收割/失败回调条数]
- [ASSUMPTION: commander 重派用「按当前 phase 重派」语义，重试 phase/action 由 proposer 在 GAN 阶段
  读 constants.js/commander 派发路径后 codify；planner 只锚定「重派 commander、不挂人审」的可观测行为]
- [ASSUMPTION: 新测试文件名 `step3-commander-infra-retry-bounded.test.js`，避让 main 上
  step3-route-unknown-review-approve-consume.test.js 等同族文件]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：commander 纳入 infrastructure 重试路由 + 有界计数。
- `tests/gp/f1/step3-commander-infra-retry-bounded.test.js`：RED 先行冻结回归测试。
- `packages/brain/package.json` + `package-lock.json` + `.brain-versions` + `DEFINITION.md`：版本 bump 四处同步。
- `sprints/08251420-kernel-r72-commander-retry/**`：合同四件套（sprint-prd/contract-draft/contract-dod/DoD.md）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 sprint 查得空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；纯函数判定无延迟约束）
- 频控: 重派上限 5 次/run（PrepPRD 显式，fail-closed 兜底）
- 版本要求: Brain 版本 bump 四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
- 可观测: 重派与超限兜底均落 orchestrator_decision_log；route_unknown 请求行必须带触发 callback hop 锚

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant + 本 sprint thin_prd 铁律；本 line 无干净结构化 invariant，采用任务显式铁律 -->
- [fail-closed] 达重派上限后必须回落 `wait:human_review`，禁止无限重派（来源: thin_prd）
- [纯函数] 只依赖 orchestrator_decision_log 行时序，禁止引入新状态存储（来源: thin_prd）
- [消费锚] route_unknown 人审请求行必须带触发 callback hop 锚，否则批准永不消费死等（来源: derive.js r70 案卷）
- [角色隔离] 非 commander 角色重试语义不得被本 sprint 改动（来源: thin_prd 负向要求）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 下无 done/working ability -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入本地 node/vitest 真跑 derive.js 的验证脚本
# 期望验收点（自然语言）：
#   1. RED 复刻 r70：spawn:commander → effect:expired_attempt_reconciled(commander, infrastructure_blocked)
#      → 修前 derive 返回 wait:human_review(callback_infrastructure_route_unknown)。
#   2. 修后：同场景 derive 重派 commander（非 human_review），reason=callback_infrastructure_blocked。
#   3. 负向：累计达 5 次后仍 wait:human_review（route_unknown，带 callback hop 锚）。
#   4. 负向：非 commander 角色、非 infrastructure 类失败语义不变。
#   5. 测试真 import packages/brain/src/orchestrator/derive.js，禁 mock 被改的边。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/ 的 kernel 编排纯函数 derive.js，无 UI/无远端 agent 协议，属后端自主决策。
## target_environment: local_api
## target_environment_reason: 验收为本地 evaluator 直跑 vitest 真 import derive.js（node 纯函数测试），无需远端机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
