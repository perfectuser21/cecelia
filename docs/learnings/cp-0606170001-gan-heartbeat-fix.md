# Learning: GAN executor 心跳断档 → watchdog 重排并发双执行

**分支：** cp-0606170001-gan-heartbeat-fix  
**日期：** 2026-06-06  

### 根本原因

`harness-gan.graph.js` 的 `proposer`/`reviewer` 函数直接 `await executor()` 阻塞
5-9 分钟，期间不刷新 `driver_heartbeat_at`。`harness-watchdog.js` 的 `staleMinutes=3`
超时后以 `resume_from_checkpoint=true` 重排 initiative，第二个并发 graph invoke
从 GAN checkpoint 恢复、再次进入同一 proposer/reviewer 节点，双容器 combined 内存压力
触发 macOS host `memorystatus_kill`，exit=137 被 `docker-run.js` 误标 `OOM_killed`。

实证：任务 `035eaabb` 每个 GAN step 跑了两次（bd0393a6+312cc2c6, 6b828ff1+8c608162 ...）。
exit=137 ≠ Docker OOM：`docker inspect` 确认 `OOMKilled: false`，容器实测只用 193MB/2GB（9.46%）。

### 修法

`createGanContractNodes(executor, ctx)` 接受可选 `heartbeatFn`，
proposer/reviewer 的 blocking `await executor()` 外包裹
`setInterval(heartbeatFn, 60_000)` + `try/finally clearInterval`。
`runGanLoopNode` 注入 `() => writeDriverHeartbeat(dbPool, state.task.id).catch(() => {})`。

### 下次预防

- [ ] 所有 blocking `await executor()` 调用（Generator/Evaluator 等新节点）均应包裹心跳 interval
- [ ] `docker-run.js` 的 exit=137 标签应区分 Docker cgroup OOM（`OOMKilled: true`）和 host kill（`OOMKilled: false`），避免误导排障
- [ ] watchdog `staleMinutes` 应大于最长预期 GAN step 运行时间（当前 3min < proposer 5-9min）
- [ ] vitest fake timers + async 函数内部有多层 await 时，需等 executor 被调用（setInterval 注册完毕）再推进 fake time，否则 interval 从未触发
