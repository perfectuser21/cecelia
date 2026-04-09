# Learning: Brain headless session_id + serial workstream

**Branch**: cp-04092253-brain-headless-serial-ws  
**Date**: 2026-04-09

### 根本原因

两个独立问题：

1. **无头模式 session_id 丢失**：Brain 通过 cecelia-bridge 派发任务时，未将 `CLAUDE_SESSION_ID` 注入 Claude 子进程环境，导致 Stop Hook `_session_matches()` 无法通过 session_id 路径匹配，headless 模式（tty=none）下 exit 0 误放行。

2. **并行 Workstream 资源竞争**：APPROVED 后同时创建 N 个 `harness_generate` 任务，并发执行消耗大量 API 槽位，且 git worktree 边界不清时存在冲突风险。

### 修复方案

1. `executor.js`：在 `getExtraEnvForTaskType()` 返回 `extraEnv` 后立即注入 `extraEnv.CLAUDE_SESSION_ID = task.id`，通过 bridge API 的 `extra_env` 字段传递。

2. `execution.js`：APPROVED 块改为只创建 `workstream_index=1`，在 `harness_generate` 完成回调中检查 `currentWsIdx < totalWsCount`，若成立则串行创建下一个 workstream 任务。

### 下次预防

- [ ] Brain 派 Claude Code 任务时，CLAUDE_SESSION_ID 必须作为标准 extra_env 注入（不依赖 Claude 自动设置）
- [ ] 多 Workstream 任务优先考虑串行（资源可控），并行需要明确的 slot 预算
