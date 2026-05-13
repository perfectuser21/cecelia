# PRD: consciousness-loop guidance TTL — 防 stale decision 误导调度

## 背景

`tick-scheduler.js` 每次调度通过 `getGuidance('strategy:global')` 读取全局策略。该 guidance
由 consciousness-loop 的 `decisionNode` 写入，TTL 设为 24h。

问题：consciousness-loop 若长时间未运行（如被静默），旧 decision（含 `decision_id`）会被调度器
持续使用长达 24h，导致"retry bb776b90"类死循环 action 误导 dispatcher。

## 目标

给 `getGuidance()` 加 **DECISION_TTL_MIN 短路 TTL**（默认 15 分钟）：
- 当 guidance value 含 `decision_id` 字段时，检查 `updated_at` 距今是否超过阈值
- 超过则返回 `null`，让 caller 走 `EXECUTOR_ROUTING` fallback
- 通过环境变量 `DECISION_TTL_MIN` 可覆盖默认值

## 成功标准

- `getGuidance` 对含 `decision_id` 的 5 min 旧 guidance 正常返回 value
- `getGuidance` 对含 `decision_id` 的 30 min 旧 guidance（默认 TTL=15）返回 null
- `DECISION_TTL_MIN=60` 时，30 min 的 decision 仍有效
- 不含 `decision_id` 的 guidance 不受短路 TTL 影响
- 所有现有 guidance 测试仍通过
