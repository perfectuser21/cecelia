# Design: GAN Executor 心跳保活 — 防止 watchdog 重排并发双执行

**日期：** 2026-06-06  
**分支：** cp-0606170001-gan-heartbeat-fix  
**类型：** Bug Fix

---

## 问题

`harness-gan.graph.js` 的 `proposer` / `reviewer` 节点直接 `await executor(...)`，
阻塞 5-9 分钟，期间不刷新 `driver_heartbeat_at`。

`harness-watchdog.js` 的 `staleMinutes=3` 超时后以 `resume_from_checkpoint=true`
重排 initiative，触发第二个并发 graph invoke。
两个 invoke 同时运行同一 GAN step，combined 内存压力触发 host macOS `memorystatus_kill`，
exit=137 被 `docker-run.js` 误标 `OOM_killed`。

---

## 选择方案

**方案 A（选定）：setInterval 包裹 executor，try/finally 清除**

在 `proposer` 和 `reviewer` 的 blocking `await executor(...)` 前后加
`setInterval(heartbeatFn, 60_000)` + `try/finally clearInterval`。
`heartbeatFn` 通过 `ctx → runGanContractGraph opts → runGanLoopNode` 三层传入。

**放弃方案 B**（改 docker-executor.js）：通用组件不应耦合 harness initiative 的 taskId。  
**放弃方案 C**（延长 watchdog 阈值）：治标不治本。

---

## 改动清单

### 1. `packages/brain/src/workflows/harness-gan.graph.js`

**`createGanContractNodes(executor, ctx)`**

- ctx 解构新增 `heartbeatFn = null`
- `proposer` 函数：`await executor(...)` 改为带心跳 interval 的 try/finally 包裹
- `reviewer` 函数：同上

```js
const hbTimer = heartbeatFn
  ? setInterval(() => { heartbeatFn().catch(() => {}); }, 60_000)
  : null;
let result;
try {
  result = await executor({ ... });
} finally {
  if (hbTimer) clearInterval(hbTimer);
}
```

**`runGanContractGraph(opts)`**

- opts 解构新增 `heartbeatFn = null`
- 透传到 `createGanContractNodes(executor, { ..., heartbeatFn })`

### 2. `packages/brain/src/workflows/harness-initiative.graph.js`

**`runGanLoopNode(state, opts)`**

- 在调用 `runGanContractGraph` 前定义心跳回调：
  ```js
  const heartbeatFn = () => writeDriverHeartbeat(dbPool, state.task.id);
  ```
- 传入 `runGanContractGraph({ ..., heartbeatFn })`

---

## 测试策略

**regression test：** `packages/brain/src/__tests__/harness-gan-heartbeat.test.js`

- vitest fake timers（`vi.useFakeTimers()`）
- executor mock：推进 130_000ms 后 resolve
- `vi.advanceTimersByTimeAsync(130_000)` 驱动时间
- 断言 heartbeatFn 调用次数 ≥ 2
- 断言 executor resolved 后再推进 70_000ms，heartbeatFn 不再调用（已 clearInterval）

---

## 不包含

- `docker-run.js` exit=137 误标 OOM 的重命名（独立 issue，本次 scope 只修心跳）
- `harness-watchdog.js` staleMinutes 参数调整

---

## 验收标准

- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] `proposer`/`reviewer` 执行 >3 分钟不再触发 watchdog 重排
- [ ] CI 全绿
