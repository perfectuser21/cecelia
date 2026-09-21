## Brain {VERSION} — 「PR 已合并但无 evaluator」两条路径策略相反，PATCH 这条把账本锁死

- `relay-watchdog` 的 `_finalizeMergedRun` 对此场景早有处置（注释原文）：
  「门禁通过 → 原行为；门禁未通过 → **仍标 done/completed**（PR 客观已合并无法撤销）
  但打 failure_reason，跳过 regression 提升，并发未验收合并告警」。
  即 **放行 + 留疤 + 告警 + 不自动提升**，惩罚落在"不提升"上。
- 而 `finalizeHarnessTask`（PATCH /tasks/:id 这条路）是**硬挡**，任务永远停在 blocked。
  同一场景两条路径相反策略 —— 这是分叉不是设计。
- 硬挡还判错了对象：它假定"流水线跑过、只是验收员偷懒"。实际 0921-0922 那三条任务
  （a70d7743 / 3dc7792a / 7e7d4db5）是 tick 领走后派发撞 `map_stale` 失败，
  **流水线一步都没启动**，evaluator 记录必然不存在。拦着任务不改变"PR 已经合了"
  这个客观事实，只让账本和现实分叉。
- PATCH 路径改为照抄 watchdog 已定策略：放行、标 `merged_without_evaluator_gate`、
  复用 `_raiseUngatedMergeAlert` 开 P1、跳过 regression 自动提升、回执带
  `ungated_merge:true`。**放宽的只有 evaluator 这一条**：PR 没合并 / 查不到 PR 仍然挡。
- 守卫 6 条 + 变异 5 项全部真断言失败（含反向守卫「PR 没合并也放行 → 必须红」）。
