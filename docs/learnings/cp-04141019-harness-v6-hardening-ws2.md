### 根本原因

WS2 实现了 Harness v6-hardening 的清理生命周期全链路：stop hook 孤儿 worktree 自动清理、harness_cleanup 任务三类产物处理、stale 分支批量删除脚本。核心决策是将孤儿 worktree 清理放到 stop.sh 路由层（而非 stop-dev.sh）以保证所有 session 结束后都能触发，并用 fire-and-forget 后台子进程保证失败不阻塞。

### 下次预防

- [ ] execution.js 是多 workstream 共同写入的文件，WS1 和 WS2 并行时会产生创建冲突，合并时需手动合并两个 workstream 的 export 函数
- [ ] stop.sh 的 worktree 清理使用 `gh pr view` 需要 gh CLI 已认证，在 CI 或无网络环境中应有降级处理
- [ ] cleanup-stale-branches.sh 依赖 `node` 解析 JSON，需确保运行环境有 node 可用
