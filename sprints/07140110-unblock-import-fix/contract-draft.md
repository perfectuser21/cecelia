# Contract Draft：unblock 端点 import 路径修复

**Task ID**: f35db586-1119-46e1-bfbe-8f7dcdb50455  
**Sprint Dir**: sprints/07140110-unblock-import-fix  
**日期**: 2026-07-14  
**类型**: bug_fix  

---

## 问题陈述

`packages/brain/src/routes/tasks.js` 中三处动态 import 使用了错误路径 `'./task-updater.js'`，导致 `POST /api/brain/tasks/:id/unblock` 和 `POST /api/brain/tasks/:id/block` 返回 500：

```
Cannot find module '/app/src/routes/task-updater.js'
```

`task-updater.js` 实际位于 `packages/brain/src/task-updater.js`，正确路径为 `'../task-updater.js'`。

受影响位置（共 3 处）：
- 第 600 行：unblock 处理器（`:taskId/unblock`）
- 第 1119 行：block 处理器（`:id/block`）
- 第 1147 行：unblock 处理器（`:id/unblock`）

---

## 修复范围（Scope）

- **只改** import 路径字符串：`'./task-updater.js'` → `'../task-updater.js'`（共 3 处）
- **禁止** 修改 `unblockTask` / `blockTask` 业务逻辑
- **禁止** 新增或删除路由

---

## TDD 执行顺序

### Step 1：Red Commit（Failing Test 先行）

在 `packages/brain/src/routes/__tests__/tasks-unblock.test.js` 写测试，Mock `'../../task-updater.js'`（正确路径），验证：
- `POST /tasks/:taskId/unblock`（第 600 行路由）返回 200 + `{ success: true, task: <task_object> }`
- `POST /tasks/:id/unblock`（第 1147 行路由）返回 200 + `{ success: true, task_id, status: 'queued' }`
- `POST /tasks/:id/block`（第 1119 行路由）返回 200 + `{ success: true, task_id, status: 'blocked', reason, blocked_until }`

此时路径未修，测试必须 FAIL。commit 消息含 `[failing-test]`。

### Step 2：Green Commit（修路径）

修改 `tasks.js` 三处 import 路径 → 运行 vitest 确认全绿 → commit 消息含 `[fix]`。

---

## E2E 验收

### 验收断言（技术层面）

**断言 E2E-1a**：`POST /api/brain/tasks/:taskId/unblock`（第 600 行路由）返回 HTTP 200，响应体包含 `{ success: true, task: { id: <id>, ... } }`（task 为完整对象）。（此前因 import 路径错误必然 500）

**断言 E2E-1b**：`POST /api/brain/tasks/:id/unblock`（第 1147 行路由）返回 HTTP 200，响应体包含 `{ success: true, task_id: <id>, status: 'queued' }`。（此前因 import 路径错误必然 500）

**断言 E2E-2**：`POST /api/brain/tasks/:id/block`（第 1119 行路由）返回 HTTP 200，响应体包含 `{ success: true, task_id: <id>, status: 'blocked', reason: <reason>, blocked_until: <timestamp_or_null> }`。（此前因 import 路径错误必然 500）

**断言 E2E-3**：vitest 输出 `tasks-unblock.test.js` 全部测试 PASS，0 FAIL。

**断言 E2E-4**：`pnpm test --filter @cecelia/brain` 全绿，包含既有 `tasks.test.js`、`task-tasks.test.js`、`tasks-canceled-transition.test.js`、`tasks-result-backfill.test.js`，无回归。

**断言 E2E-5**：`git diff HEAD~1..HEAD -- packages/brain/src/routes/tasks.js` 仅包含 3 行 `./task-updater.js` → `../task-updater.js` 的变更，无其他 diff。

### 验收命令

```bash
# 进入 brain 包目录
cd /workspace/packages/brain

# 运行新增 regression test
pnpm vitest run src/routes/__tests__/tasks-unblock.test.js

# 运行全套 brain 测试（确保无回归）
pnpm test

# 验证 diff scope 最小化（绿化提交后）
git diff HEAD~1..HEAD -- src/routes/tasks.js | grep "^[+-]" | grep -v "^---\|^+++" 
```

---

## Invariants

| ID | 约束 |
|----|------|
| INV-01 | `task-updater.js` 仅存在于 `src/` 根，import 路径必须为 `'../task-updater.js'` |
| INV-02 | 修复只改路径字符串，不改业务逻辑 |
| INV-03 | regression test 永久留存于 `routes/__tests__/`，进 CI，不可删 |
| INV-04 | 既有 tasks 路由测试套件全部通过 |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| unblock /:taskId/unblock（第 600 行）成功路径 | `packages/brain/src/routes/__tests__/tasks-unblock.test.js` | BEHAVIOR-01a: 返回 `{ success: true, task: <task_object> }` | → FAIL（import('./task-updater.js') 路径错误，路由抛 500） |
| unblock /:id/unblock（第 1147 行）成功路径 | `packages/brain/src/routes/__tests__/tasks-unblock.test.js` | BEHAVIOR-01b: 返回 `{ success: true, task_id, status: 'queued' }` | → FAIL（import('./task-updater.js') 路径错误，路由抛 500） |
| block /:id/block（第 1119 行）成功路径 | `packages/brain/src/routes/__tests__/tasks-unblock.test.js` | BEHAVIOR-02: 返回 `{ success: true, task_id, status: 'blocked', reason, blocked_until }` | → FAIL（import('./task-updater.js') 路径错误，路由抛 500） |
| 既有 tasks 路由无回归 | `packages/brain/src/routes/__tests__/tasks.test.js` et al. | BEHAVIOR-04: 374/374 既有测试全绿 | → 无新 FAIL（修复不引入回归） |

---

## 非功能要求

- 修复 diff 行数 < 10 行
- 单元测试不依赖外部服务（vi.mock 隔离）
- 测试文件命名与既有 `routes/__tests__/` 风格一致
