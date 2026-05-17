# C6 tick.js WORKFLOW_RUNTIME 灰度 Learning

## 背景
Brain v2 Phase C6 —— tick.js 首次接线 L2 orchestrator `runWorkflow('dev-task')`，加 `WORKFLOW_RUNTIME=v2` env gate 灰度切换。C2 审查时守门条件"tick.js 零 runWorkflow 调用"在本 PR 解除。

## 根本原因

C1-C5 完成后 Brain container 跑的是旧 image 不含 `workflows/` 目录，C6 开工前必须先 `bash scripts/brain-deploy.sh` 把新 image 部署。若跳过 deploy，v2 flag 生效后 `getWorkflow('dev-task')` 会报 "workflow not found"，fire-and-forget `.catch` 静默吞错误，生产任务积压无提示。

handoff §4 原 code snippet 写 `runWorkflow('dev-task', task.id, attemptN, task)` 参数 `task`，但 `DevTaskState` 字段是 `{task, result, error}`，`runAgentNode` 读 `state.task`，所以正确入参必须包装为 `{task: taskToDispatch}`。

fire-and-forget `.catch(err => console.error)` 错误落 stdout 被 docker log rotation 滚掉，C6 合并后 24h 观察窗口无法排障。改用 `logTickDecision` 写入 decisions 表，CI 可以 grep `action='workflow_runtime_error'` 定位。

本轮还踩了"subagent 跑偏开新分支"的坑：subagent-driven-development 派 Task 1 实现时，subagent 忽略 `cp-0424155809` worktree 自己开了 `brain-c6-workflow-runtime-flag` 新分支 + 写了差异实现（top-level import + synthetic runId + console.error），还误伤删除了 worktree 的 git metadata。本地 files 未丢，靠 `/tmp/tick-c6-impl.js` 备份 + `git worktree prune` + `git worktree add` 重建 worktree + `npm install` 恢复 node_modules，才回到可继续的状态。

## 下次预防

- [ ] Brain deploy 冒烟：手动 set `WORKFLOW_RUNTIME=v2` 前先验证 `docker exec cecelia-node-brain ls /app/src/workflows/` 有输出、`docker logs | grep "Workflows initialized"` 存在
- [ ] runWorkflow 接入任何 workflow 时，确认 input 结构与目标 graph `StateGraph Annotation.Root` 字段名一致（读 `<name>.graph.js` 的 `export const XxxState = Annotation.Root({...})`）
- [ ] fire-and-forget graph 调用的 `.catch` 必须走 `logTickDecision` 或 `recordDispatchResult(false, 'reason')` 落库，不可仅 `console.error`
- [ ] v2 分支补齐 bookkeeping（`_lastDispatchTime` / `recordDispatchResult` / `emit('task_dispatched')`），否则 capacity budget / dashboard WS / dispatch stats 静默断裂
- [ ] vitest mock 使用 `vi.hoisted()` 而非裸对象引 top-level（C2 learning）
- [ ] Manual smoke 验证 checkpoint resume：中途 kill Brain → restart → `psql SELECT thread_id, COUNT(*) FROM checkpoints WHERE thread_id LIKE '<task_id>:%' GROUP BY thread_id` 返回 rows > 0
- [ ] subagent 派任务时，prompt 里硬写"必须在分支 cp-XXX 上 commit，不得新建分支"；dispatch 后立刻 `git branch -a` 验未开新 branch；否则手动 inline 做

## 相关
- PR: 本 PR
- Handoff: `docs/design/brain-v2-c6-handoff.md`
- Design: `docs/superpowers/specs/2026-04-24-c6-workflow-runtime-flag-design.md`
- Plan: `docs/superpowers/plans/2026-04-24-c6-workflow-runtime-flag.md`
- Spec SSOT: `docs/design/brain-orchestrator-v2.md` §6 + §12
