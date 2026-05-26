# Design: Harness Pipeline 支持外部 Repo（base_repo）

**日期**: 2026-05-19  
**状态**: APPROVED

## 问题

`harness-initiative.graph.js` 的两处 `ensureHarnessWorktree` 调用都未传 `baseRepo`，函数内 fallback 到 `DEFAULT_BASE_REPO = '/Users/administrator/perfect21/cecelia'`，导致 harness pipeline 只能在 Cecelia 仓库运行。用户希望对 ZenithJoy 等外部 repo 也能走同一 harness pipeline。

## 现有支持

`harness-worktree.js::ensureHarnessWorktree(opts)` 已接受 `opts.baseRepo`（line 101），只差调用方没传入。

## 变更范围

### 1. `packages/brain/src/workflows/harness-initiative.graph.js`

**Call site 1**（line 114，`runInitiative` 函数 prep 节点）：

```js
// Before
worktreePath = await ensureHarnessWorktree({ taskId: task.id, initiativeId });

// After
const baseRepo = task.payload?.base_repo || undefined;
worktreePath = await ensureHarnessWorktree({ taskId: task.id, initiativeId, baseRepo });
```

**Call site 2**（line 551，`prepInitiativeNode`）：

```js
// Before
const worktreePath = await ensureHarnessWorktree({ taskId: state.task.id, initiativeId });

// After
const baseRepo = state.task?.payload?.base_repo || undefined;
const worktreePath = await ensureHarnessWorktree({ taskId: state.task.id, initiativeId, baseRepo });
```

### 2. 集成测试

文件：`packages/brain/src/__tests__/harness-initiative-base-repo.test.js`

- mock `ensureHarnessWorktree`，验证 `base_repo` 从 payload 透传到函数调用
- 验证两个 call site（`runInitiative` 和 `prepInitiativeNode`）
- 验证无 `base_repo` 时不传（兜底 DEFAULT 逻辑由 `harness-worktree.js` 负责）

### 3. Smoke 测试

文件：`packages/brain/scripts/smoke/base-repo-support-smoke.sh`

- 创建包含 `base_repo` 字段的 `harness_initiative` task
- 验证 Brain API 接受该 payload（任务创建成功，状态合法）

## 测试策略

| 行为 | 测试类型 | 位置 |
|------|----------|------|
| `base_repo` 从 payload 透传到 `ensureHarnessWorktree` 调用 | unit test | `harness-initiative-base-repo.test.js` |
| 无 `base_repo` 时不传入（由 worktree 层 fallback） | unit test | 同上 |
| Brain API 接受含 `base_repo` 的 payload | smoke | `base-repo-support-smoke.sh` |

## 不在本次范围

- `docker-executor.js` 的 `workflowsDir` 硬编码（harness skills 仍从 Cecelia 读，外部 repo 不影响）
- sub-task 级调用（`harness-task.graph.js`）— 不同层级，不在此次范围
