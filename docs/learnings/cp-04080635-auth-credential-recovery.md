# Learning: auth 凭据失效级联 quarantine 恢复

## 根本原因

account3 OAuth token 于 2026-04-07 失效，circuit breaker 默认仅 2h 窗口，每 2h 一次重置后继续派发，17h 内累积 168 次 auth 失败，32 个业务任务被 quarantined。

同时，`recoverAuthQuarantinedTasks` 和 `proactiveTokenCheck` 已在最近 PR 中加入 tick.js，但 Brain 进程（6:25AM 启动）在文件写入磁盘（6:30~6:40AM）之前已载入旧模块，导致恢复逻辑未运行。

## 下次预防

- [ ] migration 必须包含去重逻辑（`DISTINCT ON` + `NOT EXISTS`），防止同名任务同时更新为 queued 触发唯一约束
- [ ] 凭据恢复的 UPDATE migration 应用 CTE 而非直接 UPDATE，避免批量约束冲突
- [ ] Brain 部署后应确认进程已重启（`ls -la` 文件时间 vs `ps -p PID` 启动时间对比）
- [ ] POST /api/brain/credentials/recover 可用于 Brain 重启前的临时手动恢复
