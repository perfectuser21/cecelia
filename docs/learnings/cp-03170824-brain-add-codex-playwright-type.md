# Learning: Brain DB migration 154 — codex_playwright task type

Branch: cp-03170824-brain-add-codex-playwright-type
Date: 2026-03-17

## 背景

PR #998 合并后，`codex_playwright` task type 已注册到 `task-router.js` 的 LOCATION_MAP，
但遗漏了 DB 层的 `tasks_task_type_check` check constraint。
导致 Brain API 创建 `codex_playwright` 任务时报 `constraint violation` 错误。

### 根本原因

新增 task type 涉及两个独立的代码层：
1. `task-router.js` LOCATION_MAP（JS 路由层）
2. `tasks` 表的 check constraint（DB 约束层）

PR #998 只更新了路由层，遗漏了 DB 层，形成了"半注册"状态。

### 下次预防

- [ ] 新增 task_type 时，必须同时检查：`task-router.js` + `tasks` check constraint
- [ ] 在 brain-register skill 中添加提示：注册新 task_type 时检查 DB constraint 是否同步
- [ ] 建立 brain-ci 测试：验证 `isValidTaskType()` 返回 true 的类型都在 DB constraint 中
