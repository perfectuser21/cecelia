---
task_id: 3e8414f6-19a4-415a-9b27-8e6353e9c6e2
step: intent
upstream: []
---
# 修复 Brain GET /api/brain/tasks 非法筛选参数静默返回（status 拼错返回空列表、limit 非数字被忽略）

## 背景

金丝雀任务 2（决策 a1fdbc51 第③步；验证 #6157 之后 coding workflow PR 不被 CI 通用 auto-merge 抢合、必须经真人 QA + 独立裁判 + 绑定 head 的合并门）。生产实测（2026-10-10，只读）：GET /api/brain/tasks?status=bogus 返回 200 []，用户以为没有任务；GET /api/brain/tasks?limit=abc 返回 200 且忽略 limit。期望：非法筛选值返回 400，并说明允许的取值，不透出数据库报错；合法请求行为不变。

### I-1
GET /api/brain/tasks?status=bogus 返回 400，响应体说明 status 允许的取值

### I-2
GET /api/brain/tasks?limit=abc 与 limit=-1 返回 400，说明 limit 必须是正整数

### I-3
GET /api/brain/tasks?status=queued&limit=5 仍返回 200 且最多 5 条、全部 status=queued

### I-4
不带参数的 GET /api/brain/tasks 行为不变（200 数组）
