# Learning: harness worktree not cleaned after merge

### 根本原因
`mergePrNode` 调 `gh pr merge --delete-branch` 只删远程 branch，不删本地 git worktree 目录（实为 git clone）。74 个遗留目录导致 WS3 读到前任务的旧 contract，构建了错误的功能。

### 下次预防
- [ ] 任何新增 worktree/clone 的代码路径（ensureHarnessWorktree）必须配套 cleanup 路径
- [ ] merge 和 fail 两种终态都应触发 cleanup（当前只修了 merge 路径；fail 路径由定期清理兜底）
- [ ] 新 harness WS 代码路径需要代码审查确认 worktree 生命周期完整
