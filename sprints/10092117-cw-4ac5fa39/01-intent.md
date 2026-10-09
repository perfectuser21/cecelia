---
task_id: 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2d
step: intent
upstream: []
---
# 修复 Brain GET /api/brain/tasks/:id 非法 id 返回 400 不再 500 泄露数据库报错

## 背景

接替任务 578b8c63（同一问题，本条带 coding 开关进新链首跑：合同对抗→写码→CI→真人 QA→独立裁判→合并）。evaluator 真人 QA 在 PR #6117 预览环境探索式测试发现：GET /api/brain/tasks/not-a-uuid 或 id 为空格时返回 HTTP 500 并带 invalid input syntax for type uuid 的数据库原始报错，用户以为服务故障且泄露内部信息。期望非法 id 返回 400 说明格式不对，不透出数据库报错。

### I-1
GET /api/brain/tasks/not-a-uuid 返回 400 且响应体不含 invalid input syntax

### I-2
GET /api/brain/tasks/%20 返回 400 且响应体不含数据库报错

### I-3
合法但不存在的 uuid 仍返回 404
