# Learning: PROBE_FAIL_SELF_DRIVE_HEALTH — consciousness-disabled 误报 + probe loop setInterval bug

**Branch**: cp-05020003-self-drive-health-probe-consciousness-fix
**Date**: 2026-05-02

## 背景

`self_drive_health` 探针持续返回 `ok: false`，告警信息：
`24h: successful_cycles=0 errors=0 tasks_created=0 last_success=never`

前两轮修复（cp-05010001、cp-05020001）已覆盖：
1. setInterval 嵌套在 setTimeout 内的 loop 死亡问题
2. `no_data` 早退路径未写入 `no_action` 事件

但探针仍持续告警。本轮 RCA 发现两个剩余问题。

## 根本原因

### 原因 1：consciousness 禁用时探针误报 → auto-fix 死循环

当 `CONSCIOUSNESS_ENABLED=false`（env override）或 DB 中 `consciousness_enabled.enabled = false`
时，`startSelfDriveLoop()` 在 `server.js` 中被完全跳过：
```js
if (isConsciousnessEnabled()) {
  const { startSelfDriveLoop } = await import('./src/self-drive.js');
  startSelfDriveLoop();  // 仅在 consciousness 启用时才调用
}
```

但 `probeSelfDriveHealth` 不感知 consciousness 状态，继续检查
`cecelia_events` 中的 `self_drive` 事件。因为循环从未启动，事件为零，
探针永远返回 `ok: false` → 触发 auto-fix 任务 → 修复无效（因为 consciousness
仍然禁用）→ 下次探测继续失败 → 死循环。

### 原因 2：`startProbeLoop` 沿用旧 setInterval-in-setTimeout 模式

```js
// 旧代码（有缺陷）
setTimeout(() => {
  runProbeCycle();              // ← 若挂起，永不 resolve
  _probeTimer = setInterval(…); // ← 永远不执行，探针循环死亡
}, 30_000);
```

这与 self-drive 2026-05-01 修复前的旧模式相同。若第一次 `runProbeCycle`
（如 `geo_website` 的 HTTP 请求）挂起超时，`_probeTimer` 永远不设置，
探针只运行一次便永久停止。

## 修复内容

### 1. `capability-probe.js` — probeSelfDriveHealth consciousness 感知

在检查 DB 事件前增加 consciousness 状态判断：

```js
if (!isConsciousnessEnabled()) {
  const status = getConsciousnessStatus();
  const source = status.env_override ? 'env_override' : 'db';
  return {
    ok: true,
    detail: `24h: consciousness_disabled(${source}) — self-drive intentionally inactive`,
  };
}
```

逻辑：
- `ok: true` — 阻止触发 auto-fix 循环
- `detail` 包含 `source` — 区分 env override vs DB 禁用，便于人工判断
- consciousness 已启用时走原有逻辑，行为不变

### 2. `capability-probe.js` — startProbeLoop 修复 setInterval 顺序

```js
// 修复后：setInterval 先建立，setTimeout 后触发
_probeTimer = setInterval(runProbeCycle, PROBE_INTERVAL_MS);
setTimeout(runProbeCycle, 30_000);
```

与 cp-05010001 对 self-drive 的修复保持一致。首次 cycle 挂起不影响后续探测。

### 3. 测试覆盖

`capability-probe-highlevel.test.js` 新增 3 个测试：
- `consciousness=false (env)` → ok: true，不触发 DB 查询
- `consciousness=false (db)` → ok: true，detail 含 `db`
- `startProbeLoop` → setInterval 立即建立，`getProbeStatus().running = true`

## 修复顺序（本次 + 历史）

| 日期 | PR | 问题 | 修复 |
|------|-----|------|------|
| 2026-03-25 | cp-03242250 | 模型配置错误 + no_action 误判 | 修复模型、区分事件类型 |
| 2026-04-28 | cp-04280101 | loop_started 心跳缺失、定时器过晚赋值 | 引入心跳、提前赋值 |
| 2026-05-01 | cp-05010001 | setInterval 在 setTimeout 内（self-drive） | 立即建立 setInterval + safety-net |
| 2026-05-02 | cp-05020001 | no_data 路径未写 no_action | 补写事件 |
| 2026-05-02 | **本次** | consciousness 禁用→ auto-fix 死循环 + probe loop 同 bug | consciousness 感知 + probe loop 修复 |

## 下次预防

- 所有"受 consciousness 守护的模块"探针，必须先检查 `isConsciousnessEnabled()` 再判断健康
- 所有定时循环（`setInterval + setTimeout`）必须先建立 `setInterval`，再用 `setTimeout` 触发首次运行
- `GUARDED_MODULES` 中的模块探针（rumination、self-drive 等）探针应共用一个 consciousness-awareness wrapper
