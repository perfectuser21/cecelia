## Stop Hook dev-lock 自愈（2026-04-14）

### 根本原因
dev-lock 文件在 worktree 正常时意外丢失（cleanup 脚本、subagent 操作、用户手动等）。stop-dev.sh 在 orphan 扫描找不到匹配 session_id 的 lock → exit 2 block。T2（session_id 隔离）与 T4（worktree 消失）均无法覆盖此场景。

### 下次预防
- [ ] Stop Hook 的恢复策略要有"轻量自愈"层（重建可复原的状态文件），不是 T2/T4 那种"识别来源决定放行"的硬策略
- [ ] 日后添加新状态文件（.dev-seal / .ci-lock 等），都要考虑"文件丢失如何自愈"
