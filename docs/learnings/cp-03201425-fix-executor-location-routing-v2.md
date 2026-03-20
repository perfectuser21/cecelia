# Learning: executor 路由被并行 PR 回滚

### 根本原因
PR #1195 修复了 executor 路由（按 location 走），但并行 PR #1198 以为 #1195 是 bug，
把 DEV_ONLY_TYPES 硬编码加了回去。导致 cto_review 等 location=us 的任务被发到西安。

### 下次预防
- [ ] executor 路由逻辑变更必须在 commit message 中详细说明为什么不能用 DEV_ONLY_TYPES
- [ ] 并行 agent 修改同一文件时，检查最近合并的 PR 是否有冲突意图
