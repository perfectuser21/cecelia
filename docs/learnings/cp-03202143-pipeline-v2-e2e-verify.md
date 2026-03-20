# Learning: Pipeline v2 端到端验证

## 任务
通过真实的文档更新任务，端到端跑完整的 /dev 4-Stage Pipeline 流程，验证 Pipeline v2 改造是否跑通。

## 验证结果

### Stage 0: Worktree
- worktree-manage.sh 存在 `MAX_WORKTREES` unbound variable bug，脚本直接崩溃
- 手动 `git worktree add` 正常工作，不阻塞流程

### Stage 1: Spec
- Task Card 生成正常
- verify-step.sh Gate 1（check-dod-mapping.cjs）正常通过
- verify-step.sh Gate 2（agent_seal）需要在当前 session 的 worktree 下写入 seal 文件
- spec_review 向 Brain 注册时，因 `tasks_task_type_check` constraint 不包含 `spec_review` 类型而失败，降级为跳过

### Stage 2: Code
- 纯文档改动，DoD 验证全部通过
- verify-step.sh step2 对纯文档改动有"无实现代码"的检查，docs 改动需要特殊处理

### Stage 3: Integrate
- push + PR 创建正常
- CI 通过

### Stage 4: Ship
- Learning 写入正常
- PR 合并正常

### 根本原因

Pipeline v2 改造的 5 个 PR 聚焦于 Engine 层（SKILL.md/步骤文件/devloop-check.sh），但遗漏了两个配套改动：
1. Brain 数据库的 task_type check constraint 未添加 `spec_review`/`code_review` 新类型
2. worktree-manage.sh 的 `MAX_WORKTREES` 变量在 `set -u` 模式下未初始化

### 下次预防

- [ ] 改造涉及新 task_type 时，同步准备 Brain migration 添加 check constraint
- [ ] worktree-manage.sh 修复 `MAX_WORKTREES` unbound variable（设置默认值）
- [ ] agent worktree 嵌套场景下，bash-guard.sh 的分支检测逻辑需要考虑跨 worktree 写入
