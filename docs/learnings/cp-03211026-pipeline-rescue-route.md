# Learning: pipeline_rescue 任务类型未注册到路由系统

## 分支
cp-03211026-pipeline-rescue-route

### 根本原因
pipeline-patrol.js (PR #1244) 引入了新的 task_type `pipeline_rescue`，但没有同步在 executor.js 的 skillMap/US_ONLY_TYPES 和 task-router.js 的 LOCATION_MAP 中注册。新增 task_type 时需要在三处同时注册。

### 下次预防
- [ ] 引入新 task_type 时，使用 checklist 确保三处注册：executor skillMap、US_ONLY_TYPES（如需）、task-router LOCATION_MAP
- [ ] facts-check.mjs 会校验 DEFINITION.md 中的 task_types 列表，push 前必须通过
- [ ] 考虑添加 CI 检查：扫描代码中所有 task_type 字面量，确保都在 LOCATION_MAP 中注册
