# Learning: monitor_loop probe 自愈修复

**任务**: Auto-Fix PROBE_FAIL_MONITOR_LOOP  
**日期**: 2026-04-05  
**PR**: fix(brain): monitor_loop probe 自愈 + server 启动步骤隔离

### 根本原因

`server.listen(PORT, async () => {...})` 的回调是 async 函数但没有顶层 try-catch。如果 `await initNarrativeTimer(pool)` 或 `await runStartupRecovery()` 在 Brain 启动时抛出异常，该异常变为未捕获的 Promise rejection，Node.js 只打 warn 日志但服务继续运行。后续的 `startMonitorLoop()` 永远不会执行，`_monitorTimer` 保持 `null`，导致 `getMonitorStatus().running === false`，probe 持续报警。

### 下次预防

- [ ] async 启动回调必须每个关键步骤独立包 try-catch，任一失败不阻断后续初始化
- [ ] 监控相关系统（monitor_loop、probe_loop、scan_loop）必须自愈：probe 检测到 not running 时自动重启
- [ ] `selfcheck.js EXPECTED_SCHEMA_VERSION` 必须在 migration 合并时同步更新，否则 facts-check 失败

### 证据

- `server.js` startup async callback 无顶层 try-catch → `startMonitorLoop()` 未执行
- `getMonitorStatus()` 返回 `running=false` 来自 `_monitorTimer === null`
- 修复后：`probeMonitorLoop` 检测到 `running=false` 时调用 `startMonitorLoop()` 自愈，测试 7/7 通过
