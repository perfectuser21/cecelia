# Learning: Janitor Brain 回报闭环

## 分支
`cp-03231043-janitor-brain-feedback`

## 变更摘要
Janitor v4.1：kill claude 孤儿进程后，通过 `.dev-lock.*` 文件找到对应分支，PATCH Brain 任务状态为 failed，触发重调度。

### 根本原因
Janitor v4.0 kill 后无回报：被 kill 的进程对应的 Brain 任务永远挂在 `in_progress`，形成调度死锁，Cecelia 无法重试。

### 设计决策
- **lsof 取 CWD 在 kill 之前**：kill 后进程消失，lsof 无效
- **fire-and-forget**：Brain 回报失败只 log，不影响 kill 主流程
- **双路径**：有 task_id → PATCH 直接更新；无 task_id → POST 告警任务

### 下次预防
- [ ] .dev-lock 格式应规范包含 `task_id:` 字段（目前仅部分有）
- [ ] 新建 .dev-lock 时同步写入 task_id（Step 0 worktree 步骤）
- [ ] grep -A N 的 N 要足够大，确保覆盖整个函数体（本次 20→40）
