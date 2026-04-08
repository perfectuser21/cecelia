# Sprint PRD — Brain Tick 日志时间戳前缀

## 背景

Brain tick 循环每 5 秒运行一次，产生大量日志输出。当前日志行没有时间戳，排查问题时无法确认事件发生的精确时间，影响调试效率。

## 目标

为 `packages/brain/src/tick.js` 中所有 Brain tick 日志行自动添加 `[HH:MM:SS]` 时间戳前缀，使运维人员能在日志中直接看到每条记录的发生时间。

## 功能列表

### Feature 1: Tick 日志时间戳前缀

**用户行为**: 运维人员查看 Brain 进程的标准输出日志  
**系统响应**: 每条由 tick.js 输出的日志行以 `[HH:MM:SS]` 格式的当前时间开头，时间为服务器本地时间（上海时区 UTC+8）  
**不包含**: 不修改 tick.js 以外模块的日志格式；不引入外部日志库；不改变日志内容本身

## 成功标准

- 标准 1: Brain 启动后，tick 日志每行均以 `[HH:MM:SS]` 格式时间戳开头，例如 `[14:23:05] Tick started`
- 标准 2: 时间戳仅修改 `packages/brain/src/tick.js` 文件，不影响其他模块
- 标准 3: 现有 tick 功能（任务派发、健康检查、调度等）行为不变

## 范围限定

**在范围内**:
- `packages/brain/src/tick.js` 中的 `console.log` / `console.warn` / `console.error` 输出添加时间戳前缀

**不在范围内**:
- 其他模块（executor.js、decision.js 等）的日志格式
- 结构化日志（JSON 格式）改造
- 日志等级过滤
- 外部日志系统集成
