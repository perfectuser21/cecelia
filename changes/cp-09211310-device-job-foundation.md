## Brain {VERSION} — device_job 地基：类型闸 + 防 tick 抢跑双闸 + Notion 投影隔离 + row_version

- `migration 457`：`tasks_task_type_check` 纳入 `device_job`（安卓工作机的活），列表取自生产库而非抄旧 migration；`tasks` 加 `row_version INTEGER NOT NULL DEFAULT 0` 作乐观锁依据（`updated_at` 被 tick 定时 touch，不能当锁）。
- `dispatch-helpers.js`：`device_job` 进 `task_type NOT IN` 黑名单。派发谓词是黑名单制、无白名单，漏了这道会被 2 分钟一轮的 tick 抢去派给执行体真的"跑一轮采收"，撞 invariant `96054a8b`。第一道闸是建单强制 `payload.headed_manual=true`，两道缺一不可。
- `notion-push-sync.js`：`pushTasks` 取数提为导出常量 `PUSH_TASKS_QUERY` 并加 `task_type <> 'device_job'`。每轮 `LIMIT 10` 的窗口装不下手机单（一天约 270 次状态翻转），挤进去会连累 harness/决策的 Notion 同步。手机的活走"每机每天一条汇总"的独立通道。
- 守卫：`__tests__/device-job-foundation.test.js`（10 条，四条变异已实测全部报红）+ `scripts/smoke/device-job-foundation-smoke.sh`（真库验证四道闸拦得住，带对照组）。
