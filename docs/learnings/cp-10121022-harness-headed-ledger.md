## harness_initiative 限定为有头账本类型 + 编码点火文档改投 coding_workflow（2026-10-12）

### 根本原因

- A1（#6324）只关了无头 kernel 派发，建单闸对 `retired-harness-kernel` 特判放行——当时编码建单方还没改投，直接拒会回滚 GP 签字等上游事务。A2（#6346）改投后，放行只剩一个效果：让必死的无头单进队，再被 dispatcher drain 成 failed。
- 收紧后唯一还会建无头 queued harness_initiative 的是 planner recovery 的 kernel 续跑后继（A2 留下的 `kernel_continuation`）。生产 `planner_recovery_consumptions` 历来 0 行、initiative_runs 10-02 后停写；被拒时原本会掉进路由的 500 兜底，所以映射成 410 `planner_recovery_kernel_retired`。
- 文档侧：/dev 路径 C 和 line-strategist 路径C 仍教 POST `task_type=harness_initiative` 点火，照做在 A4 后直接 422。

### 下次预防

- [ ] 关一个执行入口的三步顺序：先关派发（drain）→ 建单方改投新类型 → 最后收紧建单闸；收紧前 grep 所有以 queued 建该类型的调用方（含 `kernel_continuation` 这类为兼容保留的旁路），给每个一个明确 4xx。
- [ ] 改建单闸后必须跑 pg 集成测试（planner-recovery-* 这类走真 createRoutedTask 的），单测 mock 了 createRoutedTask 看不出来。
- [ ] 点火文档（engine/workflows SKILL）跟着执行面一起改，并用守卫测试钉住「不再教旧类型」，否则会话照文档建单会撞 422。
