# Learning：P1/P2 告警汇总 5 个月从未发出（任务 309d864c）

- 现象：0929 定时引擎 recurring_* 的 P2 告警没人收到；生产 `GET /api/brain/alerting/status` 显示 p1/p2_pending 有积压，但 last_p1_flush/last_p2_flush 均为 null。
- 根因：
  - flushAlertsIfNeeded 只挂在废弃的 tick-runner.executeTick——与 recurring_tasks 停摆同一类"调度入口迁移漏搬"；
  - 即使在跑，P1/P2 缓冲纯内存，一天多次部署重启就清空，P2 的 24h 窗口永远等不到。
- 教训：
  - executeTick 里剩下的 fire-and-forget 调用都要逐个核对是否已迁到 scheduler-jobs，迁移必须带注册表断言测试。
  - 任何"攒一段时间再发"的缓冲都必须落库（连同上次发送时间），否则在高频部署系统里等价于丢弃。
  - 持久化恢复失败时不能写库，否则内存空态会覆盖库里未发项。
