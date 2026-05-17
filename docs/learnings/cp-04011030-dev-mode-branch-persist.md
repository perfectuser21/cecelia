# Learning: .dev-mode.{branch} 状态持久化

**分支**: cp-04011030-dev-mode-branch-persist
**日期**: 2026-04-01
**任务**: P3: .dev-mode.{branch} commit 进分支 — 状态层持久化

---

### 根本原因

`.dev-mode.*` 文件被 `.gitignore` 忽略（`.dev-mode.*` 通配规则），导致上下文压缩后
worktree 中的 `.dev-mode.{branch}` 消失。devloop-check.sh 读不到 step 状态，
认为 `step_1_spec: pending`，agent 从头开始执行 Stage 1，造成重复劳动。

状态层（.dev-mode）是 devloop-check.sh 的唯一输入，一旦消失整个 pipeline 失明。

### 修复方案

1. **移除 .gitignore 的 `.dev-mode.*` 通配规则**：保留忽略 `.dev-mode`（无后缀主 symlink），
   允许 `.dev-mode.{branch}` 被 git 追踪。

2. **在关键写入点添加 git commit**：
   - `01-spec.md`（Stage 1 写 .dev-mode 后）：立即 `git add + commit`
   - `02-code.md`（Stage 2 标记 done 后）：立即 `git add + commit`
   - `sprint-contract-loop.sh`（Sprint Contract 收敛后）：在 seal commit 后额外 commit `.dev-mode.{branch}`

### 下次预防

- [ ] 新增"状态文件"时，检查 .gitignore 是否已覆盖，避免误加通配规则
- [ ] 状态层改动后，验证 git status 能看到文件（未被忽略）
- [ ] 会话压缩恢复后，第一步检查 `.dev-mode.{branch}` 是否存在（Step 0 v2.2.0 已处理，但需要文件可恢复）
- [ ] 对"需要跨会话持久化的临时状态文件"，统一使用 git commit 作为持久化方式

### 影响范围

- Engine 版本：13.75.3 → 13.76.0（feat 级别）
- 改动文件：.gitignore, 01-spec.md, 02-code.md, sprint-contract-loop.sh（+版本 bump 5 文件）
- 影响：所有后续 /dev 会话的状态持久化，上下文压缩后不再从头开始
