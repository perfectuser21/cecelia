# Learning: harness_* 全类型未加入 SPRINT_ACCOUNT1_TASK_TYPES

## 根本原因
executor.js 的 SPRINT_ACCOUNT1_TASK_TYPES 数组在 v4.0 升级时只加了核心执行类型（harness_generate/evaluate/fix等），遗漏了调度/监控类型（harness_planner/ci_watch/deploy_watch），导致这三类任务走 selectBestAccount() 随机分配，命中 account3 失效账号后 401 认证失败。

### 下次预防
- [ ] 新增 harness_* 任务类型时，必须同时检查 SPRINT_ACCOUNT1_TASK_TYPES 是否包含
- [ ] 每次扩展 harness 类型矩阵时，对照 task-router.js TASK_REQUIREMENTS 做全量比对
