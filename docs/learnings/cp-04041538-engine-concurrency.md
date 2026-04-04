# Learning: Engine 并发加固三件事

**PR**: cp-04041538-engine-concurrency
**Date**: 2026-04-04

## 变更摘要

1. **P0 hooks/ 软链接** — 主仓库 hooks/ 早已是软链接（git tree mode 120000），worktree 也正确继承。本次确认状态、无需改动。
2. **P2 _session_matches headless fallback** — 去掉 `&& -z "$lock_session"` 约束，允许在 stop hook 上下文中 CLAUDE_SESSION_ID 未传递时回退到 branch 匹配。
3. **P3 macOS mkdir 原子锁** — flock 不可用时（macOS），用 `mkdir lockdir` 实现互斥，最多重试 20 次（2秒），超时后 exit 2 block。

### 根本原因

**P2**：stop hook 以子进程执行，父 shell 的 `CLAUDE_SESSION_ID` 环境变量不一定传递。当 .dev-lock 有 session_id 而环境变量为空时，条件 2 失败，原条件 3 又要求 lock_session 也为空，导致双重"无 session_id"才能走 branch 匹配，headless 并发场景下 branch 匹配被封死。

**P3**：macOS 没有 `flock` 命令（GNU coreutils），原代码只有 flock 分支，在 macOS 上完全跳过互斥锁，并发会产生竞态。

### 下次预防

- [ ] stop hook 新增匹配逻辑时，先列出所有"env var 可能为空"的场景
- [ ] 新增 OS 相关系统调用时，同步加 macOS fallback（flock/inotify/epoll 等均无 macOS 等价物）
- [ ] 并发场景设计文档：branch-only fallback 的前提是"单 branch 单 agent"，需在 Brain 调度层保证
