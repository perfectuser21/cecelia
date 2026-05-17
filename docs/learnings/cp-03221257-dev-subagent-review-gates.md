---
branch: cp-03221257-dev-subagent-review-gates
date: 2026-03-22
task: /dev Pipeline — 用 Agent Subagent 替换 Codex 异步审查门禁
---

# Learning: Agent Subagent 替换 Codex 异步 Gate

## 根本原因

有头模式（用户直接与 Claude Code 对话）下 `/dev` pipeline 卡死，根因是三层级联：

1. `00-worktree-auto.md` 在"已在 worktree"路径的 `else` 分支只打印日志，**从不创建 `.dev-lock`**
2. `stop-dev.sh` 扫描 `.dev-lock.*` 文件匹配当前会话，找不到 → `_PRE_MATCHED=false` → `exit 0`（不阻塞）
3. Codex async 审查派发出去但没有 Stop Hook 约束循环，Claude 会话退出，审查结果无人等待

## 修复要点

| 文件 | 问题 | 修复 |
|------|------|------|
| `00-worktree-auto.md` | 新任务进 worktree 不创建 `.dev-lock` | 进 worktree 后立刻创建，含 tty + session_id + `$$` 保证唯一性 |
| `01-spec.md` | Codex async dispatch + 等 stop hook | Agent subagent 同步调用 + 重试 3 次降级 |
| `02-code.md` | Codex async dispatch + 等 stop hook | Agent subagent 同步调用 + git diff 传入 |
| `devloop-check.sh` | `_check_codex_review` 轮询 Brain API | 删除（subagent 同步，无需轮询） |
| `runner.sh` | 多实例并发写 `.dev-mode` 无保护 | flock + double-check + 锁文件清理 |

## 关键决策：subagent vs Codex

- **Codex async**：派发到外部 runner → Brain DB 记录状态 → Stop Hook 轮询 → 需要 `.dev-lock` 约束循环
- **Agent subagent**：在当前会话内发出 API call → Anthropic 服务器执行 → 同步等待结果 → 不需要 Stop Hook 约束

subagent 的 `devloop-check.sh` 兼容性：`_check_codex_review()` 逻辑是 `[[ -z "$task_id" ]] && return 0`——无 task_id 时天然放行，天然兼容 subagent 路径（只需删除调用，不会有破坏性）。

## 下次预防

- [ ] 每次在 `00-worktree-auto.md` 添加分支路径时，检查该路径是否创建 `.dev-lock`（Stop Hook 必需）
- [ ] Codex async 门禁只用于跨会话任务；同 session 内的审查用 Agent subagent（同步、不占 slot）
- [ ] flock 锁文件要在 block 结束后清理（`rm -f "$lockfile" 2>/dev/null`）
- [ ] session_id 唯一性：`headed-$(date +%s)-$$-${BRANCH}`（加进程 ID `$$` 防秒级并发冲突）
