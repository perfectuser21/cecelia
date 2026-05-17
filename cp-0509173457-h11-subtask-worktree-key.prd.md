# PRD: H11 sub-task worktree key 用 <init8>-<logical_id> 复合

**Brain task**: 92f6228b-909e-4e24-aaf7-860aeb87b35c
**Spec**: docs/superpowers/specs/2026-05-09-h11-subtask-worktree-key-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement

## 背景

W8 v11 task feddcf5e 实测暴露 PR #2851 隐藏 P0：sub-graph spawnNode 调 ensureHarnessWorktree(taskId='ws1') 被 shortTaskId(≥8) 拒 throw → spawnNode return {error} → sub-graph 进 await_callback interrupt 但容器没起 → 90min 超时。spawn 从未真跑过。

H8 PR 基于错误假设（"generator 在 task-{shortTaskId(initiativeUUID)} 干活"），实际是 cosmetic noop，需在 H11 一并修正。

## 修法

1. harness-worktree.js：(a) ensureHarnessWorktree 加 wtKey + branch override；(b) 新 export harnessSubTaskWorktreePath(initiativeId, logicalId) + harnessSubTaskBranchName(initiativeId, logicalId)
2. harness-task.graph.js spawnNode line 120：调 ensureWt 时传 wtKey + branch（复合 ID）
3. harness-initiative.graph.js evaluateSubTaskNode：H8 改的 worktreePath 改用 harnessSubTaskWorktreePath(state.initiativeId, state.sub_task?.id) 跟 generator 一致

## 成功标准

- sub-graph spawnNode 不再 throw 'taskId must be ≥8 chars'
- W8 v12 真起 harness-task-* detached 容器
- evaluator 跟 generator mount 同一 worktree（task-<init8>-<logical>）

## 不做

- 不动 shortTaskId / makeCpBranchName 校验
- 不动 H7/H9/H8/H10
- 不引入完整 contract enforcement layer
