### 根本原因

Harness v3.1 存在三个系统性问题：

1. **命名混乱**：用 `sprint_*` 命名任务类型，但系统处理的是单次任务（harness run），不是 sprint。导致代码和对话中持续出现"sprint"歧义。

2. **CI/Deploy 断链**：`sprint_generate` 完成后立即触发 `sprint_evaluate`，但 Evaluator 跑的是 main 分支的旧 Brain（P0 Bug）。正确流程应该是：Generator push PR → CI → Evaluator 读 PR diff → auto-merge → Deploy → Report。

3. **Evaluator P0 Bug**：Evaluator 调 `localhost:5221` 验证的是当前运行的旧 Brain，而不是 Generator 在 PR 里新写的代码，导致所有评估结果无效。

### 下次预防

- [ ] Evaluator SKILL.md 明确禁止调 localhost API，改为读 PR diff 静态分析
- [ ] Generator 输出 JSON 时必须包含 `pr_url` 字段（供 CI watch 使用）
- [ ] 新 task_type 加入前先检查是否需要同时更新：task-router.js / executor.js / execution.js / selfcheck.js / migration
- [ ] `harness_ci_watch` 和 `harness_deploy_watch` 任务不能进入 dispatch 队列（在 selectNextDispatchableTask 查询里排除）
- [ ] SKILL.md 文件与 task_type 保持 1:1 映射，名称一致
