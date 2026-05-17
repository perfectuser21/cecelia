# Learning: fix backfill-decisions.js homedir import

**分支**: cp-03250954-fix-backfill-homedir
**日期**: 2026-03-25

---

### 根本原因

`backfill-decisions.js` 错误地从 `'path'` 模块导入 `homedir`：

```js
import { join, homedir } from 'path';  // ❌ homedir 不在 path 模块
```

`homedir` 是 Node.js `'os'` 模块的 API，`'path'` 模块不导出该函数。
运行时报 `TypeError: homedir is not a function`，脚本无法执行。

同一个 PR（#1536）里 `memory-sync.js` 也犯了相同的错误，已在补丁 commit 中修复。
但 `backfill-decisions.js` 的修复遗漏，遗留在 main 分支。

---

### 下次预防

- [ ] 新文件用到 `homedir` 时，立即确认 import 来源是 `'os'` 而非 `'path'`
- [ ] 同 PR 内多个文件有相同模式时，全部文件一起检查，不要只修一处
- [ ] Code Review 清单加：`homedir` 只来自 `'os'`
