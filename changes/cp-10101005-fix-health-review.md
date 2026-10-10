## Brain {VERSION} — 资源健康闸审查修复：挡单不占 HOL 让位名额，秋米派手机出口接健康闸

任务 a43b8ad9（父任务 5bf2512a，PR #6182 审查阻断项）。

- dispatcher 候选循环与秋米路由里被资源健康闸挡下的单改进独立的 `resourceSkipIds`，不再计入 HOL 让位上限 10；单独上限 100（超了本轮放弃，统计记 `resource_skip_cap_exceeded`）。修掉「一台手机或一个账号长期掉线，队首积压 10 张同资源单 → 每 tick hol_skip_cap_exceeded → 后面不引用资源的任务永远派不出去」。
- 秋米路由到手机（device 出口，派生 device_job 交手机领单器）在落库前过健康闸：定到的手机，以及该手机台账 `phone_registry.douyin_accounts` 里当前登录的账号，任一 offline/restricted → 不派生、放 claim、记 `resource_unhealthy`。agent 出口同样补上账号维度。新增 `lib/qiumi-resource-health.js`（`qiumiRouteHealthGate` / `phoneAccountRefs` / 被挡路由备忘）。
- 被挡的秋米单下一轮先只复查那台手机（进程内备忘 30 分钟），仍不健康直接让位、不再打 Jev，防每 tick 白路由。台账或健康表查询出错一律放行只记日志。
