# Learning: MAX_SEATS 重启状态日志 + /capacity 端点

**分支**: cp-03171714-b24c6450-2f5e-444e-9eb3-71fa7c
**日期**: 2026-03-17

---

## 根本原因

1. **git stash 在 worktree 中使用导致文件消失**
   在 `.claude/worktrees/` 下的 worktree 运行 `git stash` 后，staged 文件被弹出到 stash，但 worktree 的 `.git` 文件（指向主仓库）也被损坏，导致整个 worktree 目录只剩 `node_modules`，源文件全部消失。

2. **DoD BEHAVIOR 类型不接受 grep 测试**
   `check-dod-mapping.cjs` 对 `[BEHAVIOR]` 类型的 DoD 条目要求 `manual:curl` 或真实测试文件，拒绝 `bash -c "grep..."` 作为"弱测试"。

3. **hook v25 packages/ 子目录需要 `.prd-{branch}.md`**
   当编辑 `packages/` 下的文件时，hook 会检查 worktree 根目录是否存在 `.prd-{branch}.md`（不是 `.task-{branch}.md`）。

---

## 下次预防

- [ ] **永远不要在 worktree 目录内运行 `git stash`**，用 `git checkout -- .` 或 `git restore` 替代临时撤销
- [ ] DoD 条目中，`[BEHAVIOR]` 类型必须用 `manual:curl ...` 格式，不能用 `bash -c "grep..."`
- [ ] 编辑 `packages/` 下文件的分支，在 TaskCard 创建之后立即确认 `.prd-{branch}.md` 存在
- [ ] vitest 全套测试中偶现 "Worker exited unexpectedly"（tinypool OOM）是已知 flaky 问题，不影响 PR 合并

---

## 技术要点

- `executor.js` 导出 `MAX_SEATS`、`INTERACTIVE_RESERVE`、`getBudgetCap()`，可在 server.js 启动回调中 dynamic import 使用
- `syncOrphanTasksOnStartup()` 返回 `{ orphans_found, orphans_fixed, requeued, rebuilt }`，`failed = orphans_fixed - requeued - rebuilt`
- vitest mock executor.js 必须用 `importOriginal()` 展开所有原始导出，避免 slot-allocator.js 等依赖 `MAX_SEATS` 的内部模块报错
