# Harness v2 harness_task 容器派发

### 根本原因

PR-1 让 `harness_initiative`（Planner 阶段）走容器，但 Phase B 的子 Task（`task_type=harness_task`）在 executor.js 里没有显式分支，会落到默认 bridge 派发 headless Claude Code — 绕过了 PR-1 的 worktree + GITHUB_TOKEN 成果。`task-router.js` 虽然标注 `/_internal` 占位，但实际代码并没按这个标注走。

### 下次预防

- [ ] 给新 `task_type` 加 route 时，一定要在 `executor.js` 里补显式 `if (task.task_type === 'xxx')` 分支，不能依赖默认落位或仅靠 `task-router.js` 的映射表
- [ ] Phase A/B/C 各阶段的 dispatcher 全链路必须一次性讲清（谁创建、谁拉起、谁关闭），不能只改一段
- [ ] PR 完成后跑一次 "真实 `/api/brain/tasks` 派一个该类型任务" 验证，而不是只信任单测 mock
- [ ] 新增 dispatch 函数一律采用 DI 形式（`deps = {executor, ensureWorktree, resolveToken}`），保持可测试性
