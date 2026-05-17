# Learning: PROBE_FAIL_SELF_DRIVE_HEALTH — 内存级 cycle 计数器（第 7 轮修复）

**Branch**: cp-05040001-self-drive-cycle-counters
**Date**: 2026-05-04

## 背景

`self_drive_health` 探针第 7 次返回 `ok: false`：
`24h: successful_cycles=0 errors=0 tasks_created=0 last_success=never`

前 6 轮修复仍未解决：
1. cp-03242250 — LLM 模型配置错误 + no_action 误判
2. cp-04280101 — loop_started 心跳缺失、定时器过晚赋值
3. cp-05010001 — setInterval 嵌套在 setTimeout 内导致循环死亡
4. cp-05020003 — consciousness 禁用时探针误报 → auto-fix 死循环
5. cp-05030001 — 运行时重新启用 consciousness 后 loop 不重启
6. cp-05030003 — DB 写入失败时缺少内存 grace（基于 `_loopStartedAt`，6h 启动期）

## 根本原因（第 7 个）

cp-05030003 引入的 `_loopStartedAt` 内存 grace 只覆盖**启动后 6h 的引导期**。当 Brain 进程持续运行 >6h、cycle 实际在 setInterval 中执行，但 `recordEvent` 的 `INSERT cecelia_events` 持续静默失败时（DB 短暂故障 / 复制延迟 / Hot-standby 切换），探针看到：

- DB: `success_cnt=0 error_cnt=0`（事件丢失）
- `started_at`：早已超过 6h → 启动 grace 失效

→ 探针走最终 fallthrough → `ok:false` → 触发 auto-fix 死循环。

更糟的是，原 fallthrough 报告 `errors=0`，掩盖了 cycles 实际是否在出错——若 `recordEvent('cycle_error')` 也失败，运维只看到"零事件"的误导信号。

## 修复内容

### `packages/brain/src/self-drive.js`

新增 4 个模块级内存计数器，**在 DB INSERT 之前递增**，确保即使 DB 写入静默失败也能保留真实状态：

```js
let _cycleSuccessCount = 0;
let _cycleErrorCount = 0;
let _lastCycleSuccessAt = null;
let _lastCycleErrorAt = null;
```

`recordEvent(subtype, ...)` 拦截：
- `cycle_complete` / `no_action` → `_cycleSuccessCount++` + 时间戳
- `cycle_error` → `_cycleErrorCount++` + 时间戳
- `loop_started` 仅作为信息事件，不计入 cycle 结果

`getSelfDriveStatus()` 暴露 4 个新字段供探针使用。

### `packages/brain/src/capability-probe.js`

在原 `started_at` 启动 grace **之前**新增 in-memory cycle grace（更强的健康信号——cycle 真的跑过了）：

```js
if (successCnt === 0 && errorCnt === 0 && inMemSuccess > 0 && inMemErrors === 0) {
  return { ok: true, detail: `24h: in_memory_cycles=${N} (db_event_missing) last_success=...` };
}
```

新增 in-memory error 信号兜底（在原 fallthrough 之前）：

```js
if (errorCnt === 0 && inMemErrors > 0) {
  return { ok: false, detail: `24h: in_memory_errors=${N} (db_event_missing) last_error=...` };
}
```

防止真实 cycle 失败被"零事件"假象掩盖。

## 测试覆盖

`capability-probe-highlevel.test.js` 新增 3 个测试：
- `ok:true` — DB 0/0/0 但内存 success_count=3、error_count=0、started_at 超 6h（核心场景）
- `ok:false` — DB 0/0/0 但内存 error_count=2 → 暴露真实失败
- `ok:false` — 内存同时有 success 和 error → 不宽恕

`self-drive.test.js` 新增 1 个测试：
- DB INSERT 拒绝（mockRejectedValueOnce）时 `cycle_success_count` 仍递增 + `last_cycle_success_at` 设置

共 30 个相关测试全绿。DevGate（facts-check + version-sync）通过。

## 修复顺序（完整历史）

| 日期 | PR | 问题 | 修复 |
|------|-----|------|------|
| 2026-03-25 | cp-03242250 | 模型配置错误 + no_action 误判 | 修复模型、区分事件类型 |
| 2026-04-28 | cp-04280101 | loop_started 心跳缺失、定时器过晚赋值 | 引入心跳、提前赋值 |
| 2026-05-01 | cp-05010001 | setInterval 嵌套在 setTimeout 内 | 立即建立 setInterval + safety-net |
| 2026-05-02 | cp-05020003 | consciousness 禁用 → auto-fix 死循环 | consciousness 感知 + probe loop 修复 |
| 2026-05-03 | cp-05030001 | 运行时重新启用 consciousness 后 loop 不重启 | probeSelfDriveHealth loop-not-running 自愈 |
| 2026-05-03 | cp-05030003 | DB 写入失败 → loop_started 缺失 → 启动 grace 失效 | 内存 `_loopStartedAt` + 6h 启动 grace |
| 2026-05-04 | **本次 cp-05040001** | DB 写入持续失败 + 启动期已过 → cycle 状态完全不可见 | 内存 cycle 计数器 + 永久 cycle grace + error 信号兜底 |

## 下次预防

- **任何依赖 DB 事件的健康判定都需要内存级影子状态**——DB 是脆弱的事实源，进程内变量是最近 N 次行为的可靠记录。
- 计数器应在 DB INSERT **之前**递增（顺序敏感）。若先 INSERT 后递增，DB 失败的整段 try/catch 会阻止递增，等于没修。
- 探针失败 detail 应能区分"零事件（DB 丢了）"和"零成功（cycle 真没跑/全失败）"——两者根因不同，运维动作也不同。
- 如果第 8 次还报 `successful_cycles=0`，意味着 setInterval 本身没在跳。下一步应在内存里加 `_lastTickAt`，探针校验 tick 间隔。
