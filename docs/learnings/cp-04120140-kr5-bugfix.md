# Learning: Dashboard KR5 剩余 Bug

## 根本原因

前端发送 camelCase 字段（`profileId`），后端期待 snake_case（`profile_id`）。
JS 对象简写 `{ profileId }` 在 `JSON.stringify` 后是 `{"profileId":"xxx"}`，不等于 `{"profile_id":"xxx"}`。

## 下次预防

- [ ] 写 PUT/PATCH 请求时，先查后端 route 的 `req.body` 解构变量名，确认字段格式（snake_case vs camelCase）
- [ ] 新增 API 端点时检查 LiveMonitor 是否已有调用该路径的代码（防止"悬空 fetch"）
