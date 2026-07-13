# Sprint PRD：unblock 端点 import 路径错致生产 500

**Sprint Dir**: sprints/07140110-unblock-import-fix  
**Task ID**: f35db586-1119-46e1-bfbe-8f7dcdb50455  
**日期**: 2026-07-14  
**Journey Type**: bug_fix  
**Target Environment**: brain

---

## 问题描述

`POST /api/brain/tasks/:id/unblock` 返回 500，错误详情：

```
Cannot find module '/app/src/routes/task-updater.js'
```

根因：`packages/brain/src/routes/tasks.js` 中有两处动态 import 使用了错误的相对路径 `'./task-updater.js'`，而 `task-updater.js` 实际位于 `packages/brain/src/task-updater.js`（routes 目录的父级），正确路径应为 `'../task-updater.js'`。

受影响位置：
- 第 600 行：`unblock` 处理器（`:taskId/unblock`）
- 第 1119 行：`block` 处理器（`:id/block`）  
- 第 1147 行：`unblock` 处理器（`:id/unblock`）

---

## Invariants（不变式）

1. **INV-01**：`task-updater.js` 只存在于 `packages/brain/src/task-updater.js`，routes 目录下不存在同名文件，import 路径必须为 `'../task-updater.js'`。
2. **INV-02**：修复只改 import 路径字符串，不修改 `unblockTask` / `blockTask` 业务逻辑。
3. **INV-03**：regression test 必须永久存入 `routes/__tests__/` 并进 CI，不可删除。
4. **INV-04**：修复后既有 tasks 路由测试（`tasks.test.js`、`task-tasks.test.js` 等）必须全部通过。

---

## Functional Requirements（FR）

### FR-1：Failing Test 先行（TDD）
- 在 `packages/brain/src/routes/__tests__/tasks-unblock.test.js` 新建测试文件
- Mock 模式沿用既有的 `vi.mock('../../db.js', ...)` + supertest 风格
- Mock `../../task-updater.js`（正确路径），断言：
  - `POST /tasks/:id/unblock` 路由调用 `unblockTask` 成功时返回 200 + `{ success: true, task_id, status: 'queued' }`
  - `POST /tasks/:id/block` 路由调用 `blockTask` 成功时返回 200 + `{ success: true, task_id, status: 'blocked' }`
- **此 test 在修复前必须 FAIL（验证复现），commit 后再修路径**

### FR-2：修复 import 路径
- 修改 `packages/brain/src/routes/tasks.js`：
  - 第 600 行：`'./task-updater.js'` → `'../task-updater.js'`
  - 第 1119 行：`'./task-updater.js'` → `'../task-updater.js'`
  - 第 1147 行：`'./task-updater.js'` → `'../task-updater.js'`
- 共 3 处，全部修改

### FR-3：测试变绿验证
- FR-1 新增测试通过（`tasks-unblock.test.js` 全绿）
- 既有测试套件全部通过：`tasks.test.js`、`task-tasks.test.js`、`tasks-canceled-transition.test.js`、`tasks-result-backfill.test.js`
- CI `brain-ci.yml` 全绿

---

## 验收标准（DoD）

| # | 标准 | 验证方式 |
|---|------|----------|
| A1 | Failing test 先 commit，CI 可见 FAIL | git log 含 `[failing-test]` commit |
| A2 | 修路径后 test 变绿 | vitest 输出 PASS |
| A3 | 既有 tasks 路由测试全过 | `pnpm test --filter @cecelia/brain` 全绿 |
| A4 | CI 全绿 | GitHub Actions brain-ci.yml green |
| A5 | 只改 import 路径，不动业务逻辑 | diff 仅含路径字符串变更 |

---

## 执行顺序

```
Step 1: 写 tasks-unblock.test.js（failing state）→ commit [failing-test]
Step 2: 修 tasks.js 三处 import 路径 → commit [fix]
Step 3: 本地 vitest 确认全绿
Step 4: push → 等 CI 全绿
Step 5: PR → merge
```

---

## 铁律

- **禁止**跳过 failing test 先行步骤
- **禁止**修改 `unblockTask` / `blockTask` 业务实现
- **禁止**删除新增的 regression test
- **禁止** `gh pr merge --admin` 绕过 CI

---

## NFR

- 单元测试不依赖外部服务（vi.mock 隔离）
- 修复 diff 行数 < 10 行（scope 最小化）
- 测试文件与既有 routes/__tests__/ 命名风格一致

---

journey_type: bug_fix
target_environment: brain
