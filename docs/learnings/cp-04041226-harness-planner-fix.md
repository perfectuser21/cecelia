---
branch: cp-04041226-harness-planner-fix
task_id: 2d6dde97-1e24-4733-a533-2a0cbeb433e7
created: 2026-04-04
---

# Learning: Harness v2.0 Planner→Sprint 断链修复

### 根本原因

设计 Harness v2.0 时，Generator 角色由两种 task 担任：
1. `sprint_generate` task（显式 Generator）
2. `dev+harness_mode` task（Planner 通过 /architect 注册的 Sprint）

但断链代码只考虑了情形1，导致情形2出现3个Bug：

**Bug 1**: `sprint_evaluate` 创建时 `dev_task_id` 取 `harnessPayload.dev_task_id`，对 `sprint_generate` task 这是父 dev task，但对 `dev+harness_mode` task 自身，payload里没有 `dev_task_id`，结果为 undefined → PASS 后无法 mark completed。

**Bug 2**: PASS 序列解锁时，对下一个 `harness_mode` task 的处理逻辑是创建一个新的 `sprint_generate` task，把原来 blocked 的 `dev+harness_mode` task 作为 `dev_task_id` 传入。这导致：
- 原 blocked dev task 永远不会被 dispatch（它变成了一个 "影子" task）
- 新 sprint_generate task 运行完成后，标记的是原 dev task completed（绕弯了一圈）
- 增加了不必要的任务数

正确做法：直接 unblock 下一个 dev+harness_mode task 即可，它携带 `harness_mode: true`，dispatch 时自动以 Generator 模式运行。

**Bug 3**: /architect Phase 5 curl 示例没有 `sprint_dir`，Planner 注册的任务无法告诉 Generator 工作目录。Bug 2 的临时修复（创建 sprint_generate）会硬编码 `sprints/sprint-N` 作为 sprint_dir，但正确做法是 Planner 在注册时就设好。

### 下次预防

- [ ] 新增 task_type 能作 Generator 时，检查断链代码里所有 `sprint_generate` 的判断是否同时覆盖了 `dev+harness_mode`
- [ ] sprint_evaluate 创建时，`dev_task_id` 应优先用 `harnessPayload.dev_task_id || task_id`（自身兜底）
- [ ] 序列解锁逻辑：harness_mode 下直接 unblock 原 blocked task，不创建新 task
- [ ] Planner skill 注册串行任务时，每个 payload 必须包含 `sprint_dir: "sprints/sprint-N"`
