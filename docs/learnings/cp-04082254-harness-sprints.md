### 根本原因

实现 `/api/brain/health` 的 `tick_stats` 字段，追踪 tick 执行总次数、最近执行时间（上海时区）和最近耗时。
- `TICK_STATS_KEY` 持久化到 `working_memory`，Brain 重启后 `total_executions` 累积不丢失
- `last_executed_at` 格式为 "YYYY-MM-DD HH:mm:ss"（UTC+8），通过 `toISOString()` 偏移 8h 实现
- `uptime` 字段通过 `process.uptime()` 提供，向后兼容已有 `status` 字段

### 下次预防

- [ ] `tick_stats` 从 working_memory 读取，须在 `getTickStatus()` 的 IN 列表里加 key
- [ ] `executeTick()` 中 `now` 变量是 tick 开始时刻，duration 用 `Date.now() - tickStartTime`
- [ ] 上海时区格式：`new Date(ts + 8*3600*1000).toISOString().replace('T',' ').substring(0,19)`
