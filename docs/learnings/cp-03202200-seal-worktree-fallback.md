# Learning: stop-dev seal worktree fallback

## 背景
stop-dev.sh 的 seal/agent-seal 检查在 worktree 场景下路径不匹配，导致 seal 永远找不到。

### 根本原因
verify-step.sh 写 seal 到 worktree 路径（如 `/xxx/.claude/worktrees/agent-xxx/.dev-seal.branch`），而 stop-dev.sh 只在 `$PROJECT_ROOT` 查找。当 agent 在 worktree 中运行时，`$PROJECT_ROOT` 指向 worktree 根目录，但 seal 可能在不同的 worktree 子路径。路径不一致导致 seal 永远找不到 → 返回"验签缺失" → agent 不知所措。

### 下次预防
- [ ] 涉及文件路径读写的逻辑，写入方和读取方必须使用相同的路径计算逻辑
- [ ] 在 worktree 场景下，所有路径相关逻辑都应加 fallback 搜索
- [ ] stop hook 的阻止消息应包含明确的执行指令而非"等待"语义，避免 agent 误解为需要询问用户
