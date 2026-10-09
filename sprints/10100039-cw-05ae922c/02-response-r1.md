---
task_id: 05ae922c-4f2a-4c1c-9f86-d24937fc32d3
step: spec_response
upstream: ["02-review-r1.md#R-1", "02-review-r1.md#R-2", "02-review-r1.md#R-3", "02-review-r1.md#R-4"]
---
# 规格回应（第 1 轮）

### R-1
处理: 采纳
说明: 已核实 `src/routes/__tests__/task-projects.test.js:107-132`（`/projects/non-existent`、`/projects/p1` + `countParams ['p1']`）和 `src/__tests__/routes/task-goals.test.js:114-156`（`/goals/non-existent`、`/goals/g1`、`/goals/kr1`）都用了非 UUID 的 id，加校验后会变成 400。S-1、S-2 的验证部分已写明：这 5 个 GET 用例改用固定的合法 uuid（`00000000-0000-4000-8000-0000000000xx`），mock 返回行的 id、`countParams` 和 `res.body.id` 断言同步改；404 文案、查询 2 次、先查 objectives 再查 key_results 的断言保持不变，不删任何用例。PATCH 路由不在本次校验范围内，相关用例不改。验证方法：S-5 的全量 vitest 跑通。

### R-2
处理: 采纳
说明: 已核实 `db-config.js:19` 非 test 环境下默认连 `cecelia` 库，且 tick loop 只有设置 `CECELIA_TICK_HARD_OFF=1` 才会跳过启动（`tick-recovery.js:196`）。公共前提已改成三步，可照抄执行：①`bash packages/brain/scripts/setup-test-db.sh` 准备 cecelia_test 并跑 migrations；②`DB_NAME=cecelia_test CECELIA_TICK_HARD_OFF=1 PORT=5299 node server.js` 启动；③就绪检查 `$B/dev-records?limit=1` 返回 200 后再执行 Q-n。

### R-3
处理: 采纳
说明: Q-1 的期望确实自相矛盾：要求的正确文案里本身就含 `UUID`。现在公共前提统一规定，"数据库报错原文"只按 `invalid input syntax`、`for type uuid`、`22P02`、`LIMIT must not be negative` 判定，并注明不能用 `uuid` 判定。Q-1 改为 `grep -cE 'invalid input syntax|for type uuid|22P02' /tmp/q1.json` 结果为 0；Q-2、Q-3 用同一组禁用串，三条场景的判定口径一致。

### R-4
处理: 采纳
说明: 已核实 `src/routes/__tests__/task-goals.test.js` 和 `dev-records.test.js` 都没有 mock `db.js`。S-2 的新增用例改放到已有 mockPool 的 `src/__tests__/routes/task-goals.test.js`。S-4 写明在 dev-records.test.js 里照 `journeys-get-features.test.js:4` 的写法加 `vi.mock('../../db.js', ...)`，再用 express + supertest 挂路由，测试不会连到真库。
