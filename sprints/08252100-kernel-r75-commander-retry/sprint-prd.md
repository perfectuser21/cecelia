# Sprint PRD — commander lease 过期自动重派（有界），根除每轮 route_unknown 人审 [r75]

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（补上无人值守闭环最后一块石头：commander 过期不再逐轮拦人审）

## 背景

第四次点火本主题。r70–r74 五轮生产实证：kernel commander attempt 被 lease 过期收割
（`effect:expired_attempt_reconciled`，`failure_class=infrastructure_blocked`，
`signature=worker_attempt_replacement_required_after_lease`）后，`infrastructureRetryForCallback`
对 `role='commander'` 无重试路由 → 直接 `wait:human_review(callback_infrastructure_route_unknown)`，
每一轮都需人工批准。r74（run 4ee28e74）合同矛盾已消解、实现+fix 链正常，死于新病：fix 源
workspace 被过早回收（`workspace_source_attempt_unavailable`，已立 issue，属基础设施层，非本功能范围）。
本轮同 r74 合同口径干净重跑。

## Golden Path（核心场景）

系统从 [commander attempt 过期收割] → 经过 [infrastructure 重试路由] → 到达 [自动重派或有界兜底人审]

具体：
1. [触发] `orchestrator_decision_log` 出现一条 commander 过期收割行
   （`effect:expired_attempt_reconciled` + `role=commander` + `failure_class=infrastructure_blocked`）。
2. [系统处理·少量失败] 同 run 内 commander infrastructure 类失败累计 < 5 → derive 判定按当前 phase
   **自动重派 commander**（监理角色重派安全无副作用），不再落人审。
3. [系统处理·达上限] 累计达 5 次 → fail-closed 兜底，仍走 `wait:human_review`
   `route_unknown`，且决策对象带 `callbackHop`（与 #5058 消费锚兼容）。
4. [可观测出口] 现状（未修）单条 expired → `wait:human_review`；修后单条 expired → 重派；
   全部通过真 `derive()` 纯函数从 decisionLog 行时序确定性推导，可重放。

## 边界情况

- 达上限（5 条 expired 行）仍必须 wait+callbackHop，禁止无界重试。
- 非 commander 角色（如 publisher/runner）的现有路由语义不得改变。
- 非 infrastructure 类失败（如 auth/内容失败）的现有语义不得改变。
- 只依赖 decisionLog 行时序，无外部时钟/随机/IO 依赖。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/derive.js`：commander 纳入 infrastructure 重试路由 + 有界（上限 5）兜底。
- 新增 RED 回归测试（`tests/gp/f1/step3-commander-lease-expired-retry.test.js`，真 import derive，禁 mock 被改边）。
- 同步更新既有回归测试 `tests/gp/f1/step3-route-unknown-review-approve-consume.test.js`（#5058）：
  首用例 decisionLog 扩为「已达重试上限（5 条 expired 行）」场景（断言语义不变：上限后 wait + callbackHop）；
  少量失败（<5）新期望=重派 commander。
- 版本 bump 四处 + DoD.md + sprint 目录。

**不在范围内**：
- 不改 lease 时长 / 收割器 / 回执传输层 / workspace 回收策略（各自另立任务）。
- 不改 diagnostic 批准消费函数本体（#5058 消费锚只对齐，不改本体）。

## 假设

- [ASSUMPTION: 重试上限固定为 5 次（thin_prd 明确），按 run 内 commander infrastructure 类失败计数。]
- [ASSUMPTION: 新测试框架沿用既有 vitest；import 路径 `../../../packages/brain/src/orchestrator/derive.js`。]
- [ASSUMPTION: 新文件名 `step3-commander-lease-expired-retry.test.js`，已核对与 tests/gp/f1/ 现有 9 个同族文件无碰撞。]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：commander 加入 infrastructure 重试路由 + 有界兜底逻辑。
- `tests/gp/f1/step3-commander-lease-expired-retry.test.js`（新建）：RED 先行，单条 expired→重派 / 达上限→wait+callbackHop / 负向。
- `tests/gp/f1/step3-route-unknown-review-approve-consume.test.js`（更新）：首用例扩为达上限场景。
- `packages/brain/package.json` / `packages/brain/package-lock.json` / `.brain-versions` / `DEFINITION.md`：版本 bump 四处同步。
- `DoD.md`、`sprints/08252100-kernel-r75-commander-retry/**`：合同四件套。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 双源均空；以下取自 thin_prd 显式约束 -->
- 重试上限: 同 run 内 commander infrastructure 类失败累计上限 = 5 次（有界，硬编码语义）
- 确定性: derive 纯函数，只依赖 `orchestrator_decision_log` 行时序，可重放（无时钟/随机/IO）
- 兼容: 达上限后的 route_unknown 决策对象带 `callbackHop`，与 #5058 消费锚兼容
- 版本要求: 版本 bump 四处同步（package.json/package-lock.json/.brain-versions/DEFINITION.md）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 源空；area 源为 credential 隔离与本纯函数改动无交集，仅留痕。以下铁律取自本 sprint 合同 + #5058 -->
- [fail-closed] commander infra 重试达上限（5）后必须 `wait:human_review` route_unknown，禁止无界重试（来源: 本 sprint 合同）
- [callbackHop锚] 上限后 route_unknown 决策对象必须带 `callbackHop`，与 #5058 消费锚兼容（来源: journey_feature #5058）
- [纯函数可重放] derive 只依赖 orchestrator_decision_log 行时序，禁引入外部状态（来源: 本 sprint 合同）
- [角色语义不变] 非 commander 角色 / 非 infrastructure 类失败的现有路由语义不得回退（来源: 本 sprint 合同）
- [多账号授权隔离] 多人协作禁混用授权凭据（来源: area — 与本 kernel 纯函数改动无交集，留痕不适用）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths 全部 status=planned（ZenithJoy Agent 产品线），无 done/working 已验收行为可锚 -->
- （本 line 暂无已验收历史）

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（vitest 直跑）。

```bash
# 占位：proposer 将填入真实脚本（local_api → 本地 vitest 直跑，无需起服务）
# 期望验收点（自然语言）：
#  1) RED：新测试在未改 derive 前，单条 expired commander → 现状 wait:human_review（红）。
#  2) GREEN：改 derive 后，单条 expired（<5）→ 重派 commander；达上限（5 条 expired）→ wait+callbackHop。
#  3) 回归：更新后的 step3-route-unknown-review-approve-consume.test.js 通过（上限场景 wait+callbackHop 语义不变）。
#  4) 负向：非 commander 角色、非 infrastructure 类失败语义不变，全部绿。
#  5) 全部经真 derive() 从 decisionLog 行推导，禁 mock 被改边。
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/src/orchestrator/derive.js 纯后端路由决策 + 后端测试，无 UI/agent 协议/engine hook。
## target_environment: local_api
## target_environment_reason: 纯函数 vitest 单测，本地 evaluator 直跑（node/vitest tests/gp/f1），无需起服务或远端机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
