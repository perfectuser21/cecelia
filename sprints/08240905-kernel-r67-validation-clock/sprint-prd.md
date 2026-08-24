# Sprint PRD — kernel validation clock 按 fix 轮有界顺延

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：消除健康长跑 Harness run 因固定 validation clock 被误杀的风险

## 背景

`resolveValidationClock` 当前从 `spawn:generator` 起固定计算 pipeline deadline；多轮修复仍健康推进的 run 会超时判死。本 sprint 修复 kernel validation clock 不随 fix 轮顺延导致长跑 run 被误杀的问题，同时保持超时保护有界且可重放。Unified Map 未配置：task payload 缺有效 `map_repo`，不做领域猜测。

## Golden Path（核心场景）

Harness run 从 generator 进入验证时钟 → 每个成功的 `spawn:generator-fix` 至多六次成为新时钟原点 → 在最新有效原点的 `timeout_seconds` 内继续推进，超时或超限则仍按既有规则判死。

具体：
1. validation clock 读取同一 run 的 `orchestrator_decision_log` hop 时序，并识别成功派发的 `spawn:generator-fix`。
2. 第 1—6 次成功 fix 派发分别重置 pipeline deadline；失败派发不顺延，第 7 次及以后不再顺延。
3. 相同日志输入重复计算得到相同 deadline；无 fix 轮时结果与现有语义一致。
4. r50 类场景在最新有效 fix 原点的时限内保持存活；真正超过有效 deadline 时输出既有死亡判定。

## 边界情况

- 零次 fix、失败的 fix 派发、同 hop/乱序输入不得产生额外顺延。
- 恰好六次可顺延；超过六次仍以第六次成功派发为最后原点并照常判死。
- 不改变 `timeout_seconds` 默认值 5400 秒，不改变人审 deadline。

## 范围限定

**在范围内**：pipeline validation clock 原点选择；六次顺延上限；纯函数回放；r50 正向与超限、无 fix 负向冻结测试；合同四件套由后续角色补齐。

**不在范围内**：调整默认超时；修改人审 deadline；声称 `loop.js` 真库集成链路已覆盖。

## 假设

- [ASSUMPTION: “派发成功”以 `orchestrator_decision_log` 中已落盘的成功 `spawn:generator-fix` 决策行为为准。]
- [ASSUMPTION: 同 hop/乱序日志由既有 hop 排序语义确定先后，不引入墙钟或当前时间作为选择依据。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`：validation clock 对外行为变化。
- `tests/gp/f1/`：真实 import 上述模块的永久冻结回归测试，禁止 mock 被改的边。
- `packages/brain/DEFINITION.md`：Brain 源码行为变更对应版本同步。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: `timeout_seconds` 默认值保持 5400 秒
- 频控: 成功 `spawn:generator-fix` 最多顺延 6 次
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 结果仅由 decision log hop 时序重放，不依赖当前墙钟状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅列与本 scope 可执行相关项 -->
- [重试身份] Generator 基础设施失败必须重试原始服务端派发动作，generator-fix 仍重派 generator-fix（来源: area）
- [既有时钟] validation_clock_required 默认 fail-closed；既有 PR 特例仅按已登记条件建立共享时钟（来源: area）
- [真环境验证] 未覆盖的真实调用接缝只能登记为未覆盖，不得宣称 done（来源: area）
- [禁写死环境] 环境假设值不得写死，必须从输入推导（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本
# 期望验收点：真 import validation-clock.js 的冻结测试先证明旧实现把 r50 类健康 run 判死，再证明修复后其存活；同时证明第 7 次不顺延、零 fix 语义不变，并把 loop.js 真库集成接缝登记为未覆盖真实链路。
```

## journey_type: autonomous
## journey_type_reason: 变更范围是 packages/brain 纯后端 kernel validation clock 行为。
## target_environment: local_api
## target_environment_reason: Brain 内部纯函数与本地冻结测试在 fleet-worker 本地 API 环境执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: F1（PrepPRD 锚定）
