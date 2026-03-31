## Seal 文件 commit 到分支防止上下文压缩丢失（2026-03-31）

### 根本原因

上下文压缩后 Claude Code session 重置，worktree 目录不再是工作目录，
导致 `.dev-gate-*.{branch}` 和 `.sprint-contract-state.{branch}` 文件（存储在
worktree 根目录）无法被下一个 session 找到。

根因是：这些文件虽然不在 `.gitignore` 里，但从未被 `git add` 过，
所以在 worktree 重新创建后（`git worktree add` 后 `git checkout`）无法恢复。

### 下次预防

- [ ] Sprint Contract 相关 seal 文件在收敛成功时立即 `git add`（sprint-contract-loop.sh exit 0 前）
- [ ] 如果发现 seal 文件丢失，先检查 `git log` 确认是否已 commit，再决定是否重新运行 Sprint Contract
- [ ] LITE 路径的 `.dev-gate-lite.{branch}` 文件也需要手动 `git add` 加入 commit
