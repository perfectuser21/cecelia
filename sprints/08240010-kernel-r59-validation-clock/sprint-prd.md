# Sprint PRD — kernel validation clock 按 fix 轮有界顺延

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：消除健康长跑 Harness run 因固定 validation clock 被误杀的已知缺口

## 背景

`resolveValidationClock` 当前以 `spawn:generator` 为 pipeline deadline 原点，固定使用 `timeout_seconds`（默认 5400 秒）。多轮修复仍健康推进的 run 会撞到旧原点 deadline 而被判死。本 sprint 修复 kernel validation clock 不随 fix 轮顺延导致长跑 run 被误杀的问题，同时保留明确的死亡上界。

## Golden Path（核心场景）

Harness run 从首次 generator 派发进入验证时钟 → 每次成功派发 `spawn:generator-fix` 后从该行为重新起算 pipeline timeout → 最多顺延 6 次 → 健康推进的 run 在新期限内保持存活，超限 run 仍按既有规则判死。

具体：
1. 决策日志包含首次 `spawn:generator` 以及按 hop 排序的成功 `spawn:generator-fix` 行。
2. validation clock 仅依据 `orchestrator_decision_log` 行及 hop 时序，选择不超过 6 次的最后有效 fix 派发作为新原点。
3. r50 型长跑场景在旧期限之后、有效新期限之内不再误判死亡；第 7 次及以后不再延长期限。

## 边界情况

- 没有 `spawn:generator-fix` 时，原点与现有语义完全一致。
- 恰好 6 次成功 fix 派发时，第 6 次可成为新原点；超过 6 次不继续顺延。
- 日志输入以 hop 时序决定重放结果，不依赖墙钟读取、进程内计数或外部可变状态。
- 非成功派发不得成为新原点；人审 deadline 不受影响。

## 范围限定

**在范围内**：pipeline validation clock 原点的有界顺延；纯函数重放行为；r50 正向回归、超限负向回归、无 fix 语义回归；真实模块 import 的 F1 测试。

**不在范围内**：修改 `timeout_seconds` 默认值；修改人审 deadline；扩展到其他时钟；补齐真库 `loop.js` 集成测试。

## 假设

- [ASSUMPTION: `spawn:generator-fix` 的“派发成功”可由现有 decision log 行语义唯一识别，无需新增持久化字段。]
- [ASSUMPTION: step_id 未由 PrepPRD 锚定，本 sprint 按 journey 级 kernel 修复处理。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`: validation clock 对外可观察行为发生变化。
- `tests/gp/f1/`: 永久保留真实 import 的 RED→GREEN 回归测试。
- `packages/brain/DEFINITION.md`: Brain 源码变更所需版本同步。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 保持 `timeout_seconds` 默认 5400 秒；只改变合格 fix 轮后的起算原点。
- 频控: 最多顺延 6 次。
- 版本要求: 待定（PrepPRD 未指定）。
- 可观测: 结果必须能由相同 `orchestrator_decision_log` 行按 hop 时序确定性重放。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 id 去重；以下为与本 scope 直接相交的 active area 铁律 -->
- [重试身份] Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator-fix。（来源: area）
- [现有PR时钟] 保留 validation_clock_required 默认 fail-closed；existing-PR 首次 Evaluator 建钟仅限既有明确条件，后续 Judge 复用。（来源: area）
- [Planner分支] Planner workspace 必须保持服务端签发的 planner_branch，禁止 Provider checkout 或 switch。（来源: area）
- [目标环境] target_environment 必须从 Brain task payload 读取，不从本地文件推断。（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：真实 import validation-clock.js 的测试先复现旧实现误杀 r50 型 run，再证明修复后该 run 存活；同时证明第 7 次 fix 不顺延、无 fix 输入语义不变，并登记 loop.js 未覆盖真实链路。
```

## journey_type: autonomous
## journey_type_reason: 变更位于 packages/brain 的 Harness kernel 纯后端判定逻辑。
## target_environment: local_api
## target_environment_reason: task payload 明确指定 local_api，验收在本地 Brain/Node 测试环境执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
