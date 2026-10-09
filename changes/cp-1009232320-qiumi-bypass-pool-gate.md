## Brain {VERSION} — 任务池总闸关着时放行秋米任务，穿透 MMV 不被 fleet 槽位拦住

- `dispatchNextTask`：槽位总闸（pool_exhausted / pool_c_full）复查仍不通过且无 xian 旁路时，先探测队列里有无 `qiumi_task`；有则放行，且候选循环只选 `qiumi_task`（普通任务照旧被拦）。`resourceAdmissionBlocked` 早退不变——资源数据不可信时秋米也不派。
- `selectNextDispatchableTask` 新增 `options.onlyTaskTypes`（非空数组时 SQL 限定 task_type；null / 空数组 = 不限定）。
