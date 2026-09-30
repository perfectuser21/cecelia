## Brain {VERSION} — 手机忙时秋米任务排队等待，不再直接「受阻」收尾

- dispatcher 同机串行闸（routing/qiumi-serial-gate.js）：qiumi_task 的 `payload.qiumi_route.device_hint.serial` 非空、且已有另一张 in_progress 秋米任务落在同一 serial → 本轮不派（保持 queued、放 claim、按 HOL skip 换下一个候选），记 task_events `qiumi_dispatch_device_busy`（同一占用者只记一次）。
- 收割器（reapOpenclawAgentRuns）：最终文本含 `DEVICE_BUSY owner=<持有者> serial=<序列号>` 标记行 → 不判终态，回 queued、清 run_id（保留路由）、`next_run_at=now+5min`、`device_busy_attempts+1`、status_history 留痕、清中文表回写指纹；累计等待超过 min(任务超时, 120 分钟) 或已过 `payload.expires_at` → failed(device_busy_timeout)。
- 回队任务再派：有路由、无 run_id、`device_busy_attempts>0` → 不重打 Jev，只换新 run_id。
- 中文「OpenClaw结果」等待期显示「⏳ 手机忙（被 <owner> 占用），已排队，<HH:MM> 后重试（第 N 次）」。
- executor prompt 设备提示段加 DEVICE_BUSY 约定：不要抢锁、不要操作，最后一行只输出标记行后结束。
