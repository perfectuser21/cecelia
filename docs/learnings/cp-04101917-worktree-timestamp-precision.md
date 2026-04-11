# Learning: worktree 分支名 timestamp 秒精度

## 背景

`worktree-manage.sh` 使用 `date +%m%d%H%M` 生成分支名 `cp-MMDDHHNN-slug`（分钟精度）。当同一任务在同一分钟内重试（Brain 调度 + cecelia-run 失败重启），会生成完全相同的分支名，导致：

```
fatal: a branch named 'cp-04101923-xxx' already exists
```

任务进入 quarantine 循环，无法自愈。

### 根本原因

分支名唯一性依赖时间精度，但 Brain 重试间隔可以小于 1 分钟，导致 timestamp 碰撞。

### 下次预防

- [ ] 生成任何用于 git 操作的唯一标识符时，使用秒级精度（`%S`）而非分钟级
- [ ] 若需要更强保证，可额外追加 `$$`（PID）或随机数后缀
- [ ] 类似 ID 生成逻辑（如任务 ID 前缀）也应检查是否有碰撞风险
