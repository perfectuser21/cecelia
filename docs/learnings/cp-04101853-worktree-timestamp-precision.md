# Learning: worktree 分支命名秒精度修复

## 根本原因

`worktree-manage.sh` 中 timestamp 使用 `date +%m%d%H%M`（分钟精度），导致同一任务在同一分钟内重试时生成完全相同的分支名 `cp-MMDDHHNN-slug`。Git 报错 `fatal: a branch named ... already exists`，cecelia-run 立即失败，任务进入 quarantine 循环。

## 修复方案

将 timestamp 精度改为秒级：
```bash
# 改前
timestamp=$(date +%m%d%H%M)
# 改后
timestamp=$(date +%m%d%H%M%S)
```

## 下次预防

- [ ] 任何生成唯一 ID 的地方，默认使用秒精度而非分钟精度
- [ ] 如果分支命名冲突出现在 quarantine 日志，首先检查 timestamp 精度
- [ ] worktree 创建逻辑改动后，用 `bash worktree-manage.sh create test-task` 快速验证分支名格式
