---
branch: cp-03171801-fix-smoke-stdio
pr: "#1044"
date: 2026-03-17
---

# Learning: 修复 smoke.test.js stdio WriteStream ubuntu 兼容性

## 根本原因

`server.js` 的 `startCeceliaBridge()` 使用 `createWriteStream('/tmp/cecelia-bridge.log', { flags: 'a' })` 创建日志文件，然后立即将其传给 `spawn` 的 `stdio` 参数。`createWriteStream` 返回的 WriteStream 在文件真正打开前 `fd: null`。

- **macOS**：`spawn` 对 `fd: null` 的 WriteStream 行为容忍，不报错
- **ubuntu（Node.js 严格模式）**：`spawn` 验证 stdio 参数，`fd: null` 触发 `TypeError: The argument 'stdio' is invalid. Received WriteStream { fd: null }`

这导致 server 进程（被 smoke.test.js 用 `spawn` 启动的子进程）内部抛出 TypeError，服务启动失败，smoke.test.js 超时（45s）报 `Server did not start within 45000ms`。

## 修复方案

用 `fs.openSync('/tmp/cecelia-bridge.log', 'a')` 获取整数文件描述符，直接传给 `spawn` 的 `stdio`。整数 fd 是 Node.js 跨平台 stdio 的正确方式，不存在"未打开"问题。

## 下次预防

- [ ] **`spawn` 的 stdio 只用整数 fd 或 `'pipe'`/`'inherit'`/`'ignore'`**：不要用未打开的 Stream 对象（尤其是 WriteStream/ReadStream）作为 stdio，这是 macOS/Linux 行为差异的典型陷阱
- [ ] **ubuntu 迁移后要检查所有用 Stream 作 stdio 的地方**：`createWriteStream` + `spawn stdio` 这个组合在 ubuntu 上需要先 `await` stream 的 `open` 事件，或直接改用 `openSync`
- [ ] **smoke.test.js 在 CI 中总是运行**：`CI=true` 环境变量由 GitHub Actions 自动设置，`canRunSmoke` 判断为 true，不要以为有 skip guard 就不会在 CI 跑
