# Learning: content-pipeline-executors.js execSync 阻塞事件循环

**PR**: fix(brain): content-pipeline-executors.js execSync → async exec

---

### 根本原因

`content-pipeline-executors.js` 中 `run()` 工具函数使用 `execSync`，最长超时 330 秒（`notebooklm research wait`）。虽然 `executeQueuedContentTasks()` 以 fire-and-forget 方式调用，但 `execSync` 是同步阻塞调用，会锁住 Node.js 事件循环（event loop）。

阻塞期间：
- Brain tick 无法继续执行
- HTTP 请求无法响应（健康检查超时）
- 可能触发 PM2 health check → Brain 重启 → content-pipeline 被误判 orphan（已由 PR #1874 修复）

### 修复

将 `run()` 从同步 `execSync` 改为 `async function` + `promisify(exec)`：
- `import { exec } from 'child_process'`
- `const execAsync = promisify(exec)`
- `async function run(cmd, timeout)` → `await execAsync(...)`
- 所有 `run()` 调用加 `await`
- `rsync` 的直接 `execSync` 同步改为 `await execAsync`

### 下次预防

- [ ] Brain 中禁止使用 `execSync` 在 tick/executor 路径（高耗时命令）
- [ ] `facts-check.mjs` 可增加对 Brain src 中 `execSync` 使用的扫描检查
