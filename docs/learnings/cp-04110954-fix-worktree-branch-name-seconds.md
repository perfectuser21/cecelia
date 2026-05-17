# Learning: worktree 分支名秒精度修复

**Branch**: cp-04110954-fix-worktree-branch-name-seconds
**Task**: 8f5450bc-82e5-470e-9c9b-1926c4b0d976
**Date**: 2026-04-11

## 现象

同一 task 在同一分钟内重试时，`worktree-manage.sh` 生成完全相同的分支名（`cp-MMDDHHNN-slug`），导致 `fatal: a branch named ... already exists`，cecelia-run 立即失败，任务进入 quarantine 循环。

### 根本原因

`date +%m%d%H%M` 仅到分钟精度。同一分钟内的任何重试都得到相同时间戳，分支名完全相同，`git worktree add` 拒绝创建。

### 修复

将第 145 行改为 `date +%m%d%H%M%S`（加秒），同一分钟内的重试得到不同秒数后缀，分支名唯一。

### 下次预防

- [ ] 分支名生成规则：时间戳必须至少精确到秒
- [ ] 如果未来改用 UUID 后缀，可彻底消除时间冲突问题
- [ ] worktree 创建失败 `already exists` 时，应在错误信息中打印完整分支名帮助排查
