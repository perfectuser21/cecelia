# Learning: 修复 PROBE_FAIL_SELF_DRIVE_HEALTH — loop_started 心跳 + safety-net 超时

**Branch**: cp-05010001-fix-self-drive-health-probe
**Date**: 2026-05-01

## 背景

`self_drive_health` 探针持续返回 `ok: false`：
`24h: successful_cycles=0 errors=0 tasks_created=0 last_success=never`

调查发现三个历史修复提交（`753bfa0f0`、`4e1b89a24`、`8e20b8153`）均停留在
`cp-04300001-self-drive-health-probe-fix` 分支，**从未合并到 main**。

## 根本原因

### 原因 1：setInterval 嵌套在 setTimeout 内，首次 cycle 挂起导致循环死亡

`startSelfDriveLoop()` 原实现：
```js
setTimeout(async () => {
  await runSelfDrive();          // ← 若此处挂起，永不 resolve
  _driveTimer = setInterval(…); // ← 永远不执行，循环死亡
}, 2 * 60 * 1000);
```

首次 DB 查询（如 `getLatestProbeResults`）若因连接池问题挂起，`setInterval` 永远不建立，
24h 内零 `self_drive` 事件，探针报 `ok: false`。

### 原因 2：探针无法区分"刚重启"和"循环挂死"

原探针只检查 `cycle_complete / no_action` 事件，Brain 正常重启后 2 分钟初始延迟内
两种情况都返回 `ok: false`：真正故障 vs 等待首次 cycle。

### 原因 3：修复分支从未合并

`753bfa0f0` 等三个提交的修复方案正确，但停留在孤立分支，main 始终保留有问题的旧代码。

## 修复内容

### 1. `self-drive.js`

- 导出 `CYCLE_SAFETY_TIMEOUT_MS = 5 * 60 * 1000`
- 新增 `runCycleWithSafetyNet()`：`Promise.race` 包裹 `runSelfDrive()`，超时后写
  `cycle_error`（error 含 `safety_net` 前缀），保证循环不被单次 cycle 阻塞
- `startSelfDriveLoop()` 立即建立 `setInterval`（不再等首次 cycle 完成）；
  启动时写 `loop_started` 心跳事件

### 2. `capability-probe.js`

- SQL 新增 `last_loop_started` 聚合字段
- 宽限期逻辑：`loop_started` 在 6h 内且 `error_cnt === 0` → `ok: true`（正常启动等待状态）；
  超过 6h 无 cycle 或有错误 → `ok: false`（真正故障）

### 3. 测试

- `capability-probe-highlevel.test.js` 新增 3 个用例（宽限期通过/有错误/超时）
- 新建 `self-drive-flow.integration.test.js`：Path 6a/6b/6c 覆盖挂起场景

## 下次预防

- 修复提交必须通过 PR 流程合并到 main，不能留在孤立分支
- 凡是"等待首次运行"的周期循环，启动时应写入心跳事件
- 循环内任何长时操作必须有超时保护（Promise.race）
- 6h 宽限期基于 4h 默认间隔，若间隔改变须同步调整宽限期
