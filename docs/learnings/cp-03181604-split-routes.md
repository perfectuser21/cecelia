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

**5. 拆分脚本漏掉主文件 routes.js 本身**

Python 脚本只创建了 `routes/` 子文件，但忘记将 `routes.js` 自身替换为 21 行聚合器。导致 CI 看到的 routes.js 仍然是 12,741 行原文件，DoD 验证失败。

**6. 顶层变量未迁移到子路由文件**

`const pkg = JSON.parse(readFileSync(...))` 定义在原 routes.js 顶层（第 114 行），被 `/hardening/status` 路由使用（第 6515 行）。拆分后路由进 goals.js，但 `pkg` 没有跟着迁移，导致 CI L4 GoldenPath 500 错误。

**7. DoD Test 字段格式：不能有 `- ` 前缀**

DoD 文件的 Test 字段格式必须是（直接在 `- [ ] 条目` 下一行）：
```
  Test: manual: node ...
```
不能是 `  - Test: ...`（加了 `-` 前缀），check-dod-mapping.cjs 用 `/^\s*Test:/` 正则匹配，有 `-` 就匹配不上。

---

### 下次预防

- [ ] 拆分路由文件后，所有 `await import('./xxx.js')` 必须改为 `await import('../xxx.js')`（如果 xxx.js 在父目录 `src/`）
- [ ] Python 拆分脚本完成后立即运行 `node --check` 语法检查，再 commit
- [ ] 去重 import 逻辑：只删 body 中重复 import，不能删 header 中的 import
- [ ] worktree 工作不能拖延——完成即 commit，防止 GC 清空
- [ ] 用正则批量替换 `await import('\\./'` → `await import('../` 比逐个检查更可靠
- [ ] 拆分脚本必须同时替换主文件（routes.js），不能只创建子文件
- [ ] 顶层变量（`pkg`、`const ALLOWED_ACTIONS`等）必须跟着使用它们的路由段一起迁移
- [ ] DoD Test 字段：`  Test: manual: ...`（无 `-` 前缀，直接两空格缩进）
