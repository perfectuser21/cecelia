## Brain {VERSION} — harness_initiative 限定为有头账本类型（建单入口拒无头）

- 建单闸 assertTaskTypeHasExecutor 去掉对 retired-harness-kernel 的放行：无头 queued harness_initiative 建单即拒（422 `no_executor_for_task_type`，不再进队等 dispatcher drain 成 failed）。有头账本行（payload.headed_manual 字符串 "true" 或布尔 true）与非 queued 入账（in_progress / blocked / 终态）不受影响；finalizeHarnessTask 收账只作用于已存在行，不经建单闸。planner recovery 的 kernel 续跑后继被拒时回 410 `planner_recovery_kernel_retired`（事务回滚，原为 500）。/dev 路径 C 与 line-strategist 路径C 改建 coding_workflow 单，7 个 harness-* skill 标注已废弃（engine 19.7.5）。任务 3e82f891（车道 A3+A4）。
