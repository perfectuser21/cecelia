# Learning: Brain execSync 在 swap 压力下阻塞事件循环

**分支**: cp-04040322-88c13be1-8869-478e-b4b0-939dd0  
**日期**: 2026-04-04

---

### 根本原因

`executor.js` 的 `checkServerResources()` 每次调用包含 3 个 `execSync`：

| 命令 | 超时 |
|------|------|
| `sysctl vm.memory_pressure` | 2s |
| `vm_stat` | 2s |
| `sysctl vm.swapusage` | 3s |

合计最多 **7 秒**同步阻塞 Node.js 事件循环。该函数每次 tick 被调用 4+ 次，可产生 28+ 秒连续阻塞。

**触发条件**：系统 Swap 使用率 ≥ 88%（本次：5396M / 6144M = 88%）时，macOS 内核 sysctl 调用从 < 1ms 变为数秒。这是因为进程在 swap thrash 状态下，内核需要将数据换出/换入才能响应系统调用。

**结果**：Brain HTTP 服务器无法处理新请求（`curl --max-time 3` exit=28），tick 停止派发，10 个排队内容任务卡死。

### 历史背景

- 之前已修复 `/trigger-cecelia` fetch 无超时问题（PR #1869），但该修复针对的是异步 fetch，不影响此处的同步 execSync
- `execSync` 在 await 的异步上下文中仍然完全阻塞事件循环（Node.js 单线程特性）

### 修复方案

将三个 `execSync` 改为后台 15 秒异步轮询（`exec()` callback），Brain 主路径只读缓存值：

```javascript
// 新增 _resourceCache + _pollResourceAsync() + _startResourcePolling()
// getMacOSMemoryPressure() → _resourceCache.memPressureSignal
// getAvailableMemoryMB() → _resourceCache.availableMemMB
// checkServerResources() → _resourceCache.swapUsedPct (Darwin)
// server.js 启动时调用 _startResourcePolling()
```

同时补全 executor.js skillMap 缺失的 `content-copywriting` 和 `content-copy-review` 条目（这两个 task type 已在 task-router.js 正确定义，但 executor.js 的 skillMap 遗漏了，导致错误路由到 `/dev`）。

### 下次预防

- [ ] **凡 `execSync` 出现在 Brain hot path（tick / HTTP handler）中，必须转为 async + cache 模式**
- [ ] 新增资源检查函数时，用 `async exec()` + `setInterval` 替代 `execSync`
- [ ] task-router.js 和 executor.js skillMap 必须保持同步（CI 检查: 新增 task type 时两处都要改）
- [ ] Swap 使用率 > 70% 时，Brain 应当主动告警并降低派发速率（已有 SWAP_USED_MAX_PCT=90 但未触发告警）
