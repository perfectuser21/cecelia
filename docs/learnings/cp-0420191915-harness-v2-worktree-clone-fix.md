# Harness v2 Worktree 用独立 clone 替代 linked worktree

### 根本原因

PR-1 `ensureHarnessWorktree` 用 `git worktree add -b <branch>` 创 linked worktree。linked worktree 的 `.git` 是一个文件，内容形如 `gitdir: /abs/主仓库/.git/worktrees/<name>`。容器只挂 worktree 目录到 `/workspace`，主仓库 `.git` 没挂，指针解析失败，agent 所有 git 命令报 `fatal: not a git repository`。真机 E2E Initiative `421c8aaa` 就卡在这，Planner docker exit=128 duration=8.8s。

### 下次预防

- [ ] 容器化任务的目录挂载必须是 self-contained（独立 git repo / 独立环境），不依赖宿主机的任何软连接或指针
- [ ] 新增 helper 时，必须跑一遍"容器化真机验证"而不是只跑单测（单测 mock 了 `execFn` 没暴露这个 bug）
- [ ] `git clone --local --no-hardlinks` 是正确选择：速度接近 hardlink，但 objects 是独立拷贝，容器里能完整工作
- [ ] cleanup 要和创建方式对称：`git worktree remove` 对应 linked worktree，`fs.rm -rf` 对应独立 clone
