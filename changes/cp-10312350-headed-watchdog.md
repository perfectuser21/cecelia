## Brain {VERSION} — 有头开发任务看门狗与恢复认领

- `harness_initiative` 的 `headed_manual=true` 是有头会话账本，按设计不产生 `initiative_runs`；never-started 扫描及事务复核均排除该类任务，保留无头任务的过期判死和旧有头任务的降级路径。
- 已阻断的有头任务必须先由真实执行者原子认领，再恢复 `in_progress`；两个通用 PATCH 入口不再用占位 `session:engine-patch` 抢占空 owner。
- 回归测试覆盖 103 真实误判形态、两个 PATCH 入口及无头僵尸处置。
- 依赖审计新增告警按上游修补版将传递依赖 `follow-redirects` 从 1.16.1 更新到 1.16.2，仅更新根 lockfile；不扩白名单。
