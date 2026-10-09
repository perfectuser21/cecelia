---
task_id: 05ae922c-4f2a-4c1c-9f86-d24937fc32d3
step: intent
upstream: []
---
# 修复 Brain 非法参数请求挂死或 500 泄露数据库报错（projects/goals/journeys/dev-records）

## 背景

金丝雀任务（决策 a1fdbc51 第③步：runner 改动后真跑一条验证合并门绑定 head、可信判卷代码、预览版本绑定）。生产实测（2026-10-10，只读请求）：GET /api/brain/projects/not-a-uuid 与 GET /api/brain/goals/not-a-uuid 请求一直挂着不返回（curl 10~15 秒超时、无状态码）；GET /api/brain/journeys/not-a-uuid 返回 500 并带 invalid input syntax for type uuid 的数据库原文；GET /api/brain/dev-records?limit=-1 返回 500 并带 LIMIT must not be negative。合法但不存在的 id 现在返回 404，需保持。参考已修好的同类：GET /api/brain/tasks/:id 非法 id 返回 400 {"error":"Invalid task id: must be a UUID"}。

### I-1
GET /api/brain/projects/not-a-uuid 在 2 秒内返回 400，响应体不含数据库报错原文

### I-2
GET /api/brain/goals/not-a-uuid 在 2 秒内返回 400，响应体不含数据库报错原文

### I-3
GET /api/brain/journeys/not-a-uuid 返回 400，响应体不含 invalid input syntax

### I-4
GET /api/brain/dev-records?limit=-1 返回 400 且说明 limit 必须是非负整数，不含数据库报错原文

### I-5
合法但不存在的 uuid 对 projects / goals / journeys 仍返回 404
