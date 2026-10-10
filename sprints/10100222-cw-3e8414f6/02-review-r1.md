---
task_id: 3e8414f6-19a4-415a-9b27-8e6353e9c6e2
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 9
可验证: 7
场景覆盖: 6
回归风险: 8
可执行: 8

核对结论：现有调用方（dashboard / apps/api / engine hooks / scripts / smoke）传的 status 全部在 `TASK_STATUSES` 内（in_progress/queued/blocked/failed/completed/pending/quarantined），limit 全是正整数字面量，收紧校验不会误伤现有调用方；生效处理器定位（status.js:284 遮蔽 task-tasks.js:386）与代码一致。

### R-1
针对: S-1, S-2, Q-3, I-2
严重度: 重要
场景: QA 在 Q-3 顺手试超大 limit `curl '.../api/brain/tasks?status=queued&limit=99999999999999999999'`，正则 `/^[1-9]\d*$/` 放行，parseInt 得到 1e20 传给 `LIMIT $n`，Postgres 报 `bigint out of range`，接口返回 500 且 `details` 透出数据库报错——正是需求背景里说的"不透出数据库报错"。
依据: S-1 只规定正则格式、没有上限；`packages/brain/src/routes/status.js:325` 的 catch 仍是 `res.status(500).json({ error, details: err.message })`，S-2 没改这一处。
说明: S-1 给 limit 加上限（例如 >1000 或超过安全整数时返回 400 invalid_limit，或钳到上限，二选一写死），并在 S-1 单测与 Q-3 中加一条超大 limit 用例，期望 400（或按钳制规则返回 200），响应体无 `details`。

### R-2
针对: Q-1, Q-5, Q-7, I-3, I-4
严重度: 重要
场景: QA 按 Q-1 前提 `PORT=5299 DATABASE_URL=<cecelia_test> node server.js` 起 Brain；若测试库 `tick_enabled=true` 或环境带 `CECELIA_TICK_ENABLED=true`，`initTickLoop()` 会开始派发，Q-5 刚 POST 的 6 条 queued 任务被认领改成 in_progress（甚至真起执行器），`?status=queued&limit=5` 返回不足 5 条、Q-7 前后两次结果对不上，QA 无法判断是代码问题还是环境漂移。
依据: `packages/brain/server.js:914` 启动即 `await initTickLoop()`；`packages/brain/src/tick-recovery.js:102/112/219` 只有 `CECELIA_TICK_HARD_OFF=1` 或 `BRAIN_PREVIEW=1` 才确定不开 tick，Q-1 前提两者都没写。
说明: Q-1 前提补 `CECELIA_TICK_HARD_OFF=1`（或 `BRAIN_PREVIEW=1`）；Q-7 的"与改动前一致"改成可操作的步骤（例如同一进程下先记录 main 分支返回的 id 列表，或改为断言"200 + 数组 + 条数 ≤100 + 按 getTopTasks 排序"），否则 QA 拿不到"改动前"基线。
