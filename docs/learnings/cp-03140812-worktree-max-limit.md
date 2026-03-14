### [2026-03-14] worktree-manage.sh 新增 MAX_WORKTREES=8 数量上限检查

**失败统计**：CI 失败 1 次，本地测试失败 0 次

## 根本原因

**CI 失败 #1**：Learning Format Gate 失败
- 根本原因：未在 push 前写好 Learning 文件（`docs/learnings/<branch>.md`）
- 修复方式：补写 Learning 文件并 push 到功能分支
- 下次如何预防：**Learning 必须和代码在同一个 commit 或在 PR 创建前 push**，不能在 CI 失败后补写

## 错误判断记录

- 以为可以"先 push 代码，再写 Learning"——实际上 L1 Learning Format Gate 在第一次 CI 运行时就检查，必须在 push 前包含

## 主要变更

在 `worktree-manage.sh` 的 `cmd_create()` 函数中，flock 获取锁之后加入数量检查：
- `MAX_WORKTREES=8` 常量
- `git worktree list | tail -n +2` 计算现有非主仓库 worktree 数量
- 数量 >= 8 时 exit 1 并提示运行 `worktree-gc.sh`

**影响程度**: Low（功能本身简单，只有一次 CI 失败且原因明确）

**预防措施**：
- Learning 文件必须在第一次 `git push` 之前写好并加入 commit
- 今后遵循：写代码 → 写 Learning → commit → push → 创建 PR
