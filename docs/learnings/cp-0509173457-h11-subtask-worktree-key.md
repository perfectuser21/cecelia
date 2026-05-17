# Learning: H11 — sub-task worktree key 复合 ID

**PR**: cp-0509173457-h11-subtask-worktree-key
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement

## 现象

W8 v11（task feddcf5e）实测：graph 跑到 pick_sub_task → run_sub_task 后停了 18+ 分钟无 sub_task 容器 spawn。最终 sub-graph state 含 error=`{node:'spawn',message:'prep: taskId must be ≥8 chars, got ws1'}`。runSubTaskNode 进 _waitForSubGraphCompletion 卡 90min 等永远不会来的 callback。

### 根本原因

PR #2851 让 sub-graph spawnNode 调 `ensureHarnessWorktree(taskId=subTask.id='ws1')`，但 ensureHarnessWorktree 内 shortTaskId 强制 ≥8 字符，"ws1" 3 字符 → throw → spawnNode return {error} → sub-graph 进 await_callback interrupt 等永远不到的 callback。**spawn 从未真跑通过**，PR #2851 在 main 上 8 天没被实测。

H8 PR 基于错误假设（"generator 在 task-<shortTaskId(initiativeUUID)>" 干活，所以 evaluator 改用同样路径）。但实际 generator 从未真起，H8 改的 worktreePath = harnessTaskWorktreePath(state.task.id) 等价于改之前的 state.worktreePath（都是 initiative 主 worktree）—— H8 是 cosmetic noop。

哲学层根因：**新代码必须真跑通至少一次才算合并**。PR #2851 / H8 都通过了 vitest（mock 路径），但 vitest mock 不验证真 ensureHarnessWorktree 调用链。Stage 2 contract enforcement layer 应在 brain side verify "sub-graph 实际产出文件" 而不是依赖 mock。

### 下次预防

- [ ] 任何 PR 改动 ensureHarnessWorktree / spawnNode 调用链，必须**手动跑一次 W8** 看 sub-graph 真起容器（不光 vitest）
- [ ] worktree 路径计算 helper 集中到 harness-worktree.js export，避免 callers 各自拼字符串导致漂移
- [ ] sub-task identifier 跨层（initiative → graph state → spawn → docker）应有 contract test 验证（输入 logical_id "ws1" → 全链路 worktree path / branch / docker --name 都能用）
- [ ] spec review 时检查"假设的产出文件路径"是否有真实代码生成那条路径（H8 假设 generator 写到 task-<shortTaskId>，但代码里 generator 没此行为）
