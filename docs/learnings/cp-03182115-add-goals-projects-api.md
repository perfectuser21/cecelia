---
branch: cp-03182115-add-goals-projects-api
date: 2026-03-18
task_id: 88a2495f-7fa9-4f63-99ec-cde7f12e20ba
---

# Learning: 新增 GET /goals/:id + GET /projects/:id 只读 API 端点

### 根本原因

Brain 中 `task-goals.js` 和 `task-projects.js` 的 `GET /:id` 端点使用 `SELECT *` 返回全量字段，且错误格式包含额外的 `id` 字段（`{ error: 'Goal not found', id: '...' }`）。intent-expand skill 需要精确的字段契约（`{id, type, title, description, parent_id, project_id}` / `{id, title, description, kr_id, goal_id}`）。

### 下次预防

- [ ] 在设计只读 API 端点时，明确指定 SELECT 字段而非 `SELECT *`，避免返回不必要的敏感或冗余字段
- [ ] 错误响应格式应统一：只包含 `error` 字段，不在 404 响应中附带 `id`（id 是调用方传入的，不需要回显）
- [ ] DoD 中的 `[BEHAVIOR]` 测试不能用 `curl http://localhost:5221` — CI 环境无法访问本地 Brain 服务，应改用文件内容检查（`node -e "require('fs').readFileSync(...)`）验证代码逻辑
- [ ] `.task-cp-...md` 中的 DoD 文件引用路径需精确对应实际修改的文件，本次从 `routes.js`（聚合器）改为 `task-goals.js` / `task-projects.js`（实际路由文件）
