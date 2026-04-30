# Learning: 修复 PROBE_FAIL_SELF_DRIVE_HEALTH（第三轮）— runSelfDrive 挂起安全超时

**Branch**: cp-0428-feature-ledger
**Date**: 2026-04-29

## 背景

`self_drive_health` 探针第三次触发告警，症状与前两轮相同：
`24h: successful_cycles=0 errors=0 tasks_created=0 last_success=never`

前两轮修复（753bfa0f0 / 4e1b89a24）已解决：
- `loop_started` 心跳 + 探针 6h 宽限期
- `_driveTimer` 立即赋值（guard 有效）
- `try-catch` 包裹 `runSelfDrive()` 调用

## 根本原因

### try-catch 不能捕获挂起（hang）

`try-catch` 只能捕获 **throw**，无法捕获 **挂起（await 永不 resolve）**。

`runSelfDrive()` 内部的 DB 查询（`pool.query()`）没有 per-query 超时。当出现以下情况时，`pool.query()` 可能永久挂起：

- DB 连接处于 TCP 半断状态（网络分区）
- 查询持有锁等待（lock contention）

`pool` 的 `connectionTimeoutMillis=5000` 仅限制**等待连接槽**，不限制**已获取连接上的查询执行时间**。

### 挂起导致 setInterval 永远无法建立

```javascript
// 修复前（问题代码）：
_driveTimer = setTimeout(async () => {
    try {
        await runSelfDrive();  // ← 挂起在此，永不 resolve
    } catch (err) {
        // try-catch 没有任何作用——挂起不会抛异常
        ...
    }
    _driveTimer = setInterval(...);  // ← 永远无法到达
}, 2 * 60 * 1000);
```

结果：
- `_driveTimer` 仍持有旧的 `setTimeout` ID
- `setInterval` 永远不建立
- `loop_started` 事件存在（启动时写入）
- 6h 宽限期过后，探针判定 `ok=false`
- `errors=0`（因为挂起时没有任何事件被写入）

## 修复内容

### `self-drive.js`

新增 `CYCLE_SAFETY_TIMEOUT_MS = 5 * 60 * 1000`（5 分钟）安全超时。

用 `Promise.race` 包裹 `runSelfDrive()`：

```javascript
try {
    await Promise.race([
        runSelfDrive(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('runSelfDrive initial cycle timed out (5min safety net)')), CYCLE_SAFETY_TIMEOUT_MS)
        ),
    ]);
} catch (err) {
    console.error('[SelfDrive] Initial cycle error/timeout (safety net):', err.message);
    // Fire-and-forget：不 await，确保 setInterval 不被 DB 写入阻塞
    recordEvent('cycle_error', { error: `safety_net: ${err.message}` }).catch(() => {});
}
_driveTimer = setInterval(...);  // 始终执行
```

关键设计决策：
- `recordEvent` 不使用 `await`（fire-and-forget），确保即使 DB 也挂起，`setInterval` 仍能建立
- 5min 远高于 LLM 60s 超时 + 正常 DB 查询时间，正常运行时永不触发
- 同样逻辑应用于 scheduled cycle（间隔运行）
- `CYCLE_SAFETY_TIMEOUT_MS` 导出，供测试引用，避免硬编码魔法数字

### 测试（`self-drive-flow.integration.test.js`）

新增 Path 6（2 个用例）：

**用例 1**：初始 cycle 挂起 → safety-net 超时 → setInterval 建立（循环存活）
- 模拟 DB: 启动查询正常，runSelfDrive 内部查询挂起
- 推进假时间：2min（初始延迟）+ 5min（超时）+ 4h（间隔）
- 验证：`running=true` + 4h 后有新 DB 查询（setInterval 真正在跑）

**用例 2**：初始 cycle 挂起超时后，safety-net 记录 cycle_error（probe 可感知）
- 验证 INSERT 中含 `cycle_error` + `safety_net` 前缀
- 确保探针看到 `errors > 0`，而不是静默的 `errors=0`

## 验证

```
vitest run self-drive-flow.integration.test.js capability-probe-highlevel.test.js \
  capability-probe.test.js capability-probe-rumination.test.js
```

结果：**46/46 PASS**

关键证据：
- `初始 cycle 挂起 → safety-net 超时 → setInterval 建立` → **PASS**
- `safety-net 记录 cycle_error（probe 可感知）` → **PASS**
- 所有旧测试无回归

## 根因总结（三轮修复回顾）

| 轮次 | 问题 | 修复 |
|------|------|------|
| 第一轮 | 探针无法区分"刚启动"和"从未运行" | `loop_started` 心跳 + 6h 宽限期 |
| 第二轮 | `_driveTimer` 赋值晚，guard 失效 | 立即赋值 + try-catch |
| 第三轮 | `runSelfDrive()` 挂起绕过 try-catch | `Promise.race` 5min 超时 + fire-and-forget 错误记录 |

## 下次预防

1. **所有关键循环的 async 调用必须有外部超时**，try-catch 不足以防止挂起
2. `errors=0 success=0` 是最难诊断的症状（静默失败），应优先考虑挂起场景
3. DB pool 的 `connectionTimeoutMillis` 只限制连接获取，不限制查询执行 — 不能依赖它防止挂起
