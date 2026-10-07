## Brain {VERSION} — harness 成功率统计剔除"编排槽满排队" run

- 修 bug：bridge 429 orchestrator_slots_exhausted 等瞬时故障回队的 run（phase='failed'、failure_reason 以 `kernel_remote_launch_deferred:` / `kernel_reconcile_remote_requeue:` 开头）被 `?by=journey` 与战报直接计入 failed，近 60 天虚增 275 条失败（单任务 227 条）。
- 新增 `lib/kernel-launch-deferral.js`：前缀常量、`isLaunchDeferredReason`、`launchDeferredSql`（starts_with，非 LIKE）、共享聚合 SELECT `journeyRunStatsSelectSql` 与行映射 `mapJourneyRunStatsRow`。
- 覆盖范围（四处统计）：`routes/harness.js` stats?by=journey 与 `battle-report.js`（runs/done/failed/last_failure 只统计非排队 run，新增 `deferred` 计数；战报文本附"另有 N 次排队"）；`routes/warroom.js` 线健康度 success_rate 剔除排队 run；`routes/initiatives.js` relay-runs/summary 的 SLO 取"每任务最新 trusted run"时跳过排队 run。success_rate 公式不变。relay-runs/summary 的 phase 原始分布计数不动。
- `harness-skill-relay.js` / `harness-relay-watchdog.js` 生成 reason 改用常量（行为不变）；run 仍保持 phase='failed'，表结构与 kernel 运行逻辑不动。
- 回归测试：`lib/__tests__/kernel-launch-deferral.test.js`（含 JS/SQL 共用样本契约）、`harness-stats-by-journey.test.js`、`battle-report.test.js`、`warroom.test.js`、`relay-runs-summary.test.js`；relay / watchdog 测试锁定 reason 与 `isLaunchDeferredReason` 的衔接。
