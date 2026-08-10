# Sprint PRD — 阻断类状态位 TTL 自愈 + 健康检查可见性

- task_id: `d33c81ab-a4c5-4a9c-99e6-65d71850860a`
- gear: hotfix · P0
- 法源：工厂 · F1 开发闭环（journey e6f803f2）· 步1「接单进车间即分档」(3bf6c116) · 动作=加厚

## 问题

会阻断派发的状态位没有 TTL、没有自愈、没有告警，系统可以长时间「健康地」停摆而无人察觉。
2026-08-10 当天同类问题出现三次，最长一次两天：

1. **tick_draining 卡 2h20m** — 排空模式被置位后无人取消，`dispatcher.js` 每轮直接
   `return {dispatched:false, reason:'draining'}`，5 条 P0 harness 任务全程 queued 零派发，
   同期 `/api/brain/alertness` 报 `level=1 CALM / "System is healthy"`。
2. **machine_vitals_stale_alert 卡 2 天** — 底层条件早已恢复（docker 正常），哨兵键从不自动清除。
3. **舰队 worker 攥住陈旧状态** — 属宿主进程范畴，本次仅记录，不修。

共性：进程活着、健康检查绿、日志无异常，系统安静停在错误状态里，比崩溃难发现。

## 实现（对应验收）

1. **阻断位 TTL 自愈**（覆盖 `tick_draining`）：置位超 TTL（默认 30min，`DRAIN_TTL_MS` 可覆盖）
   且无人续期 → 自动退出该状态、记 `auto_recovered` 事件、发告警（说明曾卡多久、已自动解除）。
   落点：`blocking-states.reconcileBlockingStates()`，由 `dispatcher.dispatchNextTask()` 每轮开头调用。
2. **stale 哨兵自愈**（覆盖 `machine_vitals_stale_alert`）：采样重新成功即清哨兵键；重启后
   in-memory 标志丢失也能靠「首次成功采样无条件清一次」清掉残留。落点：`machine-vitals.js`。
3. **健康检查可见「静默停摆」**：`/api/brain/alertness` 新增 `blocking_states` 数组（列出生效阻断位
   及持续时长）；存在活跃阻断位时 `healthy=false` 且不再报 CALM。落点：`routes/tick.js` + `summarizeHealth()`。
4. **可观测兜底**：排空生效期间派发器每 N 轮（`DRAIN_SUMMARY_EVERY_N`，默认 5）打印一条汇总日志
   （已排空多久、挡住多少候选）。落点：`blocking-states.maybeLogDrainSummary()`。

## 验收断言

- TTL 触发：draining + `drain_started_at` 31 分钟前 → reconcile → 状态位清除 + `auto_recovered` 事件 + 告警。
- 不误伤：draining + `drain_started_at` 5 分钟前 → reconcile → 仍 draining、无事件无告警。
- 哨兵自愈：采样先失败（哨兵建立）再成功 → 哨兵键被删除。
- 健康红线：draining → `blocking_states` 非空且含 tick_draining 及持续时长；`healthy=false`。
- 汇总日志：排空生效连续 N+1 轮 → 至少一条含「已排空时长 + 被挡候选数」的汇总日志。
- 零回归：dispatcher / machine-vitals 既有单测全绿；显式 drain 与 drain-cancel 语义不变。

## 边界

只做「阻断类状态位 TTL 自愈 + 可见性」，不改 drain 触发条件、不改 alertness 分级算法、
不改 harness slot 判定逻辑本身，不动 fleet worker 宿主侧实现。自动解除必须留痕并告警，禁止静默自愈。

## 测试

- `packages/brain/src/__tests__/blocking-states.test.js`（新增，覆盖 4 项实现 + 6 条断言）
- `packages/brain/src/__tests__/machine-vitals.test.js`（新增「重启残留自愈」用例）
- 真环境：`packages/brain/scripts/smoke/blocking-state-selfheal-smoke.sh`（real-env-smoke 跑）
