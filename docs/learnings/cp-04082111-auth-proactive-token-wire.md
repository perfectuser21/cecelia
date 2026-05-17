# Learning: proactiveTokenCheck 接入 tick.js

分支: cp-04080611-7fdf70bf-597c-40df-acfd-38d335
日期: 2026-04-08

### 根本原因

PR #2060 在 account-usage.js 中添加了 `proactiveTokenCheck()` 函数，该函数会在 token 过期时立即 `markAuthFailure()` 阻断派发。但 PR 的 diff 只包含 account-usage.js，**没有改动 tick.js** — proactiveTokenCheck 是死代码，从未被调用。

此外，Brain 自 05:42 启动后未重启，导致已合并的 PR #2058/#2060/#2061 中的 auth 修复均未生效。

### 下次预防

- [ ] 任何新增的"主动检查"函数，必须在同一 PR 的 tick.js 中接入调用，PR 描述中明确列出接入点
- [ ] Brain 相关 PR 合并后，检查是否需要重启 Brain（无热重载机制）
- [ ] 搜索"exported but never called"函数（如 `export async function xxx`），确保不有死代码
