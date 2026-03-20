# Learning: Stop Hook 在 worktree 中找不到 .dev-lock

### 根本原因
stop.sh 用 git rev-parse --show-toplevel 获取 PROJECT_ROOT，但 Claude Code 的 cwd 在主仓库，
而 /dev 在 worktree 中创建 .dev-lock。stop.sh 在主仓库找不到 → exit 0 → 任务提前结束。

### 下次预防
- [ ] 涉及 worktree 隔离的功能，状态文件查找必须同时扫描 worktree 目录
- [ ] Stop Hook 改动必须测试 worktree 场景
