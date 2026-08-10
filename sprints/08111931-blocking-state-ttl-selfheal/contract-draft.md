# Contract — 阻断类状态位 TTL 自愈 + 健康检查可见性

- task_id: `d33c81ab-a4c5-4a9c-99e6-65d71850860a`
- gear: hotfix · P0
- scope: `packages/brain`（TTL 自愈 + stale 哨兵自愈 + 健康检查可见性 + 排空可观测）

> CONTRACT IS LAW。合同来源为 TaskBundle 锁定的 thin PRD 验收断言（fleet 直实现档，无独立 GAN 轮）。

## 接口 / 行为约定

### B1 阻断位 TTL 自愈（`blocking-states.reconcileBlockingStates`，dispatcher 派发闸前每轮调用）
- `tick_draining` 置位超 TTL（默认 30min，环境变量 `DRAIN_TTL_MS` 可覆盖）且无人续期 → 自动退出该状态
  （`cancelDrain()`），记一条 `auto_recovered` 事件（`cecelia_events`，payload 含曾卡时长），发一条告警
  （说明「曾卡多久、已自动解除」）；解除后同一轮 queued 任务可被派发。
- 未超 TTL（如 5min）→ 状态位保留，不误清，不发事件/告警，派发仍被正确阻断。
- `drain_started_at` 不可解析 → 无法证明超时，保守不清。

### B2 stale 哨兵自愈（`machine-vitals.js`）
- 采样重新成功 → 自动清除 `machine_vitals_stale_alert` 哨兵键（DELETE working_memory），清除留痕。
- Brain 重启后 in-memory 标志丢失也能清：首次成功采样无条件清一次 DB 哨兵。

### B3 健康检查可见性（`GET /api/brain/alertness`）
- 返回体新增 `blocking_states` 数组，列出当前所有生效阻断位及持续时长（`key`/`since`/`duration_ms`/`duration_human`）。
- 存在活跃阻断位时 `healthy=false`，且不再报 CALM（抬级至少 AWARE）。**返回 healthy/CALM 且无阻断标记即判失败。**

### B4 可观测兜底（`blocking-states.maybeLogDrainSummary`，dispatcher draining 分支调用）
- 排空生效期间每 N 轮（`DRAIN_SUMMARY_EVERY_N`，默认 5）打印一条汇总日志（已排空时长 + 被挡候选数）。

## 验收断言（真跑）

- [BEHAVIOR] TTL 触发：draining + `drain_started_at` 31min 前 → reconcile → 状态位清除 + `auto_recovered` 事件 + 告警。
- [BEHAVIOR] 不误伤：draining + `drain_started_at` 5min 前 → reconcile → 仍 draining，无事件无告警。
- [BEHAVIOR] 哨兵自愈：采样先失败（哨兵建立）再成功 → 哨兵键被删除。
- [BEHAVIOR] 健康红线：draining → `/api/brain/alertness` 的 `blocking_states` 非空含 tick_draining 及时长，`healthy=false`。
- [BEHAVIOR] 汇总日志：排空生效连续 N+1 轮 → 至少一条含「已排空时长 + 被挡候选数」的汇总日志。
- [ARTIFACT] 零回归：dispatcher / machine-vitals / routes-tick 既有单测全绿；drain 与 drain-cancel 语义不变。

## 测试

- `packages/brain/src/__tests__/blocking-states.test.js`（新增，20 例，覆盖 B1–B4 + 验收断言）
- `packages/brain/src/__tests__/machine-vitals.test.js`（新增「重启残留自愈」例）
- `packages/brain/scripts/smoke/blocking-state-selfheal-smoke.sh`（real-env-smoke 真环境断言 B3）

## 边界

只做「阻断类状态位的 TTL 自愈 + 可见性」，不改 drain 触发条件、不改 alertness 分级算法、
不改 harness slot 判定；不动 fleet worker 宿主侧实现（③ 仅记录，不修）。禁止静默自愈。
