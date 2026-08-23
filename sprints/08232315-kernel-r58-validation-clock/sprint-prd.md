# Sprint PRD — kernel validation clock 按 fix 轮有界顺延

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：消除健康长跑 Harness run 被固定 validation clock 误杀的已知机制缺陷

## 背景

`resolveValidationClock` 的 pipeline deadline 当前始终以首次 `spawn:generator` 为原点。经历多个 fix 轮且仍健康推进的长跑 run 会耗尽原窗口并被误判死亡。本 sprint 让 validation clock 在成功派发 `spawn:generator-fix` 后有界顺延，同时保持超限、无 fix 轮与人审 deadline 的既有语义。

## Golden Path（核心场景）

Harness kernel 从首次 generator 派发进入 validation clock → 经成功的 generator-fix 轮继续验证 → 在有界的新窗口内保持存活，或在超过顺延上限后照常判死。

具体：
1. run 的决策日志包含首次 `spawn:generator`，随后包含按 hop 排序的成功 `spawn:generator-fix` 派发行为。
2. 每个不超过上限的成功 fix 派发成为新的 pipeline timeout 原点；计算结果仅由 `orchestrator_decision_log` 行及其 hop 时序决定，可重放得到同一结果。
3. r50 型场景在两轮 fix 后虽已耗尽首次 generator 的原窗口，但仍处于最近 fix 的有效窗口，因此不得被误杀。
4. 第 7 次及后续 fix 不再获得顺延，run 超时后照常判死；完全没有 fix 轮的 run 保持现有判断。

## 边界情况

- 只计算成功派发的 `spawn:generator-fix`，失败或非派发行不得改变时钟原点。
- 顺延最多 6 次；超过上限不会形成无界续命。
- 决策日志存在多轮 fix 时按 hop 时序确定有效原点，输入相同则结果相同。
- 不改变 `timeout_seconds` 默认值 5400 秒，不改变人审 deadline。

## 范围限定

**在范围内**：validation clock 的 pipeline deadline 原点规则；两轮 fix 后仍存活、超过 6 次判死、无 fix 轮语义不变的回归验收；真实导入目标模块的 RED-first 测试。

**不在范围内**：调整默认 timeout；更改人审 deadline；扩展其他 deadline；声称已覆盖 `loop.js` 真库集成接缝。

## 假设

- [ASSUMPTION: “派发成功”以 `orchestrator_decision_log` 中可识别的成功 `spawn:generator-fix` 行为为准。]
- [ASSUMPTION: 当前任务未提供 step_id，合同以 `none（PrepPRD 未锚定）` 明示。]
- [ASSUMPTION: Unified Map 未配置，因为 payload 缺少 `map_repo`；不据此猜测额外 scope。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`: 用户可观察的 pipeline deadline 判定行为发生变化
- `tests/gp/f1/`: 永久保留的真实导入回归测试，覆盖 RED 场景与负向语义
- `packages/brain/DEFINITION.md`: Brain 行为版本随源代码变更同步更新

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；本任务两副源均为空 -->
- 超时/延迟: 保持 `timeout_seconds` 默认值 5400 秒，不改变既有计算单位
- 频控: 不适用
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 判定必须可由 `orchestrator_decision_log` 行及 hop 时序纯函数重放

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step 与 journey_feature 为空，area 源按 id 去重。以下为本 sprint 直接适用的 area 铁律。 -->
- [重试身份] Generator 基础设施失败必须重试原始服务端派发动作，首次 generator 与 generator-fix 不得混淆（来源: area）
- [Planner 分支] Planner workspace 必须保持服务端签发的 planner_branch，Provider 不得切换分支（来源: area）
- [Brain URL] Dispatcher 与 Fleet Worker 必须使用服务端权威 Brain URL，预检保持 fail-closed（来源: area）
- [真实门禁] 测试必须真实导入被改边，不得 mock `validation-clock.js`（来源: area）
- [基线冻结] 实现基线固定为 task payload 的 `422633217348366974b6c28ceeaba7f587070a51`，不得以角色 checkout SHA 替换（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 golden-paths -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：先运行可复现旧误杀的 RED 测试，再验证两轮 fix 后原窗口耗尽但 run 仍存活；同时验证超过 6 次仍判死、无 fix 轮语义不变，并登记 loop.js 真库集成接缝为 CANNOT_VERIFY。
```

## journey_type: autonomous
## journey_type_reason: 变更位于 packages/brain 的 Harness kernel 纯后端判定逻辑
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端测试由本地 evaluator 在 Cecelia checkout 执行
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
