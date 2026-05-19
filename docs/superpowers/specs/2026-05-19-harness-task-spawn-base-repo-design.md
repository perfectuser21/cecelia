# harness-task spawnNode baseRepo 透传 设计文档

## 背景

harness pipeline PR #3042 已支持外部 repo（`base_repo` payload），Phase A（planner/proposer/reviewer）正确使用 `baseRepo`。

Phase B 的 generator 任务由 `runSubTaskNode`（harness-initiative.graph.js）调 `harness-task.graph.js` 子图完成。子图的 `spawnNode` 创建 generator worktree 时调 `ensureHarnessWorktree`，但**没有传 `baseRepo`**，导致 worktree 在 Cecelia 目录（`DEFAULT_BASE_REPO`）创建，而非外部 repo（如 ZenithJoy）。随后 `git fetch origin <contract-branch>` 在 Cecelia remote 找不到 ZenithJoy 的 propose branch → spawn fail → `await_callback` 永久卡死。

## 根本原因

`TaskState`（harness-task.graph.js）没有 `baseRepo` channel，无法接收来自父图的 baseRepo 值。`runSubTaskNode` 调 `compiled.invoke()` 时没有传 `baseRepo`。

## 方案

唯一正确方案：3 处最小改动，沿用既有模式。

### 改动 1：TaskState 加 baseRepo channel

```js
// harness-task.graph.js，contractBranch 之后
baseRepo: Annotation({ reducer: (_o, n) => n, default: () => null }),
```

### 改动 2：spawnNode 透传 baseRepo

```js
// harness-task.graph.js spawnNode，约 L149
// 原
worktreePath = await ensureWt({ taskId: task.id, initiativeId, wtKey, branch });
// 改
worktreePath = await ensureWt({ taskId: task.id, initiativeId, wtKey, branch, baseRepo: state.baseRepo || undefined });
```

### 改动 3：runSubTaskNode 透传 baseRepo

```js
// harness-initiative.graph.js runSubTaskNode compiled.invoke() 参数，约 L1102-1110
baseRepo: state.task?.payload?.base_repo || undefined,
```

## 不做

- 不改 `FullInitiativeState`（`task` 字段已承载 `payload.base_repo`）
- 不改 `fix_dispatch`、`evaluate_contract` 等节点（不涉及 worktree 创建）
- 不修改 `ensureHarnessWorktree`（已支持 `opts.baseRepo`）

## 测试策略

| 类型 | 文件 | 覆盖内容 |
|------|------|---------|
| 集成测试 | `packages/brain/src/__tests__/harness-task-spawn-base-repo.test.js` | spawnNode 收 state.baseRepo → 传给 ensureHarnessWorktree；runSubTaskNode 从 task.payload.base_repo 传给子图 |
| smoke.sh | `packages/brain/scripts/smoke/harness-task-spawn-base-repo-smoke.sh` | grep 验证 3 处代码改动存在 |

## 受影响文件

- `packages/brain/src/workflows/harness-task.graph.js`：TaskState + spawnNode（2 处改动）
- `packages/brain/src/workflows/harness-initiative.graph.js`：runSubTaskNode（1 处改动）
- `packages/brain/src/__tests__/harness-task-spawn-base-repo.test.js`：新增测试
- `packages/brain/scripts/smoke/harness-task-spawn-base-repo-smoke.sh`：新增 smoke

## 向后兼容

无 `baseRepo` 时 `state.baseRepo = null`，`ensureHarnessWorktree` 的 `opts.baseRepo = undefined` → 使用 `DEFAULT_BASE_REPO`（Cecelia）。现有行为完全不变。
