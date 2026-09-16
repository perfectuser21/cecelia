## Brain {VERSION} — harness-watchdog 不再把有头会话判成 failed

- 根因：手动注册的改代码任务被 work-router 改写成 `task_type=harness_initiative`，而有头 `/dev` 执行**从不创建 initiative_runs 行**；watchdog 的 never-started 豁免只看 `claimed_at`（开工那一刻），认不出「还在干活」——认真干了 44/118 分钟的会话，和 40 分钟前就死掉的会话长得一模一样。2026-09-16 一次会话里 4 个有头任务全中。
- 更要命的是判死方式：`failed` 是终端态（状态机 `allowed: []`），API 无法回正，只能直写 DB——当天四次人工直写库都是为此。而 `executor-contracts` 给 `headed-session` 定的处置本就是 `release-claim-and-alert` 而非 fail，`zombie-reaper` 遵守、`harness-watchdog` 绕过。
- 修法：never-started 分支按 `executor_kind='headed-session'` 或 `claimed_by` 含 `interactive-dev-skill` 识别有头，降级为 `blocked`（带 `blocked_at`，满足 `chk_blocked_at_not_null`）——人工可见、可恢复、不会被 tick 抢跑重复执行。自动流水线路径仍判 `failed`（那条是对的，它本就该在阈值内建起 run）。
- 配套 `watchdog-headed-not-failed-smoke.sh` 并登记 allowlist，两道闸 proven-to-fire。
