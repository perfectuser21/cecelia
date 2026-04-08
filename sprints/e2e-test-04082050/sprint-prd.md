# Sprint PRD — Brain tick 日志时间戳前缀

## 背景

Harness v4.0 链路修复后，需要端到端验证整条 Pipeline 可跑通。
本次选取一个真实但范围明确的功能需求：为 Brain tick 日志加时间戳前缀，用于验证 Planner → Proposer → Generator → Evaluator 完整链路。

## 目标

在 Brain tick 输出的每条日志前加上 `[TICK HH:MM:SS]` 格式的时间戳前缀，方便运维人员快速定位时序问题。

## 功能列表

### Feature 1: tick 日志时间戳前缀

**用户行为**: 运维人员查看 Brain 服务日志
**系统响应**: 每条 tick 相关日志以 `[TICK HH:MM:SS]` 开头，时间为当前本地时间，格式为两位小时:两位分钟:两位秒
**不包含**: 非 tick 模块的其他日志、日志文件写入、日志格式结构化（JSON）

## 成功标准

- 标准 1: Brain 服务启动后，tick 日志每条均以 `[TICK` 开头，后跟 `HH:MM:SS]` 格式时间
- 标准 2: 时间戳格式正确（24小时制，两位补零，如 `[TICK 09:05:03]`）
- 标准 3: 非 tick 日志不受影响

## 范围限定

**在范围内**: `packages/brain/src/tick.js` 中的 tick 日志输出语句
**不在范围内**: 其他模块日志、日志持久化、日志聚合、告警规则
