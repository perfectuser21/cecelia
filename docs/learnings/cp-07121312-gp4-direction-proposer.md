# GP4/T4 direction-proposer——scheduler job 内联取代新 task_type 的取舍

### 根本原因
「每周菜单」类周期产出容易被惯性建成新 task_type（task-router 四处登记+executor 分支+并发线），
但其本质是确定性聚合+一次 LLM 汇总，无需完整 dev 会话；接线面大而收益为零。

### 下次预防
- [ ] 周期性产出先问"需要完整 dev 会话吗"：不需要 → scheduler job 内联（ci_patrol/line-dreaming 先例），需要 → 才走 task_type
- [ ] 与并行消费方的数据约定（working_memory key/value 结构）必须在任务描述里钉死后再动工，防两端各写各的
