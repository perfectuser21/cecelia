# Sprint PRD — Brain Tick Status 增加 uptime 字段

## 背景

`GET /api/brain/tick/status` 是 Brain 最常用的健康检查端点，返回 tick 循环的全面状态信息。当前缺少一个基础但重要的字段：Brain 进程已运行多长时间（uptime）。运维排查时经常需要知道 Brain 上次重启是什么时候，目前只能通过 `ps` 或日志推断。

## 目标

在 tick/status 响应中增加 `uptime_seconds` 和 `started_at` 字段，让调用者一眼看到 Brain 进程的运行时长和启动时间。

## 功能列表

### Feature 1: uptime 字段
**用户行为**: 调用 `GET /api/brain/tick/status`
**系统响应**: 响应 JSON 中新增 `uptime_seconds`（整数，进程已运行秒数）和 `started_at`（ISO 8601 时间戳，进程启动时间）
**不包含**: 不统计历史重启次数，不记录重启原因

## 成功标准

- 标准 1: `curl localhost:5221/api/brain/tick/status | jq '.uptime_seconds'` 返回一个正整数
- 标准 2: `curl localhost:5221/api/brain/tick/status | jq '.started_at'` 返回一个有效的 ISO 8601 时间戳
- 标准 3: uptime_seconds 的值应与 `started_at` 到当前时间的差值一致（误差 ≤2 秒）

## 范围限定

**在范围内**: tick.js 中记录启动时间，getTickStatus 函数返回 uptime 相关字段
**不在范围内**: Dashboard UI 展示、持久化存储启动历史、重启告警

## 预期受影响文件

- `packages/brain/src/tick.js`：在模块顶层记录启动时间戳，在 `getTickStatus()` 返回对象中增加 `uptime_seconds` 和 `started_at` 字段
