# Sprint PRD — 验证窗对多轮 fix 链自动顺延（超窗断言预算不再被钳到 1 秒）

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（根除多轮 fix 假 FAIL 需 Commander 手工救活的 kernel 缺陷）

## 背景

r40/r46 双实证：validation clock 锚定第一个 generator hop + `timeout_seconds`（5400s）后不再刷新。当一条 run 经历多轮 fix，LLM 时延吃光首窗后，kernel 仍派 evaluator，但 runner 的 `runner_assertion_budget_seconds = max(1, 负数) = 1 秒` → `npm ci` 秒杀 → 被伪装成 trusted「assertion dependency install failed」→ judge 机械闸零测试 FAIL。r40/r46 均需 Commander 手工禁触发器、改 `decision_log` 时钟才活。本 sprint 让验证窗随 fix 轮自动顺延，消除人工干预。

（r50：零人碰三连计数第 2 轮，r49 已 1 次纯净交付。冻结纪律：run 在途 Commander 不合任何 PR。）

## Golden Path（核心场景）

系统从 [kernel 派发某 validation 角色] → 经过 [resolveValidationClock 计算窗口] → 到达 [deadline 随 fix 轮顺延，evaluator/runner 拿到充足断言预算]

具体：
1. [触发] 一条 in-flight run 在锚 hop（第一个 generator intent）之后已发生 N 次 `spawn:generator-fix` 动作，且首窗时长已被 LLM 时延吃光
2. [系统处理] kernel 派发 evaluator/judge 时调 `resolveValidationClock`；函数在锚 hop 之后每出现一次 generator-fix 动作即把窗口顺延一个 `timeout_seconds`，即 `deadline = anchor_started + (1 + fixCount) * timeout_seconds`
3. [可观测结果] deadline 随 fix 次数线性顺延，runner 的断言预算恒为正（不再被钳到 1 秒），npm ci 不再秒杀，judge 不再零测试假 FAIL；无需 Commander 手工改时钟

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- **零 fix 轮**：`fixCount = 0` 时 `deadline = anchor_started + 1 * timeout`，与现行为逐字节一致（零回归）
- **有界性**：`fixCount` 由既有 fix 轮上限约束，顺延窗口有界，不破坏 kernel 有界运行原则
- **恢复/在途 run**：persisted clock 重算（`persistedClock`）必须容忍顺延后的 deadline，不得因顺延而误判 `validation_clock_invalid`
- **锚点识别不变**：锚 hop 仍是第一个 generator intent（或 verified_existing_pr evaluator），本 sprint 只改窗口时长计算，不改锚点选择

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock`：按锚 hop 之后的 generator-fix 出现次数顺延 deadline
- 顺延后 persisted clock 的重算/校验一致性

**不在范围内**：
- runner 侧断言预算计算逻辑（不变）
- 锚点选择规则、`VALIDATION_ACTIONS`/`GENERATOR_ACTIONS` 枚举
- 触发器/decision_log 的手工修补路径（本 sprint 目标就是让其不再需要）

## 假设

- [ASSUMPTION: fixCount 以 `decisionLog` 中锚 hop 之后（含）出现的 `spawn:generator-fix` 动作行数为准]
- [ASSUMPTION: `timeout_seconds` 缺省沿用调用侧 5400s（`taskPayload.timeout_seconds ?? 5400`）]
- [ASSUMPTION: 冻结测试登记于既有 `validation-clock.test.js`，新增 it() 与既有断言并存]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`: `resolveValidationClock` / `persistedClock` 顺延窗口计算
- `packages/brain/src/orchestrator/__tests__/validation-clock.test.js`: 冻结测试（RED→GREEN 多 fix 顺延 + 零 fix 零回归）

## Test Contract 要求（交 Proposer 落表）

proposer 在 contract-draft.md 的 `## Test Contract` 表须逐行登记本 sprint 每个冻结测试完整路径；BEHAVIOR 文字与 `it()` 名互为子串（多值用 `/` 或分号分隔）。本 sprint 冻结测试路径：`packages/brain/src/orchestrator/__tests__/validation-clock.test.js`。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均空数组），PrepPRD 显式值优先 -->
- 超时/延迟: `timeout_seconds` 默认 5400s（顺延单位）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 顺延后 deadline 写入 decision_log detail（`pipeline_started_at`/`deadline_at`），供恢复重算

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（step/feature 源空；area 源 + 本 line 铁律） -->
- [有界运行] 顺延窗口必须有界（fixCount 受既有 fix 轮上限约束），禁止无界增长（来源: 本 line）
- [零回归] 无 fix 轮时窗口计算与现行为逐字节一致（来源: 本 line）
- [runner 不变] 只改 kernel 侧验证窗，runner 断言预算逻辑不得改动（来源: 本 line）
- [凭据隔离] 多人多账号协作禁止混用授权凭据，操作他人资源须用其本人授权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入真实脚本（local_api）
# 期望验收点（自然语言）：
# 1. RED — 构造锚 hop 后 N≥2 次 spawn:generator-fix 的 decisionLog，断言当前 deadline 不随 fix 顺延（复现缺陷）
# 2. GREEN — 修复后 deadline == anchor_started + (1+fixCount)*timeout_seconds，随 fix 次数线性顺延
# 3. 零回归 — fixCount=0 时 deadline 与既有断言逐字节一致
# 命令：cd packages/brain && npx vitest run src/orchestrator/__tests__/validation-clock.test.js
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ kernel 编排纯后端逻辑，无 UI/agent 协议/engine 介入
## target_environment: local_api
## target_environment_reason: 纯 Brain 内部逻辑，本地 evaluator 跑 vitest + curl localhost:5221 即可验证，无远端机器
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
