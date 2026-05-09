# PRD: H8 evaluator 切到 generator 的 task worktree

**Brain task**: e11351fa-6566-40b6-99a7-460b217fbe1b
**Spec**: docs/superpowers/specs/2026-05-09-h8-evaluator-worktree-switch-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1

## 背景

PR #2851 让 sub-graph 自己 ensureHarnessWorktree → generator 在 `<baseRepo>/.claude/worktrees/harness-v2/task-<shortTaskId>/` 干活。但 evaluateSubTaskNode (harness-initiative.graph.js:1170) 传给 executor 的 worktreePath 仍是 state.worktreePath（initiative 主 worktree） → evaluator 容器看不到 generator commit 的产物 → v9 跑里 evaluate 4 次 FAIL 都报"acceptance-task-payload.json 不存在"。

## 修法

1. harness-worktree.js：export DEFAULT_BASE_REPO + 新增 export harnessTaskWorktreePath(taskId, opts={})，ensureHarnessWorktree 内部改用此 helper（SSOT）
2. harness-initiative.graph.js：import harnessTaskWorktreePath；evaluateSubTaskNode 内 taskWorktreePath = harnessTaskWorktreePath(state.task.id)；传给 executor 的 worktreePath 改成 taskWorktreePath

## 成功标准

- evaluator 容器 mount 的 worktree = generator 干活的 task-<shortTaskId> 目录
- evaluate verdict 不再因 acceptance-task-payload.json 缺失恒报 FAIL
- 幂等门保留（state.evaluate_verdict 非空 short-circuit）

## 不做

- 不动 generator/proposer 节点 worktree（已对）
- 不动 ensureHarnessWorktree self-heal 逻辑
- 不引入 push creds / 不重设计 callback router
- 不做 H7/H9/proposer verify push（独立 PR）
