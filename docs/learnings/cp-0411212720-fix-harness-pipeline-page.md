# Learning: HarnessPipelinePage 白屏 + 端点错误

## 根本原因

1. **端点选择错误**：组件对每个 planner 发起 5 次独立 fetch（子任务类型过滤），但 Brain GET /api/brain/tasks 不支持 planner_task_id 过滤参数，导致返回所有子任务混杂在一起
2. **任务类型名称拼写错误**：harness_contract_reviewer / harness_generator / harness_evaluator（均为错误名称），数据库实际为 harness_contract_review / harness_generate / harness_evaluate
3. **白屏根因**：dev server 初次启动失败（node_modules 未安装），用户测试时看到无响应页面

## 下次预防

- [ ] 新增前端页面前，先用 `curl localhost:5221/api/brain/<endpoint>` 验证端点存在且返回正确结构
- [ ] 任务类型名称从 DB 实际值确认（`psql cecelia -c "SELECT DISTINCT task_type FROM tasks WHERE task_type LIKE 'harness%'"`）
- [ ] 专用聚合端点优于多次细粒度请求（harness-pipelines 已存在，应直接使用）
- [ ] dev server 启动后检查 npm install 是否完整
