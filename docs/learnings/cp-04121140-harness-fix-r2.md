### 根本原因

Harness 验证命令依赖 DB 数据（planner 任务的 result.branch），但 Brain 运行的是 main 分支旧代码，PR 未合并时新的 result.branch 持久化逻辑无法生效。已完成的 planner 任务 result 字段全为 null，导致 Evaluator 所有验证命令均失败。

同时，planner 分支 `cp-0411225047-c57f1210-...` 被复用为无关功能 PR（health 端点），导致对应 sprint 的 sprint-prd.md 从未提交，pipeline-detail 无法读取内容。

### 下次预防

- [ ] harness-planner skill 必须在完成前验证 sprint-prd.md 已提交到分支（`git show origin/branch:file`），否则视为失败
- [ ] planner 任务的 result 必须包含 branch 字段（harness-generator 输出 verdict DONE 时同步回写）
- [ ] harness_fix 任务触发前，检查 original generate task 的 pr_url 是否为 null，若是则先定位已有 PR
- [ ] 新 sprint 的 planner 分支命名需包含 sprint_dir 关键词，避免与其他任务分支混淆
