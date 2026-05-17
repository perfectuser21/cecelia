# Learning: PROBE_FAIL_SELF_DRIVE_HEALTH — 运行时重新启用 consciousness 后 loop 不自动重启

**Branch**: cp-05030001
**Date**: 2026-05-03

## 背景

`self_drive_health` 探针持续返回 `ok: false`：
`24h: successful_cycles=0 errors=0 tasks_created=0 last_success=never`

前三轮修复（cp-03242250、cp-05010001、cp-05020003）已覆盖：
1. LLM 模型配置错误 + no_action 误判
2. setInterval 嵌套在 setTimeout 内导致循环死亡
3. consciousness 禁用时探针误报 → auto-fix 死循环

但探针在特定场景下仍持续告警。本轮 RCA 发现第四个根因。

## 根本原因

### 运行时 consciousness 重新启用后 self-drive loop 不重启

`server.js` 只在启动时调用 `startSelfDriveLoop()`，且有条件检查：

```js
if (isConsciousnessEnabled()) {
  const { startSelfDriveLoop } = await import('./src/self-drive.js');
  startSelfDriveLoop();  // 只在启动时调用一次
}
```

当 Brain 以 `CONSCIOUSNESS_ENABLED=false` 启动（或 DB 中 consciousness 被禁用）时，
`startSelfDriveLoop` 被跳过，`_driveTimer` 永远为 null。

随后，当 consciousness 被**运行时重新启用**时（如：
- rumination 探针 loop_dead 自愈路径：`setConsciousnessEnabled(pool, true)`
- 管理员通过 API 手动开启：`PATCH /api/brain/settings/consciousness`

），`_cached.enabled` 变为 true，`isConsciousnessEnabled()` 返回 true。但 **`startSelfDriveLoop` 不会被自动调用**，self-drive loop 永远不会启动。

`probeSelfDriveHealth` 的 consciousness 守护此时不短路（`isConsciousnessEnabled()` = true），
直接查 DB 事件，发现 0 条，返回 `ok: false`，触发 auto-fix → 修复无效 → 死循环。

## 修复内容

### `capability-probe.js` — probeSelfDriveHealth 添加 loop-not-running 自愈

在 consciousness 守护之后、DB 查询之前，检查 self-drive loop 是否真在运行：

```js
try {
  const { getSelfDriveStatus, startSelfDriveLoop } = await import('./self-drive.js');
  if (!getSelfDriveStatus().running) {
    await startSelfDriveLoop();
    console.log('[Probe] self_drive_health self-heal: loop was not running — restarted');
    return {
      ok: true,
      detail: '24h: self_heal=loop_restarted — consciousness enabled but loop was not running',
    };
  }
} catch (healErr) {
  console.warn('[Probe] self_drive_health self-heal failed (non-blocking):', healErr.message);
}
```

逻辑：
- `getSelfDriveStatus().running` = `_driveTimer !== null` → 判断 loop 是否已启动
- 未启动 → 调用 `startSelfDriveLoop()` 重启（镜像 rumination 探针的 self-heal 模式）
- 重启成功 → 立即返回 `ok: true`，跳过 DB 查询（loop 刚启动，事件不可能存在）
- 重启失败 → 吞掉异常，继续走 DB 查询 → 返回真实状态

### 测试覆盖

`capability-probe-highlevel.test.js` 新增 3 个测试：
- `consciousness enabled + loop not running` → 自愈重启，ok: true，startSelfDriveLoop 被调用
- `consciousness enabled + loop not running + heal fails` → 自愈失败，走 DB 查询，ok: false
- `loop already running` → 不触发自愈，startSelfDriveLoop 不被调用

## 修复顺序（完整历史）

| 日期 | PR | 问题 | 修复 |
|------|-----|------|------|
| 2026-03-25 | cp-03242250 | 模型配置错误 + no_action 误判 | 修复模型、区分事件类型 |
| 2026-04-28 | cp-04280101 | loop_started 心跳缺失、定时器过晚赋值 | 引入心跳、提前赋值 |
| 2026-05-01 | cp-05010001 | setInterval 在 setTimeout 内（self-drive） | 立即建立 setInterval + safety-net |
| 2026-05-02 | cp-05020001 | no_data 路径未写 no_action | 补写事件 |
| 2026-05-02 | cp-05020003 | consciousness 禁用→ auto-fix 死循环 + probe loop 同 bug | consciousness 感知 + probe loop 修复 |
| 2026-05-03 | **本次** | 运行时重新启用 consciousness 后 loop 不重启 | probeSelfDriveHealth loop-not-running 自愈 |

## 下次预防

- 所有受 consciousness 守护的长时间循环（self-drive、rumination、narrative 等），都需要在
  consciousness 运行时重新启用时能够自动重启，不能只依赖 server.js 启动时的一次性调用
- consciousness 切换 API（`setConsciousnessEnabled`）应考虑统一重启所有守护模块的 loop
- 探针的 self-heal 模式（probe 发现异常 → 直接修复）是可靠的防御层，应推广到其他模块探针
- `getSelfDriveStatus().running` 是 loop 是否在运行的可靠判断（基于 `_driveTimer !== null`）
