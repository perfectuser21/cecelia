# Learning — 阻断类状态位 TTL 自愈 + 健康检查可见性

- task_id: `d33c81ab-a4c5-4a9c-99e6-65d71850860a`
- date: 2026-08-10
- gear: hotfix · P0

## 现象（比崩溃难发现）

会阻断派发的状态位没有 TTL、没有自愈、没有告警，系统可以长时间「健康地」停摆而无人察觉。
2026-08-10 当天同类问题三次：`tick_draining` 卡 2h20m（5 条 P0 零派发，`/api/brain/alertness`
同期报 `CALM / "System is healthy"`），`machine_vitals_stale_alert` 卡 2 天。共性——进程活着、
健康检查绿、日志无异常，系统安静停在一个错误状态里。

## 根因

1. **无 TTL**：`tick_draining` 一旦置位（如一次 Brain 下线），此后无人续期也无人取消，
   `dispatcher.js` 每轮直接 `return {reason:'draining'}`，连候选都不评估，日志里什么都没有。
2. **哨兵自愈依赖内存标志**：`machine-vitals.js` 的「恢复即清哨兵」被 `wasAlerted && pool` 门控，
   而 `wasAlerted` 是 in-memory `_staleAlerted`；Brain 重启后它丢失（=false），DB 残留哨兵永不清除。
3. **健康检查看不见阻断位**：alertness 端点只反映分级算法，不感知「阻断类状态位」这一维度。

## 修法

- `blocking-states.js`（新）：`reconcileBlockingStates()` 在派发闸之前做 TTL 自愈——排空超 TTL
  （默认 30min，`DRAIN_TTL_MS` 可覆盖）且无人续期则自动 `cancelDrain()` + 记 `auto_recovered`
  事件 + 发告警（说明曾卡多久）；`getBlockingStates()` 列出生效阻断位及持续时长；
  `maybeLogDrainSummary()` 排空期每 N 轮打印汇总（已排空多久 + 挡住多少候选）。
- `machine-vitals.js`：首次成功采样无条件清一次 DB 哨兵，与 in-memory 标志解耦 → 重启残留自愈。
- `routes/tick.js`：`/api/brain/alertness` 新增 `blocking_states` 数组 + `healthy` 字段，存在活跃
  阻断位时 `healthy=false` 且抬级不再报 CALM。

## 可复用原则

**任何会阻断关键流程的状态位都必须三件套：TTL 自愈 + 留痕告警 + 健康检查可见。**
禁止静默自愈——静默会把「为什么卡过」的信息一起吃掉。自愈的触发条件不能只挂在 in-memory
标志上（进程重启即丢），持久化状态的清理必须能独立于内存标志兜底一次。
