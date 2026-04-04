# Learning: content-pipeline-executors.js execSync 阻塞事件循环

**分支**: cp-04041920-fix-content-pipeline-execsync  
**日期**: 2026-04-04

---

### 根本原因

`content-pipeline-executors.js` 的 `run()` 函数使用 `execSync` 调用 notebooklm CLI：

| 调用 | 超时 |
|------|------|
| `notebooklm use <id>` | 60s（默认）|
| `notebooklm source add-research` | 30s |
| `notebooklm research wait --timeout 300` | **330s** |
| `notebooklm ask --json` | 120s |

`executeResearch()` 虽然是 `async function`，但内部调用了同步的 `execSync`。
`tick.js` 通过 fire-and-forget `.then()` 调用 `executeQueuedContentTasks()`，
但 `execSync` 始终阻塞 Node.js 主线程，fire-and-forget 无法解决这个问题。

最坏情况：4 个阶段合计阻塞 **8.5 分钟**，Brain HTTP 完全不响应。

`executeExport()` 中的 rsync（60s 超时）同样存在此问题。

### 修复方案

1. 将 `import { execSync }` 改为 `import { exec }` + `import { promisify }`
2. `const execAsync = promisify(exec)` — 异步版
3. `run()` 改为 `async function run()`，内部 `await execAsync(cmd, { encoding: 'utf-8', timeout })`
4. `executeResearch()` 中所有 `run(...)` 加 `await`
5. `executeExport()` 中 rsync 改为 `await execAsync(...)`

### 下次预防

- [ ] 所有调用外部 CLI 的函数必须用 `exec`（async）而非 `execSync`，即使外层是 `async function`
- [ ] Brain 代码审查时，grep `execSync` 并评估每处超时时间；>5s 的必须改 async
- [ ] `async function` 内调用 `execSync` 是常见误区——async 函数不会自动将同步调用变异步
