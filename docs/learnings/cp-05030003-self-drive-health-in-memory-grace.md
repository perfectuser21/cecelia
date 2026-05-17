# Learning: PROBE_FAIL_SELF_DRIVE_HEALTH — DB 写入失败时内存 grace 回退

**Branch**: cp-05030003-self-drive-health-in-memory-grace
**Date**: 2026-05-03

## 背景

`self_drive_health` 探针再次返回 `ok: false`：
`24h: successful_cycles=0 errors=0 tasks_created=0 last_success=never`

前五轮修复（cp-03242250、cp-04280101、cp-05010001、cp-05020003、cp-05030001）已覆盖：
1. LLM 模型配置错误 + no_action 误判
2. loop_started 心跳缺失、定时器过晚赋值
3. setInterval 嵌套在 setTimeout 内导致循环死亡
4. consciousness 禁用时探针误报 → auto-fix 死循环
5. 运行时重新启用 consciousness 后 loop 不自动重启

本轮 RCA 发现第六个根因。

## 根本原因

`probeSelfDriveHealth` 的宽限期逻辑依赖 DB 中的 `loop_started` 事件。
如果 `startSelfDriveLoop()` 中 `recordEvent('loop_started')` 因 DB 短暂不可用而失败（静默 catch），
宽限期 `loopStartedHealthy` 永远为 false（`loopStartedAt = null`）。

同时，2min 首次 cycle 的 `recordEvent('no_action')` 若也失败，则 `successCnt=0`。

此时探针看到：
- loop IS 运行中（`getSelfDriveStatus().running = true`）
- DB 中无任何 `self_drive` 事件
- 宽限期不适用 → `ok=false`，触发无限 auto-fix 循环

## 修复内容

### `packages/brain/src/self-drive.js`

- 新增模块级变量 `_loopStartedAt = null`，在 `startSelfDriveLoop()` 中于设置 `_driveTimer` 前记录
- `getSelfDriveStatus()` 新增 `started_at` 字段暴露该值（独立于 DB，内存级别）

### `packages/brain/src/capability-probe.js`

- 保存 `sdStatus`（含 `started_at`）到 `selfDriveStatusForGrace`
- DB 宽限期失效后，新增 in-memory 回退：
  - `successCnt=0 && errorCnt=0 && started_at` 在 6h 内 → `ok:true db_event_missing`
  - 有 `cycle_error` 时不使用 in-memory 宽限（区分 DB 写失败 vs 真实 LLM 失败）

## 测试覆盖

`capability-probe-highlevel.test.js` 新增 3 个测试：
- `ok:true` — loop 运行、DB 事件缺失、started_at 在 30min 内（主修复场景）
- `ok:false` — started_at > 6h（超出宽限期）
- `ok:false` — started_at 在 30min 内但有 cycle_error（真实失败，不宽恕）

全部 18 个测试通过。

## 修复顺序（完整历史）

| 日期 | PR | 问题 | 修复 |
|------|-----|------|------|
| 2026-03-25 | cp-03242250 | 模型配置错误 + no_action 误判 | 修复模型、区分事件类型 |
| 2026-04-28 | cp-04280101 | loop_started 心跳缺失、定时器过晚赋值 | 引入心跳、提前赋值 |
| 2026-05-01 | cp-05010001 | setInterval 嵌套在 setTimeout 内 | 立即建立 setInterval + safety-net |
| 2026-05-02 | cp-05020003 | consciousness 禁用 → auto-fix 死循环 | consciousness 感知 + probe loop 修复 |
| 2026-05-03 | cp-05030001 | 运行时重新启用 consciousness 后 loop 不重启 | probeSelfDriveHealth loop-not-running 自愈 |
| 2026-05-03 | **本次** | DB 写入失败 → loop_started 缺失 → 宽限期失效 | 内存级 _loopStartedAt + in-memory grace 回退 |

## 下次预防

- DB 写入失败时应有内存级别的 fallback，避免探针因基础设施瞬时故障产生误报
- `getSelfDriveStatus()` 中的 `started_at` 可作为所有依赖"loop 启动时间"的探针的可靠来源
- in-memory grace 的 6h 窗口与 DB grace 保持一致，修改默认间隔时两处同步调整
- 区分"DB 写失败（`errorCnt=0`）"和"LLM 真实失败（`errorCnt>0`）"是防止误宽恕的关键守卫
