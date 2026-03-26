# Learning: GTD 页面空数据 — apps/api 与 Brain DB 表断路

## 背景
GTDOkr/GTDProjects/GTDArea 等前端页面调用 `/api/tasks/goals`、`/api/tasks/projects`、`/api/tasks/areas`，但 apps/api 路由查的是本地 `goals`/`projects` 表，这些表不存在于 cecelia DB，导致前端永远返回空数据。

### 根本原因
apps/api 的 task-system 路由（goals.js/projects.js）是为旧版自有 DB schema 设计的，查的是 `goals` 和 `projects` 这两个表。
但系统实际数据已全部迁移到 Brain DB 的新 schema：`objectives`/`key_results`/`okr_projects`/`okr_initiatives`/`areas` 表。
两个系统（apps/api 和 Brain）虽然共用同一个 `cecelia` PostgreSQL 数据库连接，但假设的表名完全不同，造成"数据在但查不到"的断路。

### 下次预防
- [ ] 新建前端页面前先确认对应的 API endpoint 实际返回数据（`curl /api/xxx | head`），不要假设路由已连通
- [ ] apps/api 的 task-system 路由如需查 Brain 数据，直接查同一 DB 的正确表名（okr_* 前缀），不要假设旧表存在
- [ ] DoD 测试必须 CI 兼容：不能用 `http.get` 调本地服务，改用 `node -e "require('fs').readFileSync"` 做文件内容检查
- [ ] DoD 的 Test: 字段不加反引号包裹，格式为 `Test: manual: node -e "..."` 而非 `` Test: `manual: ...` ``
