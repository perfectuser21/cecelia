## Brain {VERSION} — recurring_tasks 定时引擎复活

- 根因：checkRecurringTasks 只挂在废弃的 tick-runner.executeTick（5 月起停摆，最后实例 05-09）；matchesCron 要求当前分钟恰好命中且按服务器本地时区；source_id 用 now 防不住重复；建单不透传 assigned_to/due_at；escalation 把 recurring 当系统自产会批量暂停/取消主理人排的定时单。
- scheduler-jobs 新 job `recurring-tasks`（每轮，单模板 try/catch 隔离）：北京时区（template.timezone 可覆盖）；next_run_at 为唯一下一时间点、now≥即到点；首次启用 / PATCH 重新启用 / 改 cron 只写基线不补跑；迟到超 catchup_minutes（默认 30）记 missed + P2；CAS 占位后才建单，source_id=`recurring:<id>:<时间点>`；同模板有 queued/in_progress/paused/blocked 实例跳过（skip_streak，连续 3 次告警）；透传 task_type/priority/dept/payload/assigned_to，due_at=时间点+due_offset_minutes，expires_after_minutes→payload.expires_at 过期未认领取消（unclaimed_expired）；落后 >10min 告警一次。实例标题带时间点（避开迁移 074 的 title+cancelled 唯一索引）。
- 迁移 489：recurring_tasks.skip_streak；状态机 queued→cancelled；escalation SYSTEM_AUTO_TRIGGER_SOURCES 移除 recurring；routes/recurring POST/PATCH/GET 收发 template、task_type。
