## Brain {VERSION} — P1/P2 告警汇总复活（缓冲落库 + 登记现役调度）

- 根因：① flushAlertsIfNeeded 只挂在废弃的 tick-runner.executeTick（2026-05 Wave 2 起不再调用），生产 `/api/brain/alerting/status` 的 last_p1_flush/last_p2_flush 均为 null——P1 每小时 / P2 每日汇总自 5 月从未发出；② P1/P2 缓冲纯内存，Brain 一天多次部署重启即清空，0929 recurring_* 等 P2 告警静默丢失。
- scheduler-jobs 新 job `alerting-flush`（60s 轮，自带 P1 1h / P2 24h 门控）。
- alerting 缓冲与上次刷新时间镜像到 working_memory key `alerting_buffers`（每级最多落最近 500 条）：raise 追加后写库；flush 发送后才写回清空态（至少一次）；首次使用时恢复重启前未发项；读写串行、未恢复成功前不写库（防空态覆盖）；持久化失败只 console.warn 降级仅内存。P0 立即推送 / 5 分钟限流 / debounce 语义不变。
