# Task 状态流转 Integration Test 设计

**日期**: 2026-05-01
**分支**: cp-0501215612-task-status-transitions-integration-test
**Brain Task ID**: e23d83f2-84b9-494c-8740-29978ee9b35d

---

## 背景与目标

现有 `/api/brain/tasks` 端点有存活检查，但没有验证 `queued → in_progress → completed` 状态流转是否真实持久化到 PostgreSQL 的 integration test。

本 PR 是 brain-test-pyramid 项目第一层第三个 PR，补全这一测试盲区。

---

## 架构决策

### 使用哪个路由？

两个候选路由：
- `routes/task-tasks.js`：`PATCH /:id`，支持 `queued → in_progress → completed/cancelled/failed`，是标准的任务状态管理路由
- `routes/tasks.js`：`PATCH /tasks/:task_id`，只允许 `in_progress/completed/failed`，transition 限制更严格，更适合 Engine 回写

**决策**：使用 `task-tasks.js`，因为它：
1. `POST /` 创建任务（返回 queued）
2. `PATCH /:id` 更新状态（queued → in_progress → completed）
3. `GET /:id` 获取单个任务（验证持久化）
4. `GET /` 支持 `?status=` 过滤（验证列表查询）

这四个端点形成完整的 CRUD 链路，符合"验证每步持久化"的目标。

### teardown 策略

`completed` 是 terminal status（状态机保护）。cleanup 使用直接 DB 删除（`testPool.query('DELETE FROM tasks WHERE id = ANY($1)')`），与其他 integration test 保持一致。

---

## 测试策略

**分类**：Integration Test（跨路由 + 真实 PostgreSQL）

**测试文件**：
`packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js`

**覆盖的 6 个步骤**：
1. `POST /api/brain/tasks` — 创建 `[TEST-status-transitions]` 前缀任务，验证返回 `status=queued`
2. `GET /api/brain/tasks?status=queued` — 验证能在列表中查到该任务
3. `PATCH /api/brain/tasks/:id` — `queued → in_progress`，验证 HTTP 200 + DB 持久化
4. `GET /api/brain/tasks/:id` — 独立查询验证 `in_progress` 持久化
5. `PATCH /api/brain/tasks/:id` — `in_progress → completed`，验证 HTTP 200 + DB 持久化（含 `completed_at` 时间戳）
6. `afterAll teardown` — 直接 DB 删除清理测试数据

**不测内容**：
- KR 进度回算（`completed` 触发，但无 `okr_initiative_id`，自动跳过）
- event-bus 事件发布（mock）
- 无效 transition 的 409（留给 unit test）

---

## Mock 策略

沿用 golden-path.integration.test.js 的 mock 模式：
- `event-bus.js` → mock（不测事件发布）
- `domain-detector.js` → mock（返回固定 domain）
- `quarantine.js` → mock（含 FAILURE_CLASS）
- `task-updater.js` → mock（blockTask）
- 不 mock `db.js`（真实 PostgreSQL 连接）
