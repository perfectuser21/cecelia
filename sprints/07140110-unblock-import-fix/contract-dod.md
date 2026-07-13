# Contract DoD：unblock 端点 import 路径修复

**Task ID**: f35db586-1119-46e1-bfbe-8f7dcdb50455  
**Sprint Dir**: sprints/07140110-unblock-import-fix  
**日期**: 2026-07-14  

---

## [BEHAVIOR] 条目

### [BEHAVIOR-01] POST /tasks/:id/unblock 成功路径返回 200

**描述**：当 `task-updater.js` 导入路径正确时，`POST /api/brain/tasks/:id/unblock` 调用 `unblockTask` 成功应返回 HTTP 200，响应体为 `{ success: true, task_id, status: 'queued' }`。

**触发条件**：任务存在，`unblockTask` mock 返回成功。

**期望结果**：
- HTTP 状态码：200
- 响应体：`{ success: true, task_id: <id>, status: 'queued' }`

**对应测试**：`tasks-unblock.test.js` → `POST /:id/unblock — 成功时返回 200`

---

### [BEHAVIOR-02] POST /tasks/:id/block 成功路径返回 200

**描述**：当 `task-updater.js` 导入路径正确时，`POST /api/brain/tasks/:id/block` 调用 `blockTask` 成功应返回 HTTP 200，响应体为 `{ success: true, task_id, status: 'blocked' }`。

**触发条件**：任务存在，`blockTask` mock 返回成功。

**期望结果**：
- HTTP 状态码：200
- 响应体：`{ success: true, task_id: <id>, status: 'blocked' }`

**对应测试**：`tasks-unblock.test.js` → `POST /:id/block — 成功时返回 200`

---

### [BEHAVIOR-03] import 路径错误时路由必须 500（Red 验证）

**描述**：在路径修复之前（`'./task-updater.js'` 仍错误），`POST /api/brain/tasks/:id/unblock` 因 `Cannot find module` 必须返回 500，验证 failing test 真正复现了 bug。

**触发条件**：`tasks.js` 保持原始错误路径，测试 mock `'../../task-updater.js'`（正确路径），但路由内 import 指向 `'./task-updater.js'`（不存在）。

**期望结果**：
- Red commit 阶段：测试 FAIL（路由抛出模块加载错误）
- Green commit 阶段：测试 PASS

**对应测试**：`tasks-unblock.test.js` — Red commit 时必须 FAIL，Green commit 后 PASS

---

### [BEHAVIOR-04] 既有 tasks 路由测试无回归

**描述**：修复 import 路径后，既有全套 tasks 路由测试必须全部通过，证明路径修复不引入任何回归。

**触发条件**：`pnpm vitest run` 运行 `tasks.test.js`、`task-tasks.test.js`、`tasks-canceled-transition.test.js`、`tasks-result-backfill.test.js`。

**期望结果**：
- 全部测试 PASS，0 FAIL，0 ERROR
- vitest 输出包含这 4 个文件均绿

**对应测试**：上述 4 个既有测试文件

---

### [BEHAVIOR-05] diff scope 最小化（只改路径字符串）

**描述**：最终合并到 main 的 diff 中，`packages/brain/src/routes/tasks.js` 的变更只包含 3 行 import 路径字符串替换，不包含任何其他修改。

**触发条件**：PR merged 后 git diff 检查。

**期望结果**：
- `git diff` 中 `tasks.js` 仅有 3 处 `-` 行含 `'./task-updater.js'`，对应 3 处 `+` 行含 `'../task-updater.js'`
- 无其他变更行

**对应测试**：manual:bash 验证（见下方）

---

## manual:bash 验证命令

```bash
# 1. 确认 task-updater.js 只存在于 src/ 根（不在 routes/ 下）
ls /workspace/packages/brain/src/task-updater.js && \
  ! ls /workspace/packages/brain/src/routes/task-updater.js 2>/dev/null && \
  echo "INV-01 PASS: task-updater.js 位置正确"

# 2. 确认 tasks.js 三处 import 已全部修复
grep -n "import.*task-updater" /workspace/packages/brain/src/routes/tasks.js | \
  grep -v "../task-updater" && echo "FAIL: 仍有错误路径" || echo "BEHAVIOR-01/02 PASS: 所有 import 路径已修正"

# 3. 运行新增 regression test（期望全绿）
cd /workspace/packages/brain && \
  pnpm vitest run src/routes/__tests__/tasks-unblock.test.js

# 4. 运行全套 brain 测试（无回归）
cd /workspace/packages/brain && pnpm test

# 5. 验证 diff scope 最小化（在 green commit 之后执行）
git diff HEAD~1..HEAD -- packages/brain/src/routes/tasks.js | \
  grep "^[+-]" | grep -v "^---\|^+++" | \
  grep -v "task-updater" && echo "FAIL: diff 包含非路径变更" || echo "BEHAVIOR-05 PASS: diff scope 最小"
```

---

## DoD 检查清单

| # | DoD 条目 | 验证方式 | 状态 |
|---|----------|----------|------|
| D1 | `[failing-test]` commit 存在，CI 可见 FAIL | `git log --oneline \| grep failing-test` | - |
| D2 | `[fix]` commit 后 `tasks-unblock.test.js` 全绿 | vitest 输出 PASS | - |
| D3 | 既有 4 个 tasks 测试套件全绿（无回归） | `pnpm test` 全绿 | - |
| D4 | CI brain-ci.yml 全绿 | GitHub Actions green | - |
| D5 | diff 只含 3 行路径变更 | manual:bash 命令 5 | - |
| D6 | `tasks-unblock.test.js` 已进 CI（不可删） | 文件存在于 `routes/__tests__/` | - |

---

## 对应文件

- **修改目标**：`packages/brain/src/routes/tasks.js`（第 600、1119、1147 行）
- **新增测试**：`packages/brain/src/routes/__tests__/tasks-unblock.test.js`
- **CI 配置**：`.github/workflows/brain-ci.yml`（已覆盖 routes/__tests__/，无需改动）
