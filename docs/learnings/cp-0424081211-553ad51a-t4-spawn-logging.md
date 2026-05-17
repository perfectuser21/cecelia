# T4 spawn-logging fail-fast Learning

## 做了什么
改 `packages/brain/src/spawn/middleware/logging.js:createSpawnLogger`：加 `taskIdMissing` 旗标 + `ctx.warn` 注入，`logStart()` 入口缺 `opts.task.id` 时 `console.warn('[spawn-logger] missing task.id ...')`，不再静默落到 `'unknown'`。

## 根本原因
Phase B2 forensic 发现 Brain docker logs 17+ 条 `taskId=unknown` 8+ 小时无人报警（监控盲区）。根源：`logging.js:16` 对缺 task.id silent fallback `|| 'unknown'`，调用方一旦传错/忘传 opts.task 不产生任何信号。

## 下次预防
- [ ] 给 `'unknown'` 类 fallback 字符串全仓 grep，都应有显式 warn 或 metric
- [ ] 日志中出现 `unknown` / `undefined` 占比 >1% 要入告警 dashboard
- [ ] spawn 中间件要有"缺 opts 必需字段"的一律 warn 约定

## 关键决策
只改 `taskId` fallback（YAGNI），`taskType` / `skill` 缺失严重性低不改避免日志噪音。`ctx.warn` 注入对齐现有 `ctx.log` 模式便于测试。
