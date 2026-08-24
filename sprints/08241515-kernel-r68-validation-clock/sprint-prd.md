# Sprint PRD — kernel validation clock 按 fix 轮自动顺延（有界）[r68]

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除长跑 run 被 validation clock 误杀、需人工 psql 续命的稳定性缺口）

## 背景

`resolveValidationClock` 的 pipeline deadline 以最早的 `spawn:generator` origin 起算固定 `timeout_seconds`（默认 5400s）。fix 轮多的 run 在管线仍健康推进（不断派 `spawn:generator-fix`）时，会撞上以初始 origin 计算的 deadline 被判死；r50/r51 手术实录显示人工只能 psql 手动续命。本 sprint 让 deadline 随每一轮 fix 派发自动顺延，且有界，避免误杀又不放任无限拖延。

（第十四次点火。r67 死因 codex 输出 schema 的 `uniqueItems` 被 OpenAI structured output 拒绝，已由 #5051 去除并重建 runner 镜像 repin `895f25f0`（#5052，Brain 1.273.136 healthy）；容器 git 对象权限病 issue `1a165bab` 此前已 Closed。故本轮可正常起跑。）

## Golden Path（核心场景）

系统 [tick 调 resolveValidationClock] → 经过 [按 hop 时序识别 generator origin 并按 fix 轮顺延原点] → 到达 [返回顺延后的 deadline，健康长跑 run 不被误杀]

具体：
1. 触发：`resolveValidationClock({action, decisionLog, timeoutSeconds})` 被传入含多轮 `spawn:generator-fix` 行的 `decisionLog`。
2. 系统处理：按 `hop` 升序识别所有 generator origin（`spawn:generator` + 每次 `spawn:generator-fix`）；deadline 原点 = 最近一次成功派发的 `spawn:generator-fix` 行时间，重新起算 `timeout_seconds`。
3. 有界：顺延次数上限 6 次；出现第 7 次及以后的 fix 轮时，原点冻结在第 6 次 fix 派发，不再顺延，deadline 照常到点判死。
4. 可观测结果：复刻 r50 场景（初始 origin 已过 deadline、但仍在健康 fix 推进）时，旧逻辑判死、新逻辑存活；返回 `{pipeline_started_at, deadline_at}`，`pipeline_started_at` 指向被采纳的顺延原点。

## 边界情况

- **无 fix 轮**（只有初始 `spawn:generator`）→ 顺延次数为 0，deadline 与旧逻辑逐字节一致（语义不变）。
- **超限**（fix 轮 > 6）→ 原点冻结在第 6 次 fix，deadline 不再增长；超时照常判死（负向断言）。
- **existing-PR evaluator origin**（`validation_origin=verified_existing_pr`）复用路径不受本改动影响（Invariant 铁律）。
- **纯函数可重放**：结果只依赖 `orchestrator_decision_log` 行的 `hop` 时序与时间戳，不读时钟、不读外部状态，同输入必同输出。

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock` 顺延逻辑（generator-fix 原点推进 + 6 次上限）。
- `tests/gp/f1/` 下真 import 被改文件的冻结回归测试（RED 先行）。

**不在范围内**：
- 不改 `timeout_seconds` 默认值（5400s）。
- 不动人审（human-review）deadline。
- 不改 `loop.js` 真实链路集成接缝——登记进「未覆盖真实链路清单」（见假设）。

## 假设

- [ASSUMPTION: 顺延上限固定为 6 次（thin_prd 明确），无需 PrepPRD 追加参数]
- [ASSUMPTION: 「派发成功」以 `orchestrator_decision_log` 中存在对应 `spawn:generator-fix` 行为判据，不额外查派发回执]
- [ASSUMPTION: 未覆盖真实链路清单 — 本 sprint 只做纯函数单测，`packages/brain/src/orchestrator/loop.js` 消费 `resolveValidationClock` 的真库集成接缝未做端到端验证，登记待后续 sprint]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`: 新增按 `spawn:generator-fix` 顺延原点、6 次上限的逻辑
- `tests/gp/f1/step3-validation-clock-fix-round-extension.test.js`: 新增冻结回归测试（RED 先行，真 import，禁 mock 被改的边）

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空；以下取 thin_prd 显式约束 -->
- 超时/延迟: `timeout_seconds` 默认 5400s 不变（PrepPRD 显式：不改默认值）
- 顺延上限: 6 次（超限照常判死）
- 可重放/纯度: 只依赖 `orchestrator_decision_log` 行 hop 时序，纯函数、同输入同输出
- 隔离: 不动人审 deadline，不改 existing-PR evaluator origin 复用路径

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级；与 validation-clock line 直接相关者 -->
- [existing-PR-clock] Kernel existing PR evaluator：`validation_origin=verified_existing_pr` 的 evaluator 复用 generator origin clock 的路径不得被本改动破坏（来源: area）
- [retry-identity] generator_infrastructure_retry_identity：基础设施重试不得改变身份/origin 语义（来源: area）
- [planner-role-branch] planner 只用服务端签发的 PLANNER_BRANCH，禁自行 checkout/switch（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 journey 已完成 ability 的 golden_path；查询无与 validation-clock 相关的已验收历史 -->
- （本 line 暂无与 validation clock 相关的已验收 golden_path 历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 `target_environment=local_api` 填入（vitest 真跑 `tests/gp/f1/` + 断言 exit code）。

```bash
# 占位：proposer 将填入 local_api 脚本（vitest 真跑冻结测试）
# 期望验收点（自然语言）：
#  1. RED 先行——未改实现前，复刻 r50 的顺延用例断言为红（旧逻辑判死）
#  2. 修复后：r50 场景新逻辑存活（deadline 采纳最近 generator-fix 原点）
#  3. 负向：fix 轮 > 6 时 deadline 冻结、超时判死为绿
#  4. 语义不变：无 fix 轮时 deadline 与旧逻辑逐字节一致为绿
#  5. 测试真 import packages/brain/src/orchestrator/validation-clock.js，无 mock 被改的边
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ orchestrator 纯后端逻辑，无 UI/agent 协议/engine 路径
## target_environment: local_api
## target_environment_reason: payload 显式 local_api；纯 brain 后端纯函数单测，本地 evaluator vitest + 无需真机
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
