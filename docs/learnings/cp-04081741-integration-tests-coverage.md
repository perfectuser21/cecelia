# Learning: cp-04081741 — integration-tests-coverage

**日期**: 2026-04-08  
**分支**: cp-04081741-integration-tests-coverage

---

### 背景

新增 4 个 Brain 集成测试文件，补全 deploy/rollback、harness flow、pipeline rescue、跨包 API 调用的测试覆盖缺口。

---

### 根本原因

**问题 1: task_type 约束限制**  
测试用了 `harness_dev` 和 `analysis` 这两个不在 `tasks_task_type_check` 约束中的 task_type，导致 DB 插入返回 400。  
**根本原因**: 没有提前检查 migration 222 定义的合法 task_type 列表。

**问题 2: vitest 在 worktree 中无法直接运行**  
worktree 没有 node_modules，从 worktree 目录直接调用 `npx vitest` 失败。  
**根本原因**: git worktree checkout 只复制代码，不复制 node_modules。解法：symlink 根目录 node_modules 到 worktree，或从主仓库 packages/brain 目录引用。

---

### 下次预防

- [ ] 写 Brain 集成测试用 task_type 时，先查 `migrations/` 最新的 constraint 定义（当前最新：migration 222）
- [ ] 可用合法 task_type 参考列表（从 migration 222 提取）：`dev`, `review`, `research`, `harness_generate`, `harness_evaluate`, `pipeline_rescue` 等
- [ ] worktree 中运行测试方法：`ln -sf /path/to/main/node_modules /path/to/worktree/node_modules`
