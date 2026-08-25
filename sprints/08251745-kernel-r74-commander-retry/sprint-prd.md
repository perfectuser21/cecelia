# Sprint PRD — commander lease 过期自动重派（有界），根除每轮 route_unknown 人审 [r74]

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（补上无人值守闭环最后一块石头：commander 过期不再每轮挂人审）

## 背景

kernel 编排器 `derive.js` 的 `attemptCallbackRoute` 对 infrastructure 类失败按角色查 `INFRA_RETRY_ACTION_BY_ROLE` 重派；该表含 planner/proposer/reviewer/generator/evaluator/judge/publisher/reporter，**独缺 commander**。故 commander attempt lease 过期被收割器 reconcile（`effect:expired_attempt_reconciled`, `failure_class=infrastructure_blocked`）后 `infrastructureRetryForCallback` 返回 undefined → 直接 `wait:human_review`（`callback_infrastructure_route_unknown`），每轮都要人审，破坏 zero-human-gate。commander 是监理角色，重派安全无副作用，应纳入有界重试。

本主题第三次点火：r73（run da3aa553）死于合同与 #5058 回归测试行为矛盾——r73 冻结测试要求「commander 过期→重派」，而 main 上 #5058 的 `step3-route-unknown-review-approve-consume.test.js` 第一个用例逐字节断言「单条 commander 过期 → wait:human_review + callbackHop=112」。两铁律相反 → CONTRACT_SELF_CONTRADICTION。本轮显式授权 claim 并更新该既有测试，从合同层消解矛盾。

## Golden Path（核心场景）

系统从 [commander attempt lease 过期] → 经过 [derive 纯函数按累计失败次数分流] → 到达 [未达上限自动重派 / 达上限 fail-closed 挂人审带锚]

具体：
1. commander attempt lease 过期被收割器 reconcile，orchestrator_decision_log 落 `effect:expired_attempt_reconciled` 行（`role=commander`, `status=failed`, `failure_class=infrastructure_blocked`）。
2. derive 重放该 run 的 decisionLog，统计本 run 内 commander infrastructure 类失败累计条数。
3. 累计 **< 5**：路由到重派 commander（按当前 phase 的 commander 派发动作），run 继续，**不挂人审**。
4. 累计 **≥ 5**（fail-closed 兜底）：`wait:human_review`，`reason=callback_infrastructure_route_unknown`，决策对象带 `callbackHop=Number(row.hop)`——与 #5058 diagnostic 消费锚兼容，人审批准后可被正常消费出口。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 恰好第 5 次失败的边界（第 5 条 expired 行触发挂人审，第 4 条仍重派）。
- 非 commander 角色（generator/publisher 等）语义**完全不变**：仍走各自既有重试/route_unknown 路径。
- 非 infrastructure 类失败（needs_context / account_exhausted / semantic_refusal / 合同故障码）语义**完全不变**。
- 达上限后落的人审请求行仍带 `callbackHop`，人 approve 后 #5058 `diagnosticConsumedCallbackHops` 双锚定能消费，run 有出口不死等。

## 范围限定

**在范围内**：
- `derive.js` 把 commander 纳入 infrastructure 重试路由，重试有界（上限 5，纯函数按 decisionLog 行时序统计）。
- 更新 main 既有回归测试 `tests/gp/f1/step3-route-unknown-review-approve-consume.test.js`：其第一个用例改为「已达重试上限（5 条 expired 行）→ wait+callbackHop」（断言语义不变）；补 <5 场景新期望=重派 commander。
- 新增 RED 测试（新文件，避让同族命名）。

**不在范围内**：
- 不改 lease 时长 / 收割器（`expired-attempt-reconciler.js`）本身。
- 不动回执传输层。
- 不改 #5058 diagnostic 人审批准消费函数本体（`diagnosticConsumedCallbackHops`），只更新其测试的场景铺垫。

## 假设

- [ASSUMPTION: 重试上限取 5（thin_prd 明示）；同 run 内累计口径 = 该 run decisionLog 里 role=commander 且 failure_class=infrastructure_blocked 的 `effect:expired_attempt_reconciled` 行条数。]
- [ASSUMPTION: 「按当前 phase 重派」= 复用 commander 既有派发动作（spawn:commander 族），phase 由 derive 现有相位推断给出；不新增派发动作枚举。]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：commander 纳入有界 infrastructure 重试（改 `infrastructureRetryForCallback` / `attemptCallbackRoute` 分支）。
- `tests/gp/f1/step3-commander-infra-retry-bounded.test.js`（新）：RED 先行，正向<5 重派 / 达上限 wait+callbackHop / 负向。
- `tests/gp/f1/step3-route-unknown-review-approve-consume.test.js`（更新）：第一个用例扩为达上限场景。
- `packages/brain/package.json` + `package-lock.json` + `.brain-versions` + `DEFINITION.md`：版本 bump 四处（1.273.139 → 1.273.140）。
- `sprints/08251745-kernel-r74-commander-retry/**`：合同四件套 + PRD。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；derive 为纯函数，无 IO 时延）
- 频控: 无（纯函数重放）
- 版本要求: Brain 版本四处同步 bump（check-version-sync 通过）
- 可观测: 达上限挂人审的决策对象必须带 callbackHop（供落盘请求行锚 + 后续消费）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 本 sprint 硬约束（thin_prd）为操作性铁律；area 级 decisions 铁律与本后端路由变更无关，仅登记 -->
- [纯函数可重放] derive 只依赖 orchestrator_decision_log 行时序，禁止引入时钟/随机/外部 IO（来源: 本 sprint 硬约束 thin_prd#4）
- [fail-closed 带锚] 达重试上限后必须 wait:human_review 且决策对象带 callbackHop，禁止静默放行或丢锚（来源: 本 sprint 硬约束 thin_prd#2）
- [不 mock 被改的边] 测试真 import derive.js，禁止 mock commander 重试路由本体（来源: GP 产物闸）
- [多账号授权隔离] 操作他人账号资源须用其本人授权（来源: area，本 sprint 无关，仅登记）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入真实脚本（local_api → npx vitest run + 版本四处同步校验）
# 期望验收点（自然语言）：
#  1. 新测试 tests/gp/f1/step3-commander-infra-retry-bounded.test.js 在修前 RED、修后 GREEN；
#  2. 既有 tests/gp/f1/step3-route-unknown-review-approve-consume.test.js 更新后全绿（第一个用例=达上限 wait+callbackHop）；
#  3. 单条 commander 过期（<5）→ derive 返回重派 commander 动作，action 不为 wait:human_review；
#  4. 达上限（第 5 条 expired）→ derive 返回 wait:human_review，reason=callback_infrastructure_route_unknown，带 callbackHop；
#  5. 非 commander / 非 infrastructure 失败用例语义不变；
#  6. bash scripts/check-version-sync.sh 通过（版本四处同步）。
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 后端 kernel 编排纯函数，无 UI / agent 协议 / engine 介入
## target_environment: local_api
## target_environment_reason: 纯 Brain 内部路由逻辑，E2E 在本地 evaluator 跑 npx vitest + check-version-sync（localhost 后端，无浏览器/远端机）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: F1-step3（造完真验；PrepPRD 未提供 Step UUID，按 tests/gp/f1/step3-* 家族锚定）
