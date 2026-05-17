# Learning: worktree-gc blocked 任务保护

分支: cp-03211855-gc-blocked-protect
日期: 2026-03-21

## 变更内容

- worktree-gc.sh 新增 检查 5：删除前查询 Brain API 检查 branch 是否有 blocked 任务，有则跳过

### 根本原因

跨域依赖阻塞机制设计中发现：agent 退出释放 slot 后，worktree 保留在磁盘等待恢复。但 worktree-gc.sh --force 模式会删超过 48h 的 worktree，可能在等待期间误删 blocked 任务的 worktree，导致恢复时工作成果丢失。

### 下次预防

- [ ] 涉及任务生命周期的新机制（block/suspend/defer）上线前，检查所有清理脚本（GC/janitor/cleanup）是否会误删相关资源
- [ ] Brain API 查询超时降级必须是默认行为，不能因 Brain 不可用导致 GC 完全不工作
