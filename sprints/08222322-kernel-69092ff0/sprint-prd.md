# Sprint PRD — runner_failure 有界重派计数按角色窗口化（priorRunnerFailures per-role）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（零人碰三连计数第 1 轮 r51；根除跨阶段额度误耗）

## 背景

r40/r45/r50 实证：kernel derive 的 `priorRunnerFailures`（`packages/brain/src/orchestrator/derive.js`）
把整条 run、全角色的 `runner_failure` attempt_callback 一起累计。早期角色（如 evaluator 因已修
的 worker bug）的瞬时抖动会耗光后期角色（如 publisher / generator-fix）的 ≤2 次重派额度，一次抖动
即 `callback_runner_failure_exhausted` 进人审，破坏零人碰闭环。本 sprint 把计数窗口按角色隔离。
（r50 死于 seal repo 行缝隙，#5027 已修 1.273.123：封印时同尺校验 repo 行 BEHAVIOR。）

## Golden Path（核心场景）

系统从 [收到 runner_failure 回调] → 经过 [按当前角色窗口化统计历史 runner_failure] → 到达 [同角色 ≤2 次重派、跨角色互不占用]

具体：
1. 触发条件：attempt_callback 到达 derive，`status=failed && failure_class=runner_failure`，其 `callbackDetail.role = R`
2. 系统处理：`priorRunnerFailures` 只统计 decisionLog 中 hop 更早、且 `callbackDetail.role === R`、且 `status=failed && failure_class=runner_failure` 的行
3. 可观测结果：
   - 同角色 R 累计 <2 → 重派（`callback_runner_failure_retry`）
   - 同角色 R 累计 ≥2 → 进人审（`callback_runner_failure_exhausted`），语义不变
   - 其它角色的 runner_failure 不再计入角色 R 的窗口

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- evaluator 已 2 次 runner_failure 后，publisher 首次 runner_failure：修复前误判 exhausted，修复后仍可重派
- 同角色 3 连败：仍在第 3 次进人审（负向语义不变，不得放宽）
- decisionLog 中缺 role 字段的历史行：不匹配当前角色，不计入（等价旧行为的保守子集）

## 范围限定

**在范围内**：`packages/brain/src/orchestrator/derive.js` 中 `priorRunnerFailures` 统计逻辑增加同角色过滤条件（`callbackDetail(r).role === <当前 callback 的 role>`）。
**不在范围内**：重派路由 `infrastructureRetryForCallback`、account_exhausted / infrastructure_blocked 分支、阈值数值（仍为 ≥2）、其它 failure_class 分支。

## 假设

- [ASSUMPTION: 当前 callback 的角色取自本行 `callbackDetail(row).role`（与 line 622 filter 中同一 `callbackDetail` 访问器一致）]
- [ASSUMPTION: artifacts/contract_artifacts 本轮为空 → 冻结测试完整路径由 Proposer 在 GAN 阶段登记进 ## Test Contract；候选宿主测试文件 = `packages/brain/src/orchestrator/__tests__/derive.test.js`]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`: `priorRunnerFailures` filter（约 622-627 行）加同角色条件——核心修复点
- `packages/brain/src/orchestrator/__tests__/derive.test.js`: 新增 RED 用例（跨角色误耗复现）；既有 `runner failure retries bounded`（约 688 行）作同角色负向回归保留

## Test Contract（登记要求，Proposer 填表 + 封印机械校验）

> artifacts 本轮为空。Proposer 必须在 contract-draft.md 的 `## Test Contract` 表逐行登记每个冻结测试**完整路径**（含 repo 路径行）。
> 每行 BEHAVIOR **必须逐词取自对应测试文件真实 `it()` 名的子串**（含 repo 路径行，封印时机械校验），多值用 `/` 或分号分隔。
> 至少覆盖：① 跨角色误耗 RED→GREEN（evaluator 2 败后 publisher 首败仍可重派）；② 同角色 3 连败仍 exhausted（负向回归）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 两源均为空）+ PrepPRD -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 每角色重派额度 ≤2 次（超限进人审兜底，不轮换账号、不无限重试）
- 版本要求: 空
- 可观测: derive 决策 reason 必须区分 `callback_runner_failure_retry` / `callback_runner_failure_exhausted`

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [冻结纪律] run 在途时 Commander 不合任何 PR（来源: 本 line r51 描述）
- [BEHAVIOR 封印] Test Contract 每行 BEHAVIOR 逐词取自真实 it() 名子串，含 repo 路径行，封印时机械校验（来源: 本 line，#5027 1.273.123）
- [额度语义] 同角色累计语义不变——同角色 3 连败仍 exhausted，不得因窗口化放宽（来源: 本 sprint 负向红线）
- [凭据隔离] 多人协作禁止混用授权凭据，操作他人账号资源用其本人授权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收历史：journey golden-paths 均为 planned 状态，无 done/working 行为可累计）

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node 单测 + 断言 derive 输出）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node --test / jest 跑 derive.test.js + 断言 action/reason）
# 期望验收点（自然语言）：
#   RED（修复前）：构造 decisionLog——evaluator 2 次 runner_failure 后，publisher 首次 runner_failure 回调，
#                  derive 返回 action=WAIT_HUMAN_REVIEW / reason=callback_runner_failure_exhausted（误耗，测试转红）
#   GREEN（修复后）：同输入下 publisher 首败仍返回重派（reason=callback_runner_failure_retry）
#   负向：同角色（如 publisher）3 连败第 3 次仍 exhausted，语义不变
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/src/orchestrator（kernel 后端 derive 决策），无 UI / 无远端 agent 协议
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；Brain 内部纯后端逻辑，本地 evaluator 跑 node 单测断言 derive 输出
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
