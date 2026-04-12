### 根本原因

stop.sh 的 worktree 遍历段在扫描 `.dev-lock` 前未验证 worktree 目录是否仍存在。当 worktree 被物理删除但 `git worktree list --porcelain` 记录残留时，glob 扩展 `$_wt_path/.dev-lock.*` 在不存在的目录上无报错但逻辑混乱，可能导致 stop hook 行为异常。修复：在 `.dev-lock` 检测前加 `[[ -d "$_wt_path" ]] || continue`。

stop-dev.sh 的 `_collect_search_dirs()` 函数（第 15、19 行）已有 `-d` 检查，无需修改。

### 下次预防

- [ ] 遍历 `git worktree list` 输出时，凡是要访问 worktree 路径下的文件，必须先做 `-d` 目录存在性检查
- [ ] stop.sh 与 stop-dev.sh 的 worktree 遍历逻辑共享同一安全模式：先 `-d`，再访问文件
