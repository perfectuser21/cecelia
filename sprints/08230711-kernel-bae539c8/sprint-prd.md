# Sprint PRD — runner_failure 有界重派计数按角色窗口化（跨角色不再误耗额度）[r52]

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（kernel derive 有界重派额度语义修正，减少假终态烧 run）

## 背景

runner_failure 是基础设施故障（容器/guard/依赖装配起不来），非产品失败。kernel derive
对其做有界重派（同角色 ≤2 次重试，超限进人审）。当前 `priorRunnerFailures` 按**全 run 全角色**
累计 runner_failure 行——早期角色（evaluator）失败耗光计数后，后期角色（publisher）首次
runner_failure 会被误判为「已超限」直接进人审，本该属于自己的重派额度被跨角色占用。
r51 死于冻结 manual 命令 fragile grep（#5031 已修 1.273.124，封印静态拦）；本 r52 三连计数
重启第 1 轮，功能诉求与 r51 一致。

## Golden Path（核心场景）

系统对一条 run 的 runner_failure 有界重派：从 [某角色 runner 起不来] → 经过 [derive 统计**同角色**
历史 runner_failure 次数] → 到达 [每角色各自 ≤2 次重派额度，跨角色互不占用]。

具体：
1. [触发] 一条 run 内 evaluator 连续 2 次 runner_failure（已用满 evaluator 自己的重派额度）。
2. [系统处理] 随后 publisher 首次 runner_failure，derive 统计 `priorRunnerFailures` 时**只数
   与当前 callback 同角色（callbackDetail.role 相同）的 runner_failure 行**。
3. [可观测结果] publisher 的同角色历史 = 0 < 2 → 仍走 publish 重派动作，不被 evaluator 的失败
   拖累进人审；evaluator 自身累计到第 3 次仍照旧进人审（有界语义不变）。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 同角色累计语义不变：同一角色第 3 次 runner_failure 仍进人审（`callback_runner_failure_exhausted`）。
- 负向不受影响：product 类失败（无 failure_class）、cancelled 照旧判终态，不被本次放宽。
- 每个 runner_failure 行的 `role` 取自 `callbackDetail(r).role`，与当前失败行 `role` 严格相等比对。

## 范围限定

**在范围内**：`packages/brain/src/orchestrator/derive.js` 中 `priorRunnerFailures` 统计逻辑，
加同角色过滤条件（`&& callbackDetail(r).role === role`）。
**不在范围内**：重派动作路由（`infrastructureRetryForCallback`）、account_exhausted/infrastructure_blocked
其他族语义、冻结合同 manual 命令模板（属 contract 阶段）。

## 假设

- [ASSUMPTION: 当前失败行角色变量 `role` = `callbackDetail(row).role`（derive.js:474 destructure），过滤用它做同角色判定。]
- [ASSUMPTION: 额度阈值 `>= 2` 数字不变，仅统计口径从全角色收窄为同角色。]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：`priorRunnerFailures` filter 增加同角色条件（~L622-627）。
- `tests/gp/f1/step3-runner-failure-retry.test.js`：冻结守卫，现有 5 条 it() 全绿不回退（含「第 3 次进人审」同角色路径）。
- `tests/gp/f1/step3-publisher-runner-failure-retry.test.js`：冻结守卫，含「回归守恒：evaluator 首次仍重派」及需新增的跨角色不误耗 RED→GREEN 断言。

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出
> （vitest 跑冻结守卫，manual 命令若带 `-t` 过滤须用 `grep -qE "[1-9][0-9]* passed"` 宽松式，禁精确 "(N)" 尾缀）。

```bash
# 占位：proposer 按 local_api 填入真实脚本（node --test / vitest 跑 tests/gp/f1/ 两个冻结守卫）
# 期望验收点（自然语言）：
#   RED（修前）：一条 run 内 evaluator 已 2 次 runner_failure 后，publisher 首次 runner_failure
#                被误判 exhausted → 进人审（跨角色误耗额度），断言失败复现 bug。
#   GREEN（修后）：同场景下 publisher 首败仍走 publish 重派动作（不进人审）；
#                 evaluator 同角色累计第 3 次仍进人审 exhausted（有界语义不变）；
#                 现有 it() 全部保持绿。
# 冻结守卫锚定的真实 it() 名（供 proposer 逐词登记 ## Test Contract 表 + BEHAVIOR）：
#   - evaluator 的 runner_failure（首次）→ 同 run 重派 evaluator，不判终态
#   - 同一 run 第 3 次 runner_failure → 进人审（有界，不无限重试）
#   - 回归守恒：evaluator runner_failure 首次仍重派 evaluator（既有角色行为不回退）
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均空），PrepPRD 未指定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 无（纯 derive 纯函数，无外部调用）
- 版本要求: 无
- 可观测: derive reason 字段区分 `callback_runner_failure_retry` / `callback_runner_failure_exhausted`（既有语义，不新增）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（本 task ability_id 为空，无 step/feature 源）；只列与本 kernel 变更相关者 -->
- [有界重派] runner_failure 有界重派：同角色 ≤2 次重试，超限进人审兜底，不轮换账号、不无限重试（来源: 本 sprint 代码注释既有铁律）
- [基础设施重试身份] generator_infrastructure_retry_identity — 基础设施重派须保持角色身份一致（来源: area）
- [负向守恒] product 类失败（无 failure_class）与 cancelled 照旧判终态，不被有界重派放宽（来源: 冻结守卫既有断言）
- [租户隔离] 记忆/资源按租户隔离；多人协作禁止混用授权凭据（来源: area，泛化铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 变更落在 packages/brain/src/orchestrator（纯后端 kernel derive），无 UI / 无远端 agent 协议 / 无 engine hooks。
## target_environment: local_api
## target_environment_reason: payload.target_environment=local_api；Brain 内部 derive 纯函数，本地 evaluator 跑 vitest 冻结守卫即可验（localhost:5221 无需真调）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
