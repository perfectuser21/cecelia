# Sprint PRD — kernel validation clock 按 fix 轮自动顺延（有界）[r55]

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除机制债清单第一项：长跑 run 被固定窗口误杀）

## 背景

resolveValidationClock 的 pipeline deadline 以最早的 generator 系 spawn 为原点起算固定
timeout_seconds（默认 5400s）。fix 轮多的 run（CI 红→fix→评→judge 循环 3+ 轮）在管线仍
健康推进时就撞 deadline，被 validation_clock 判死；r50/r51 两次人工只能 psql 手改
orchestrator_decision_log 的 pipeline_started_at/deadline_at 续命。本 sprint 让 validation
clock 在每次产生新候选的 fix 轮自动顺延窗口，且顺延有界防无限续命。

## Golden Path（核心场景）

系统从 [长跑 run 进入多轮 fix] → 经过 [每次 spawn:generator-fix 派发成功即重设时钟原点] → 到达 [管线健康推进时不再被固定窗口误杀，且顺延超上限后照常判死]

具体：
1. [触发条件] run 进入 fix 循环，orchestrator_decision_log 出现新的 spawn:generator-fix 行（派发成功）
2. [系统处理] resolveValidationClock 以最新的 generator 系 spawn 行为新原点，重新起算 timeout_seconds，而不是永远锚定首个 generator
3. [可观测结果] 首窗已耗尽但管线仍在推进的 run 存活（新 deadline_at 顺延）；顺延次数达上限（6 次）后不再顺延，到期照常判死

## 边界情况

- **无 fix 轮**：run 只有首个 spawn:generator，无 spawn:generator-fix → 窗口语义不变，仍以首 generator 为原点
- **顺延超上限**：spawn:generator-fix 累计超过 6 次 → 不再顺延，以第 6 次顺延后的 deadline 照常判死
- **可重放**：同一 orchestrator_decision_log 输入必得同一时钟（纯函数），顺延判定只依赖 log 行的 hop 时序，禁 Date.now 之外的墙钟状态

## 范围限定

**在范围内**：
- resolveValidationClock 顺延判定逻辑（以最新 generator 系 spawn 为新原点）
- 每 run 顺延次数上限（6 次）与到期照常判死
- tests/gp/f1/ 下的 RED 测试

**不在范围内**：
- 不改 timeout_seconds 默认值（保持 5400s）
- 不动人审 deadline（judge deferred 结构是另一条线）
- 不改 validation_clock_required 默认 fail-closed 语义

## 假设

- [ASSUMPTION: resolveValidationClock 实际定义并 export 于 `packages/brain/src/orchestrator/validation-clock.js`；loop.js 仅 import 该符号、**不 re-export**。thin_prd 要求#5 写的 "loop.js（resolveValidationClock 所在模块）" 与代码事实不符——真 import 目标应为 validation-clock.js，否则从 loop.js import 取不到该符号。proposer/generator 请按真身模块锚定测试。]
- [ASSUMPTION: "generator 系 spawn" = GENERATOR_ACTIONS（spawn:generator + spawn:generator-fix）；顺延原点取 decisionLog 中 hop 最大（最新）的 generator 系行]
- [ASSUMPTION: 顺延上限 6 次，与 fix 收敛探测器边界一致（thin_prd 建议值）；上限计数以 spawn:generator-fix 出现次数为准]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`: resolveValidationClock 顺延判定与有界计数（核心改动）
- `tests/gp/f1/step3-validation-clock-fix-round-slide.test.js`: RED 回归测试（新增，真 import validation-clock.js）

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空；下列来自 thin_prd 显式约束 -->
- 超时/延迟: timeout_seconds 默认 5400s 不变（PrepPRD 显式：不改默认值）
- 顺延上限: 每 run 6 次（PrepPRD 建议，与 fix 收敛探测器边界一致）
- 可重放: 顺延判定为纯函数，只依赖 orchestrator_decision_log 行（hop 时序），禁 Date.now 之外的墙钟状态
- 测试纪律: 放 tests/gp/f1/，真 import 被改模块，禁 mock 被改的边

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本 sprint 无挂载） -->
- [validation-clock-fail-closed] 保留 validation_clock_required 默认 fail-closed；不得伪造 Generator intent，也不得无条件允许 evaluator 重置时钟；仅 gear=hotfix 且 payload pr_url/pr_head_sha 与 GitHub 实时观测完全一致时，首个 Evaluator intent 可建立一次共享 clock，后续 Judge 复用（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（vitest 跑 tests/gp/f1/ RED 测试）。

```bash
# 占位：proposer 将填入真实脚本（local_api → npx vitest run tests/gp/f1/step3-validation-clock-fix-round-slide.test.js）
# 期望验收点（自然语言）：
#  1. 复刻 r50 场景（fix 轮 2 轮后原窗口已耗尽但管线仍在推进）→ 现行为判死 / 新行为顺延存活
#  2. 负向：顺延超上限（>6）后照常判死
#  3. 无 fix 轮时窗口语义不变（仍锚定首 generator）
#  4. 纯函数可重放：同一 decisionLog 两次调用结果一致
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端 orchestrator 逻辑，无 UI/远端 agent/engine hooks
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端纯函数改动，RED 测试由本地 evaluator 跑 vitest（tests/gp/f1/）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
