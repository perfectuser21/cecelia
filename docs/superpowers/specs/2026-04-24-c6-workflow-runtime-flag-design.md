# C6 Design — tick.js WORKFLOW_RUNTIME 灰度 + dev-task runWorkflow 接线

**日期**：2026-04-24
**分支**：cp-0424155809-brain-v2-c6-tick-workflow-runtime
**Brain task**：4262fa62-c072-43f5-a818-90c00a55f0a8
**上游 PRD**：`docs/design/brain-v2-c6-handoff.md` §4（已合并 main）
**spec SSOT**：`docs/design/brain-orchestrator-v2.md` §6（L2 Orchestrator）+ §12（决策表）

## 1. Goal

`tick.js` 的 `dispatchNextTask` 在 `triggerCeceliaRun` 调用前加 `WORKFLOW_RUNTIME=v2` env gate：flag=v2 且 task_type=dev 时走 L2 `runWorkflow('dev-task', ...)` fire-and-forget；默认（未设 / `v1`）走原 legacy `triggerCeceliaRun` 路径。生产默认零行为变化。

## 2. 插入点

单派发点：`packages/brain/src/tick.js` L1363 `const execResult = await triggerCeceliaRun(taskToDispatch);`（`dispatchNextTask` 函数内，Budget downgrade 之后）。

## 3. 设计（含 Subagent review 的 3 点细化）

### 3.1 v2 分支 bookkeeping 必须补齐

fire-and-forget 不能跳过 capacity budget / WebSocket / dispatch stats，否则 C6 打开 v2 后观测面板全断。v2 分支必须手动调：

- `_lastDispatchTime = Date.now()`
- `recordDispatchResult(pool, true, 'workflow_runtime_v2')`
- `emit('task_dispatched', 'tick', { task_id, title, runtime: 'v2', success: true })`
- `actions.push({ action: 'dispatch_v2_workflow', task_id, runtime: 'v2' })`
- 返回 `{ dispatched: true, task_id, runtime: 'v2', actions }`

不补 `publishTaskStarted` —— 因为 run_id 是 cecelia-run 特有，v2 路径走 spawn 无此概念。WebSocket 订阅方需自适应 runtime 字段（后续 D 阶段处理）。

### 3.2 runWorkflow input 必须包装成 `{task}`

`dev-task.graph.js` 里 `DevTaskState = { task, result, error }`，`runAgentNode` 读 `state.task`。handoff snippet 写 `runWorkflow('dev-task', task.id, attemptN, task)` 歧义 —— 实际实现：

```js
runWorkflow('dev-task', taskToDispatch.id, attemptN, { task: taskToDispatch })
```

### 3.3 attemptN 计算

```js
const attemptN = (taskToDispatch.payload?.attempt_n ?? taskToDispatch.retry_count ?? 0) + 1;
```

遵循 spec §6.3 thread_id 格式 `{taskId}:{attemptN}` 强制 1-based。

### 3.4 错误处理：log 入 decisions 表而非 console-only

C1-C5 learning 提醒：静默吃 checkpoint 损坏会卡死任务。v2 分支 `.catch` 内用 `logTickDecision` 落盘（已 imported），不是裸 console.error：

```js
runWorkflow('dev-task', taskToDispatch.id, attemptN, { task: taskToDispatch })
  .catch(err => {
    logTickDecision(
      'tick',
      `runWorkflow dev-task failed: ${err.message}`,
      { action: 'workflow_runtime_error', task_id: taskToDispatch.id, runtime: 'v2', error: err.message },
      { success: false }
    );
  });
```

这样 CI 可 grep decisions 表排障，不依赖 stdout。

## 4. 单测（`packages/brain/src/__tests__/tick-workflow-runtime.test.js`）

vitest + `vi.hoisted()` mock（C2 learning：不能裸对象引 top-level）。

覆盖 4 场景：

1. **env 未设 → legacy 被调**：verify `triggerCeceliaRun` called，`runWorkflow` 未调
2. **env=v1 → legacy 被调**：同上
3. **env=v2 & task_type=dev → runWorkflow 被调**：verify `runWorkflow('dev-task', taskId, expectedAttemptN, {task})` called，`triggerCeceliaRun` 未调
4. **env=v2 但 task_type=harness_initiative → legacy 被调**：v2 flag 不影响非 dev task

额外 1 场景：`retry_count=2 → attemptN=3`（input 计算正确）。

**不测**：runWorkflow 内部 graph 逻辑（那是 C1/C2 测试职责）；fire-and-forget `.catch` 的 logTickDecision（该函数已测过）。

## 5. 成功标准

- 生产默认（env 未设）→ 零行为变化（legacy triggerCeceliaRun 走原路径）
- `WORKFLOW_RUNTIME=v2` + task_type=dev → runWorkflow 被调，thread_id 格式 `{taskId}:{attemptN}` 写入 pg checkpoints
- 合并后 manual smoke：中途 kill Brain → restart → checkpoint resume 可 observe
- 新测试 ≥ 5 cases pass，现有 tick 相关测试不退化

## 6. 不做（C6 scope 外）

- harness_initiative / content_publish 分派迁 runWorkflow（C8，需图结构重设计）
- executor.js PostgresSaver 散建清理（C7）
- 清 `WORKFLOW_RUNTIME` flag（C8 稳定后）
- tick.js 瘦身到 ≤ 200 行（Phase D）
- `publishTaskStarted` runtime 字段适配（D 阶段处理 WebSocket 订阅）

## 7. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| v2 分支跳过 `publishTaskStarted` → dashboard 无 run_id 显示 | 用户手动 set env 后必然注意到；manual smoke 验证 task 状态变化可见 |
| fire-and-forget `.catch` 延迟到下个 event loop | 使用 `await` 包装的 `.catch` 就近捕获；decisions 表不丢数据 |
| spawn 内部无 checkpoint → 崩溃后 graph resume 但 spawn 任务本身不重放 | C6 仅验 graph 层 checkpoint 持久化（thread_id + state 可 resume）；spawn 本身重放是 C8 scope |
| 测试 mock 漏 `_lastDispatchTime` 观测 | 测试 assert `actions` 数组包含 `dispatch_v2_workflow` 即可 |

## 8. 实施 commit 拆分

**单 PR 两 commit**（TDD 纪律）：

1. `test(brain): C6 tick-workflow-runtime failing tests (Red)` — 只加 test 文件，5 cases 全 fail（v2 分支未实现）
2. `feat(brain): C6 tick.js WORKFLOW_RUNTIME=v2 + dev-task runWorkflow 接线 (Green)` — 加 tick.js v2 分支逻辑，测试全绿

push 前手动跑 `npm test --workspace=packages/brain -- tick` 双 commit 状态验证。

## 9. Learning 文件

`docs/learnings/cp-0424155809-brain-v2-c6-tick-workflow-runtime.md` 必须含：
- 根本原因（C6 解除"tick.js 零 runWorkflow"守门条件）
- 下次预防 checklist（手动 set env 之前确认 Brain 已 deploy C1-C5；smoke 合并后 24h 观察 runtime='v2' 日志不增错）
