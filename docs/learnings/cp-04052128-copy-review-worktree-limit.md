# Learning: content_publish 因 worktree 上限阻塞

**任务**: [SelfDrive] 修复 P0 Issue：内容流水线 copy-review 失败阻塞  
**分支**: cp-04050628-bc706110-ae4a-463a-9f70-5ad7c9  
**日期**: 2026-04-05

---

### 根本原因

1. **copy-review 重试循环**（已由 PR #1905 修复）：`_executeLLMPath` 用 `|| text` fallback 接受 LLM 澄清性问题作为文案，导致 copy-review 拒绝并触发 3 次重试达上限终止 pipeline。

2. **content_publish 阻塞**（本次修复）：Brain 从 `content-export` 创建 8 个并发 `content_publish` 任务，每个任务重试时均需创建新 worktree。`MAX_WORKTREES=10` 的上限很快被耗尽，导致后续任务全部以 `worktree_creation_failed` 失败且 `should_retry: false`，永久阻塞发布链路。

---

### 下次预防

- [ ] `MAX_WORKTREES` 默认值应基于系统最大并发任务数估算：8 content_publish + 若干 dev = 至少 15
- [ ] worktree 上限达到时不应直接报错退出，应先尝试自动清理已合并 worktree
- [ ] `content_publish` 任务属于运行时执行型（非代码修改型），长期考虑是否需要独立于 dev worktree 的执行路径

---

### 修复内容

- `packages/engine/skills/dev/scripts/worktree-manage.sh`：上限触发 → 自动 `cmd_cleanup` → 重新检查 → 仍超则失败
- `packages/workflows/skills/dev/scripts/worktree-manage.sh`：同步新增上限检查 + 自动清理逻辑
- `MAX_WORKTREES` 默认值 10 → 15
