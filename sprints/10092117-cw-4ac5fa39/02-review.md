---
task_id: 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2d
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 9
可验证: 9
场景覆盖: 8
回归风险: 8
可执行: 9

## 上轮问题
- R-1: 关闭 —— S-2「改动文件」里已经加上 `routes/task-tasks.test.js:115,123` 和 `integration/brain-endpoint-contracts.test.js:155,170`，这 4 处 id 都改成合法 UUID，断言不变，验证命令也把这两个文件一起跑。我复核过：在 `__tests__` 里 grep `tasks/<字面量>` 形式的 GET，只剩 `task-queue-lanes-route.test.js:16`，它请求的是列表 `/`（`/api/brain/tasks/tasks?limit=10`，挂载点本身就是 `/api/brain/tasks/tasks`），走不到 `/:id`，不受影响。另外核对了 `server.js` 的挂载顺序：`brainRoutes`（L423）和其他挂在 `/api/brain` 下的路由，都没有定义 `GET /tasks/:id`，真实请求会落到 `task-tasks.js:432`；`/api/brain/tasks/tasks`（L364）挂的是同一个 router，会一起修好。`/tasks/blocked` 这类字面量路由在 `routes/tasks.js` 里，经 brainRoutes 先于 L499 挂载，不会被新加的 400 校验拦掉。
