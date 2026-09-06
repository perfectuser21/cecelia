## Brain {VERSION} — 并行血管P1:worker池自动派发 scheduler job

- 新增 `worker-pool-dispatch` scheduler job(5min自gate):扫 queued 的 parallel_worker/canvas+exploratory 任务→tmux slot7-9 发射交互 /dev worker(slot1-6 是 harness 地盘,白名单铁律进 smoke)
- 并发上限2;CAS 预占 claimed_by=interactive-dev-skill(/dev claim 409 预占约定);发射即记 dispatch_events,失败 failed_dispatch+回滚 claim
- prompt 经宿主文件交付;SSH 逃逸对齐 harness headed 先例(任务 873acc6d)
