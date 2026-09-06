## Brain {VERSION} — worker 池第四病：残留 claude 占槽 + 重复发射（僵尸检测 + 发射后探活）

- `worker-pool-dispatch` 发射前僵尸检测：busy 槽在 DB 里找不到在途任务对应（dispatch_events ⨝ tasks，
  `claimed_by='interactive-dev-skill'` 且 status 在途）即判空启动残留 claude，`kill-session` 后按 missing 重建。
  三重保守：只碰 slot7-9、只杀无在途任务认领的、查库失败一律不杀。僵尸不再白占产能，也杜绝 send-keys
  打进残留 claude 的 composer。
- `worker-pool-dispatch` 发射后阻塞探活：send-keys 后轮询 `pane_current_command`（默认 10s 窗口 / 2s 一探），
  确认 pane 真离开 shell 才计 dispatched；超时记 `failed_dispatch(liveness_timeout)` + 回滚预占 claim。
  同时根治同轮与跨轮重复发射——跨轮现场案：16:38 A 发射到 slot8 后 claude 未接管，16:43 下一轮探测仍判
  idle，B 又发同槽，命令打进 A 的 composer。
- 槽位游标 `slotIdx` 改为成败都推进：旧代码发射失败时不推进，第二个任务照打同一个槽（同轮重复发射）。
- 探活窗口可调：`CECELIA_WORKER_LIVENESS_TIMEOUT_MS` / `CECELIA_WORKER_LIVENESS_POLL_MS`。
