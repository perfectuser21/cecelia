## Brain {VERSION} — 调度 job 入运行舱 + notion-gtd-sync 整轮有界（09-24 卡死 8.4h 根治）

- 新 job `scheduler-liveness`（JOBS 末尾）：working_memory 哨兵 → `ops_workflows(source='scheduler')`，活性按声明间隔算（`classifyDeclaredLiveness`，不走冷启动门槛），翻转 dead 按轮合并一条 Bark（无 token 回退 P1）、恢复 P2；只写机器列，10 分钟降噪，dead 行静默秒数持续刷新，下线 job 置 cold，失败写 `scheduler` 来源心跳。
- `notion-gtd-sync` 整轮总超时（`QIUMI_SYNC_ROUND_TIMEOUT_MS`，默认 5min，非法回落）+ 步名按轮次门控 + 超时后旧轮在步边界停下 + `liveness_at`（无完成轮取循环启动时刻）。
- 哨兵 record 透传 handler 自报 `liveness_at`；JOBS 条目可声明 `livenessIntervalSec`。
- pg 客户端 `query_timeout`（`DB_QUERY_TIMEOUT_MS`，默认 10min）。
- 便宜闸 registry 只取 `source='n8n'`。
- 决策 69cd802f / task 50a2c256。
