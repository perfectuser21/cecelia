## v2 P2 PR2 docker-run Middleware 抽出（2026-04-23）

### 根本原因

v2 P2 第 2 PR，核心是把 `executeInDocker` 里 67 行的 Promise 块 + 两个 console.log 分支抽到独立 middleware 文件 `packages/brain/src/spawn/middleware/docker-run.js`，同时把 `readContainerIdFromCidfile` 从 local function 改成 `export function` 供 middleware 引用。纯机械搬家，但 code quality reviewer 第 1 轮挑出 **commit 顺序不可 bisect** 的 BLOCKER — 原顺序里 `feat(新建 docker-run.js)` 在 `refactor(export readContainerIdFromCidfile)` 之前，中间 checkout 到 feat commit 时 `docker-run.js` 因 import 未 export 的名字而 SyntaxError。implementer 用 non-interactive rebase（`GIT_SEQUENCE_EDITOR` 脚本）把 export commit 挪到最前，再逐 commit 验证 import，耗 1 轮补救。

### 下次预防

- [ ] **"新文件依赖已有文件的未导出函数"场景**：下次要 import 一个还没 export 的符号前，**先**做 export commit，再做引用 commit。这类 refactor 的自然 commit 顺序应该是 "准备底座 → 新建依赖者"，不能颠倒
- [ ] **implementer 完工前自检 per-commit import**：写到 plan 里加一步 "遍历 main..HEAD 每个 commit checkout + import smoke"，implementer 自己跑不过再报 DONE。这次 reviewer 挑出来才发现，multiplied review cost
- [ ] **rebase 重写 SHA 后要重新拉 spec/code reviewer**：commit reorder 虽然 diff 不变但 SHA 全变，要通过 code quality reviewer 的第二轮确认每个 intermediate commit 都 import-safe。别偷懒跳过复审
- [ ] **"零行为改动"声明要有证据**：PR description 说"零行为改动"不够，要列出 **diff 只在日志前缀变化**（`[docker-executor]` → `[docker-run]`）并声明无外部消费者依赖。下次写 PR 说明加一个 "行为差 audit" 小节
