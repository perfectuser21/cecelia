## Brain 启动时 self-PID claimed_by 死锁修复（2026-05-02）

### 根本原因

Brain 运行在 Docker 容器内，每次容器重启进程 PID 都是 7，因此 `claimerId = 'brain-tick-7'` 循环复用。`cleanupStaleClaims` 只清除 `claimed_at < NOW() - 60 minutes` 的 claim，但容器重启后的新 Brain 进程与崩溃进程 PID 相同，60 分钟内新近的 self-PID claim 不会被清除，导致所有 queued 任务永久锁死，dispatch 完全停止。

### 下次预防

- [ ] 任何使用 `process.pid` 作为唯一标识的逻辑，必须考虑 PID 复用场景（容器化环境尤其突出）
- [ ] Brain 崩溃/重启后 dispatch 无响应时，优先检查 `claimed_by` 是否被 self-PID 锁死（`SELECT claimed_by, COUNT(*) FROM tasks WHERE status='queued' GROUP BY claimed_by`）
- [ ] `cleanupStaleClaims` 现在在时间窗口扫描前先清除 self-PID claims，可在 Brain 启动日志看到 `cleared N self-PID claims (brain-tick-7)` 确认清理执行
- [ ] 如果将来改用 hostname + pid 或 UUID 作为 claimerId，此类死锁不会再发生
