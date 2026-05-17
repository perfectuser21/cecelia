# Learning: execution-callback 未自动创建 sprint_evaluate

**时间**: 2026-04-05  
**分支**: cp-04052039-fix-execution-callback-sprint-evaluate  
**任务**: fix(brain): execution-callback 在 sprint_generate 完成后未自动创建 sprint_evaluate

### 根本原因

`actions.js` 中 `isSystemTask()` 的 `systemSources` 数组缺少 `'execution_callback_harness'`。

当 execution.js 的 5c-harness 块在 sprint_generate 完成后调用 `createTask({ task_type: 'sprint_evaluate', trigger_source: 'execution_callback_harness' })` 时，因为 `goal_id` 为 null（harness 自动创建任务不一定有 goal_id），`createTask` 抛出 `goal_id is required` 错误。

该错误被 execution.js line 1729 的 catch 块静默吞掉，只打印了 `console.error`（且因 Brain 日志缓冲未刷新而不可见），导致 sprint_evaluate 从未出现在 tasks 表中。

### 修复

1. **`packages/brain/src/actions.js` line 21**: 将 `'execution_callback_harness'` 加入 `systemSources`
2. **`packages/brain/src/routes/execution.js`**: catch 块加入 `harnessErr.stack` 提升可观测性
3. **新增测试**: `actions-goal-validation.test.js` 的 `execution_callback_harness exemption` 块验证 sprint_evaluate 和 sprint_fix 可以在 goal_id=null 时创建

### 下次预防

- [ ] 新增 trigger_source 时，检查 `isSystemTask()` 的 `systemSources` 是否需要同步更新
- [ ] harness callback 错误不应静默吞掉——至少要在 Brain 的事件日志/decision_log 里留一条记录
- [ ] 集成测试：execution-callback → sprint_generate completed → sprint_evaluate 应出现在 tasks 表（目前只有 mock 测试）
