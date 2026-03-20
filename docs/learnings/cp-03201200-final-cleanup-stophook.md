# Learning: stop-dev.sh 也需要扫描 worktree + 垃圾文件累积

### 根本原因
1. stop-dev.sh 和 stop.sh 一样只在主仓库找状态文件，worktree 里的文件看不到
2. 历史 /dev 任务的 .prd-*/.dod-*/.task-* 文件从未被清理，累积到 697 个

### 下次预防
- [ ] 任何读取 .dev-lock/.dev-mode 的代码必须同时检查 worktree 目录
- [ ] cleanup.sh 应该删除当前分支的 .prd-*/.dod-*/.task-* 文件
