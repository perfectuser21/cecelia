### R-1
处理: 采纳
说明: 核实成立——`content-pipeline.js:366-379` 以 `status:'queued'` 写入 tasks，`task-type-registry.js` 登记为外部 worker 可派发，残留会被派出、进计数。改法：Q-5 末尾（Q-5 复用 `$P`，所以放在它跑完之后）加清理两步：`DELETE $B/api/brain/tasks/$P`（`task-tasks.js:526` 现成软删除，挂在 `server.js:508` `/api/brain/tasks`），期望 200 且 `.status=="cancelled"`；再 `GET $B/api/brain/tasks/$P` 确认仍是 `cancelled`。Q-4 末尾注明 `$P` 留给 Q-5，不跑 Q-5 时 Q-4 后立刻执行同样的清理。清理前几秒 `queued` 窗口，以及 cancelled 行仍会被不区分状态的计数算进去，这两点已登记到「未覆盖真实链路」。

### R-2
处理: 采纳
说明: 级别是建议，改动只有一句，顺手收下。QA 约定补充：没配 `CECELIA_INTERNAL_TOKEN` 时必须在 Brain 本机经 loopback 发请求；`/api/brain/runs/*` 返回 503 记为「环境前提不满足」，不算产品失败（依据 `internal-auth.js:74-77`）。
