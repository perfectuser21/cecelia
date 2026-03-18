# Learning: 拆分巨型路由文件的陷阱

## 背景

将 `packages/brain/src/routes.js`（12,613 行）拆分为 10 个独立子路由文件时遇到多个系统性问题。

---

### 根本原因

**1. 动态 import 路径相对位置变了**

原文件在 `src/routes.js`，`await import('./actions.js')` 解析到 `src/actions.js`。
移到 `src/routes/execution.js` 后，`await import('./actions.js')` 解析到 `src/routes/actions.js`（子路由文件），导致 mock 失效。

**2. 漏改 `./` 静态动态 import**

Python 脚本只处理了顶层静态 import，未处理 handler 函数内的动态 `await import('./xxx.js')`。

**3. 拆分脚本的"去重"逻辑误删 header import**

`promisify` 从 `util` 的 import 在原文件第 2825 行附近（body 中），去重逻辑误判为 header 重复，删除了 header 中未存在的 import。

**4. Worktree GC 反复清空**

Brain GC 进程反复删除 worktree 工作文件，导致工作成果丢失。需要在 GC 前 commit。

---

### 下次预防

- [ ] 拆分路由文件后，所有 `await import('./xxx.js')` 必须改为 `await import('../xxx.js')`（如果 xxx.js 在父目录 `src/`）
- [ ] Python 拆分脚本完成后立即运行 `node --check` 语法检查，再 commit
- [ ] 去重 import 逻辑：只删 body 中重复 import，不能删 header 中的 import
- [ ] worktree 工作不能拖延——完成即 commit，防止 GC 清空
- [ ] 用正则批量替换 `await import('\\./'` → `await import('../` 比逐个检查更可靠
