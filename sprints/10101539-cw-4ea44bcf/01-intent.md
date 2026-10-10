---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: intent
upstream: []
---
# 修复 POST /api/brain/strategic-decisions 非法 category 返回 500 并透出数据库约束报错

## 背景

金丝雀任务 3（决策 a1fdbc51 第③步：runner 改动后跑金丝雀，端到端验证审计 P2 批次 A–F 与执行记录接入：重试带错误、状态写 Brain、QA 报告校验、规格必填段与判定点写库、全链计费与交付复盘、QA 命令固化 smoke、spans 上报）。生产实测（2026-10-10）：POST /api/brain/strategic-decisions 带 category=workflow_bogus 返回 HTTP 500，响应体 error 是数据库原文「new row for relation "decisions" violates check constraint "decisions_category_chk"」，调用方不知道该填什么。期望：非法 category 返回 400，响应体列出允许的取值，不透出数据库报错；合法写入行为不变。

### I-1
POST /api/brain/strategic-decisions 带不在允许列表里的 category 返回 400，响应体说明 category 允许的取值，且不包含数据库约束名或 SQL 报错原文

### I-2
不带 category 的请求行为不变（按现有默认值写入，返回 201）

### I-3
合法 category（例如 decision）写入返回 201，GET /api/brain/strategic-decisions?category=<该值> 能查到这条记录
