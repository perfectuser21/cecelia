# Sprint PRD — validation clock 按 fix 轮自动顺延（有界）——长跑 run 不再被固定窗口误杀 [r57]

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（kernel validation clock 随 fix 轮顺延，消除长跑 run 被固定窗口误杀 + 人工 psql 续命）

## 背景

`resolveValidationClock`（validation-clock.js）的 pipeline deadline 永远锚定**首个** generator 系
spawn（`firstValidationOrigin`：按 hop 排序取 [0]），从该原点起算固定 `timeout_seconds`（默认 5400s）。
generator-fix / evaluator / judge 每一轮都消耗这一个共享窗口：fix 轮多的 run（CI 红→fix→评→judge
循环 3+ 轮）在管线仍健康推进时就撞 deadline，被 validation_clock 判死。r50/r51 两次实录只能人工
psql 手改 orchestrator_decision_log 的 pipeline_started_at/deadline_at 续命。r55/r56 死于机制病
（judge 误判 / hybrid profile 缺省），均已修复上产（1.273.128/129），本轮 r57 重跑。

## Golden Path（核心场景）

系统对一条长跑 run 的 validation clock：从 [首个 generator 起算窗口] → 经过 [每次 spawn:generator-fix
派发成功即以最新 generator 系 spawn 为新原点重算 timeout_seconds] → 到达 [管线健康推进的 run 不再被
固定窗口误杀，且顺延有界（≤6 次）防无限续命]。

具体：
1. [触发] 一条 run 已跑过 2 轮 spawn:generator-fix，按首原点算原窗口已耗尽（now > 首原点+timeout），
   但管线仍在健康推进（最新一轮 generator-fix 刚派发成功）。
2. [系统处理] `resolveValidationClock` 不再永远取首个 generator 原点，而是取**最新**一次成功的
   generator 系 spawn（generator / generator-fix）为新原点重算 deadline；顺延次数只数 decision_log
   里 generator-fix 行数，上限 6 次。
3. [可观测结果] 该 run 的 deadline 顺延到「最新 generator-fix 原点 + timeout_seconds」→ 存活继续跑；
   顺延累计到第 7 次不再顺延，deadline 冻结在第 6 次顺延原点，到期照常判死。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **无 fix 轮**：run 只有首个 generator、无 generator-fix 行 → 窗口语义完全不变（仍以首原点算，回归守恒）。
- **顺延超上限**：generator-fix 行数 > 6 → 停止顺延，deadline 锚定第 6 次顺延原点，到期判死（防无限续命）。
- **纯函数可重放**：顺延判定只读 decisionLog 行（hop 时序 + action），除 Date.now 外禁任何墙钟/外部状态；
  同一 decisionLog 多次调用结果恒等。
- **既有 validation_clock_required fail-closed 语义不放宽**：非 generator 系且无有效 origin 仍抛
  `validation_clock_required`（不因顺延逻辑被绕过）。

## 范围限定

**在范围内**：`packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock` —— 把
「永远锚定首个 generator 原点」改为「按 generator-fix 轮顺延到最新 generator 系原点、上限 6 次」的有界
顺延逻辑（纯函数，只依赖 decisionLog + timeoutSeconds）。
**不在范围内**：`timeout_seconds` 默认值（5400，不改）；人审 deadline / judge deferred 结构（另一条线）；
真库 loop.js 的 validation_clock 判死调用接缝（按合同惯例登记「未覆盖真实链路清单」CANNOT_VERIFY）。

## 假设

- [ASSUMPTION: 顺延上限 6 与「fix 收敛探测器」边界一致，作为常量硬编码在 validation-clock.js（proposer 定名）。]
- [ASSUMPTION: 「新原点」取 generator 系 spawn 行的 persisted origin，沿用 `persistedClock` 既有校验，不引入新时间源。]
- [ASSUMPTION: 顺延次数 = decisionLog 中 `spawn:generator-fix` 行数（派发成功即在 log 留行），不额外查表。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`：`resolveValidationClock` 的 `firstValidationOrigin`
  取原点逻辑，改为按 generator-fix 轮有界顺延到最新原点（新增顺延上限常量 + 选原点分支）。
- `tests/gp/f1/`（新增冻结守卫，如 `step3-validation-clock-fix-extension.test.js`）：真 import
  validation-clock.js 的 `resolveValidationClock`，禁 mock 被改的边；覆盖 RED→GREEN + 三条负向。

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出
> （node --test / vitest 跑 tests/gp/f1/ 冻结守卫；manual 命令带 `-t` 过滤时用 `grep -qE "[1-9][0-9]* passed"` 宽松式，禁精确 "(N)" 尾缀）。

```bash
# 占位：proposer 按 local_api 填入真实脚本（跑 tests/gp/f1/ 新增 validation-clock 冻结守卫）
# 期望验收点（自然语言）：
#   RED（修前）：复刻 r50 —— 一条 run 已 2 轮 generator-fix、按首原点原窗口已耗尽但管线仍推进，
#               现行为以首原点算 deadline 已过 → 判死；断言「新原点 deadline 应晚于 now」失败复现 bug。
#   GREEN（修后）：同场景 deadline 顺延到最新 generator-fix 原点+timeout → 存活；
#                 负向①：generator-fix 行数 > 6 → deadline 冻结在第 6 次顺延原点，不再顺延（到期判死）；
#                 负向②：无 generator-fix 行 → deadline 仍以首原点算（窗口语义不变，回归守恒）；
#                 负向③：非 generator 系且无有效 origin → 仍抛 validation_clock_required（fail-closed 不放宽）。
# 未覆盖真实链路清单（CANNOT_VERIFY，合同登记）：
#   - 真库 loop.js 消费 resolveValidationClock 结果做判死/续命的集成接缝（纯函数单测不覆盖真实 DB 调用）。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均空），PrepPRD 未显式指定 -->
- 超时/延迟: `timeout_seconds` 默认 5400s 不改（本 sprint 只改窗口原点起算，不改时长）
- 频控: 无（纯函数，无外部调用）
- 版本要求: 无
- 可观测: deadline 顺延后 pipeline_started_at/deadline_at 反映最新原点（既有 clock 结构，不新增字段）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area/F1 级（本 task ability_id 为空，无 step/feature 源）；只列与本 kernel 变更相关者 -->
- [有界续命] validation clock 顺延必须有界（每 run ≤6 次），超上限不再顺延、到期照常判死，禁无限续命（来源: 本 sprint 诉求铁律）
- [fail-closed 守恒] 保留 `validation_clock_required` 默认 fail-closed；顺延逻辑不得成为绕过 fail-closed 的旁路（来源: F1「Kernel existing PR evaluator validation clock adoption」）
- [纯函数可重放] validation clock 判定只依赖 orchestrator_decision_log 行（hop 时序），除 Date.now 外禁任何墙钟/外部状态（来源: 本 sprint 诉求铁律）
- [红先行] bug 修复前必须先写复现 RED 测试，修复后永久留作回归守卫，不得删（来源: area 全局铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 变更落在 packages/brain/src/orchestrator（纯后端 kernel 纯函数），无 UI / 无远端 agent 协议 / 无 engine hooks。
## target_environment: local_api
## target_environment_reason: payload 语义=Brain 内部 validation clock 纯函数，本地 evaluator 跑 tests/gp/f1/ vitest/node--test 冻结守卫即可验（localhost:5221 无需真调）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
