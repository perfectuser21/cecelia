## harness-task spawnNode baseRepo 透传（2026-05-19）

### 根本原因

`harness-task.graph.js` 的 `TaskState` 没有 `baseRepo` channel，`spawnNode` 调 `ensureHarnessWorktree` 时没有传 `baseRepo`，导致外部 repo（如 ZenithJoy）的 generator worktree 在 Cecelia 目录创建。随后 `git fetch origin <contract-branch>` 在 Cecelia remote 找不到 ZenithJoy 的 propose branch，spawn 失败，`await_callback` 永久卡死。

### 下次预防

- [ ] 新增子图时，检查父图传入的所有字段是否都有对应的 `TaskState` channel（`baseRepo`、`contractBranch` 等）
- [ ] `spawnNode` 或类似 worktree 创建节点，入参必须显式列出所有 `ensureHarnessWorktree` 支持的 opts（包括 `baseRepo`）
- [ ] `runSubTaskNode` 调 `compiled.invoke()` 时，用 checklist 核对父图 state 的字段是否全部透传
- [ ] 外部 repo 任务上线前，用 `task.payload.base_repo` 不为空的测试用例跑一遍 `spawnNode` 集成测试
