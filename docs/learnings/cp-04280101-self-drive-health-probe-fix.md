# Learning: 修复 PROBE_FAIL_SELF_DRIVE_HEALTH — loop_started 心跳机制

**Branch**: main (直接提交，无 PR)
**Date**: 2026-04-28
**Commit**: 753bfa0f0

## 背景

`self_drive_health` 探针持续返回 `ok: false`，告警信息：
`24h: successful_cycles=0 errors=0 tasks_created=0 last_success=never`

## 根本原因

### 原因 1：`_driveTimer` 赋值时机晚于 guard 检查

`startSelfDriveLoop()` 中，`_driveTimer` 只在 `setTimeout` 回调内（首次 `runSelfDrive()` 完成后）才赋值为 `setInterval` ID。在 2 分钟初始延迟窗口内，`_driveTimer === null`，guard `if (_driveTimer) return` 失效，可被重复调用（双启动风险）。

### 原因 2：Brain 重启使计时器归零

Brain 频繁重启（由 graceful shutdown 问题触发）导致 self_drive 的 2 分钟初始延迟 + 4-12h 间隔不断重置。24h 探针窗口内可能出现：Brain 重启多次，每次都处于"等待首次 cycle"的 2 分钟内，最终零事件。

### 原因 3：探针无法区分"循环刚启动"和"循环从未运行"

原探针只检查 `cycle_complete/no_action` 事件，两种情况都返回 `ok: false`：
- 真正的故障（consciousness 被禁用，循环从未启动）
- 正常的 Brain 重启后 2 分钟宽限期

## 修复内容

### 1. `self-drive.js`

- `startSelfDriveLoop()` 启动时立即写入 `loop_started` 事件到 `cecelia_events`
- 将 `_driveTimer = setTimeout(...)` 提前赋值（不再等 setInterval），消除 guard 失效窗口

### 2. `capability-probe.js`

- SQL 新增 `max(case when payload->>'subtype' = 'loop_started' then created_at end) AS last_loop_started`
- 判断逻辑：
  - `success_cnt > 0` → ok: true（正常状态）
  - `loop_started` 在 6h 内 + `error_cnt === 0` → ok: true（宽限期，等待首次 cycle）
  - `loop_started` 超过 6h 无 cycle，或有错误 → ok: false（真正故障）

### 3. 新增 3 个测试用例

- loop_started 30 分钟前，无 cycle → ok: true（宽限期通过）
- loop_started 10 分钟前，有 errors → ok: false（LLM 失败不宽恕）
- loop_started 7 小时前，无 cycle → ok: false（超过宽限期）

## 下次预防

- [ ] 凡是"等待首次运行"的周期性循环，都应在启动时写入心跳事件，供探针感知
- [ ] Brain 重启频率本身需监控：如果 24h 内 loop_started 超过 N 次，说明 Brain 不稳定
- [ ] 6h 宽限期是基于 4h 默认间隔 + buffer，如果间隔改为 12h，宽限期应同步调大
