## 未覆盖/不可验证链路

### B-6 harness run 记录

`/api/brain/harness/runs` 端点为全局只读列表，无 POST 创建端点（验证：`Cannot POST /api/brain/harness/runs`）。本次 headless run 未走 Brain orchestrator 的完整 initiative_run 创建流程（该流程在 Brain tick → spawn container → INSERT initiative_run 时触发），因此无法通过代码手动插入记录。这是 headless dispatch 的已知局限：仅有 Brain 内部 tick 系统才能创建 initiative_run 行。需要后续 Brain 侧支持「前台接管时补录 initiative_run」功能。

### B-7 started_at 非 null

`started_at` 字段仅在 Brain 内部 tick → `actions.updateTask(status='in_progress')` 路径中自动设置为 `NOW()`（见 `packages/brain/src/actions.js:344`）。外部 PATCH `/api/brain/tasks/:id` 端点不包含 `started_at` 的赋值逻辑（见 `packages/brain/src/routes/tasks.js`），且 PATCH 端点要求 `status` 或 `result` 字段，不支持直接传 `started_at`。前台接管的 headless run 任务状态由 `dispatch-helpers.js` 通过 SQL 直写设置为 `in_progress`，未经过 `actions.updateTask` 路径，故 `started_at` 保持 null。需要后续在 dispatch-helpers 或专属端点中补充 `started_at = NOW()` 写入。

### B-8 完成态

`status=completed` 且 `pr_url` 非空的验证仅在本 sprint 全部完成（PR 合并）后才能通过。当前 sprint 尚在进行中，此项为阶段性 CONCERN，预期在 PR 合并后转为 PASS。
