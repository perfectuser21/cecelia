---
task_id: 3e8414f6-19a4-415a-9b27-8e6353e9c6e2
step: spec_response
upstream: ["02-review-r1.md#R-1", "02-review-r1.md#R-2"]
---
# 规格回应（第 1 轮）

### R-1
处理: 采纳
说明: 已核实场景成立——`status.js:286` 的 parseInt 会把超大值原样传给 `LIMIT $n`，`status.js:325` 的 catch 把 `err.message` 放进 `details` 返回。改动两处：① S-1 给 limit 定死上限 `MAX_TASK_LIST_LIMIT = 1000`，超上限一律 400 `invalid_limit`（不钳制），message 改为「limit 必须是 1~1000 的正整数」；单测新增 `1001`、`99999999999999999999` → 400，`1000` → 合法。已 grep 全仓库，没有调用方传 4 位以上的 limit，上限不会误伤。② S-2 把 status.js:325 的 catch 改成只记日志、响应体去掉 `details`，并加 mock `pool.query` 抛错 → 500 且无 `details` 的路由用例。Q-3 增加 `?status=queued&limit=99999999999999999999`，期望 400、无 `details`、无 "bigint out of range"。

### R-2
处理: 采纳
说明: 已核实 `tick-recovery.js:102/196` 只认 `CECELIA_TICK_HARD_OFF=1`（以及 `:112/182` 的 `BRAIN_PREVIEW`）来确定不开 tick，Q-1 原前提确实可能让 tick 认领 queued 任务。修改：① Q-1 前提启动命令加 `CECELIA_TICK_HARD_OFF=1`，并要求在启动日志里看到 `CECELIA_TICK_HARD_OFF=1 — env 硬关` 字样（其余 Q-n 都是「同 Q-1」，一并生效）；② Q-7 改成可操作的基线对比：用 main 分支在 5298 端口、同测试库同样关 tick 起改动前的 Brain，`diff` 两端 `GET /api/brain/tasks` 的 `[.[].id]`，期望两端 200 且 diff 无输出。
