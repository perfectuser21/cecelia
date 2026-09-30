## Brain {VERSION} — 外部 run 镜像不再被 liveness 探针零证据回队（任务 0004aceb，决策 3c98fb36 阶段1）

- `executor.probeTaskLiveness`：workflow_run / device_job（payload.source=cron）镜像单豁免 `no_spawn_evidence` 安全回队（09-30 实证 1e84cbad 五次被 watchdog_headed_requeue 回队并清 started_at，与 wall-report 阶段回执振荡；lost-deadline 4.5h 永远算不到、commander-watchdog 起跑判据被重置）
- 活性改看镜像心跳，年龄在 SQL 内算（`lib/external-mirror-liveness.js` EXTERNAL_ACTIVITY_AGE_SQL：task_runs 阶段回执 / payload.commander_heartbeat_at / executed_at / updated_at / started_at 最新者；tasks.*_at 是无时区列，JS 解析会漂 8 小时）；超 30 分钟（env EXTERNAL_HEARTBEAT_STALE_MS）只记 task_events `external_liveness_stale`（每陈旧窗口一次），不回队、不清 started_at，出路归 workflow-run-lost-deadline / commander-watchdog
- 既有行为不动：领单器 device_job（非 cron）认领超龄仍走 0923 回队；headed_manual dev 任务零证据仍安全回队（铁律 9f14c074）
- 回归：`external-run-mirror-liveness.test.js`（6 例）+ `external-mirror-liveness.pg.integration.test.js`（真库钉判龄 SQL 5 例）
