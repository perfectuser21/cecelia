# Learning: initTickLoop 启动时调用 syncOrphanTasksOnStartup

## 任务背景
修复 Brain 重启后 in_progress 孤儿任务静默丢失问题。`syncOrphanTasksOnStartup()` 已实现并 import，但 `initTickLoop()` 从未调用它。

### 根本原因
代码实现与调用点脱节：`executor.js` 实现了 `syncOrphanTasksOnStartup`，`tick.js` 也已 import，但没有在启动时机（`initTickLoop`）触发调用。结果每次 Brain 重启，所有 in_progress 任务永久卡死。

### 修复方式
在 `tick.js` `initTickLoop()` 的 `ensureEventsTable()` 之后、`enableTick()`/`startTickLoop()` 之前插入 try/catch 调用，non-fatal（失败不影响 tick 启动）。

### 下次预防
- [ ] 新增 executor 功能函数时，同步检查 tick.js 的启动路径是否需要对应调用点
- [ ] startup-sync 类函数要有对应的 initTickLoop 级别调用，不能只 import 不用

## vi.mock 与 readFileSync 的陷阱
测试文件用 `vi.mock('fs', ...)` 拦截了 `readFileSync`，导致用 `import('node:fs').readFileSync` 读取源码时拿到 mock 内容（`'SwapTotal: 0\nSwapFree: 0'`）。

**解决**：在需要读取真实文件的测试中，用 `vi.importActual('node:fs')` 获取未 mock 的 `readFileSync`：
```js
const { readFileSync } = await vi.importActual('node:fs');
const src = readFileSync(new URL('../tick.js', import.meta.url), 'utf-8');
```

- [ ] 源码验证类测试（读取 `.js` 文件内容检查结构）必须用 `vi.importActual` 绕开文件系统 mock
