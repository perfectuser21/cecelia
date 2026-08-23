# Sprint PRD — kernel validation clock 按 fix 轮有界顺延

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：消除健康长跑 Harness run 被固定 pipeline deadline 误杀的风险

## 背景

`resolveValidationClock` 当前从 `spawn:generator` 起固定计算 `timeout_seconds`（默认 5400 秒），不会随成功派发的 `spawn:generator-fix` 更新原点。多轮修复仍在健康推进的 run 因而会被误判死亡。本 sprint 修复 kernel validation clock 不随 fix 轮顺延导致长跑 run 被误杀的问题。

## Golden Path（核心场景）

Harness 从 generator 首次派发 → 经由若干成功的 generator-fix 派发继续修复 → validation clock 使用最近一次允许的 fix 派发作为原点，健康 run 继续存活；超过顺延上限则仍按 deadline 判死。

具体：
1. validation clock 读取可重放的 `orchestrator_decision_log` hop 时序。
2. 每次成功的 `spawn:generator-fix` 在上限内成为新的 pipeline deadline 原点，并重新起算原有 `timeout_seconds`。
3. 第 7 次及之后不再顺延；无 fix 轮时保持现有语义。
4. r50 型长跑场景在旧行为下判死、在新行为下存活，结果可由真实模块回归测试观察。

## 边界情况

- 恰好 6 次成功 fix 派发允许顺延；超过 6 次照常判死。
- 未成功派发、非 `spawn:generator-fix` 行不得重置原点。
- decision log 重放相同 hop 序列必须得到相同结果。
- 没有 fix 轮、日志为空或仅有初始 generator 时保持既有行为。

## 范围限定

**在范围内**：pipeline validation clock 的 fix 原点选择、有界计数、纯函数回放，以及 `tests/gp/f1/` 中真 import 的 RED→GREEN 回归测试。

**不在范围内**：修改 `timeout_seconds` 默认值；修改人审 deadline；扩展 `loop.js` 真实集成链路。该接缝登记为「未覆盖真实链路清单」。

## 假设

- [ASSUMPTION: “派发成功”由 decision log 中既有成功动作语义判定，不引入外部状态。]
- [ASSUMPTION: 本 sprint 锚定 F1；payload 未提供 map_repo，Unified Map 状态为未配置，不做额外领域猜测。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`：validation clock 对外可观察行为变化。
- `tests/gp/f1/validation-clock-fix-extension.test.js`：永久保留的 r50、超限、无 fix 回归测试；Test Contract 登记后文件必须真实创建并提交。
- `packages/brain/DEFINITION.md`：Brain 源码行为版本同步。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 保持 `timeout_seconds` 既有值与默认 5400 秒不变
- 频控: 每个 pipeline 最多顺延 6 次
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 结果必须可由 decision log 重放；不依赖当前时间之外的可变外部状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本 scope 直接适用的 active area 铁律 -->
- [已有 PR 时钟] validation_clock_required 保持默认 fail-closed；existing-PR evaluator 建钟规则不得回退（来源: area）
- [派发身份] Generator 基础设施失败必须重试原始派发动作，generator-fix 仍重派 generator-fix（来源: area）
- [真环境验证] 依赖真实调用方的接缝未真验只能标 logic-done-pending，不得标 done（来源: area）
- [合同实跑] 合同中的验证命令必须实跑确认真实 exit code 语义（来源: area）
- [证据窗口] evaluator 必须把一手证据和 Red→Green 时序排入 judge 可消费窗口（来源: area）
- [测试入册] Test Contract 固定格式登记的测试文件必须真实创建并提交（来源: area）
- [Red 精确提交] Red commit 只加入精确测试路径，不混入非测试文件（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私和 PII 不得明文进入日志（来源: area）
- [禁止环境假设] 环境假设值不得写死，必须由输入推导或真实校准（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本
# 期望验收点：真 import validation-clock.js 的测试先证明 r50 场景旧判死，再证明修复后 1-6 次 fix 顺延存活、超限判死、无 fix 语义不变；loop.js 接缝明确列入未覆盖真实链路清单。
```

## journey_type: autonomous
## journey_type_reason: 变更位于 packages/brain/src/orchestrator 的纯后端 Kernel 行为。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api，在本地 evaluator 真 import Brain 模块验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
