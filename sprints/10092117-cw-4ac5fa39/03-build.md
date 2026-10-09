---
task_id: 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2d
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2"]
---
# 构建记录：GET /api/brain/tasks/:id 非法 id 返回 400

### B-1
- 对应：S-1
- 改动文件：`packages/brain/src/routes/task-tasks.js`
  - 常量区新增 `UUID_RE`（与 okr-hierarchy.js 写法一致）和 `INVALID_TASK_ID = { error: 'Invalid task id: must be a UUID' }`
  - `router.get('/:id')` 在进入 try 和查库之前先校验，非 UUID 直接返回 400，不回显 id
  - catch 中 `err.code === '22P02'` 时返回 400，不带 details；其余错误仍返回 500
  - `/:id/chain`、PATCH、DELETE 没有改
- 新增测试：`packages/brain/src/__tests__/task-get-invalid-id.test.js`（not-a-uuid → 400 且不查库；`%20` → 400 且不含 `for type uuid`；PG 抛 22P02 兜底 → 400 且没有 details）
- 修复前运行：`cd packages/brain && npx vitest run src/__tests__/task-get-invalid-id.test.js` → `Tests 3 failed | 3 passed (6)`。失败的 3 条是本条的 3 条：前两条收到的是 404（mock 返回空行），兜底条收到的是 500
- 修复后运行同一命令 → `Test Files 1 passed (1)`，`Tests 6 passed (6)`
- DevGate：`node scripts/facts-check.mjs` → `All facts consistent.`；`bash scripts/check-version-sync.sh` → `✅ All version files in sync`；`node packages/quality/scripts/devgate/check-dod-mapping.cjs` → `✅ 映射检查通过 (275 项)`
- 提交：`402bd3db7`

### B-2
- 对应：S-2
- 改动文件：
  - `packages/brain/src/__tests__/task-get-invalid-id.test.js`：新增合法 UUID 的用例：查不到 → 404 `Task not found`，查库 1 次且参数为该 UUID；查到 → 200 且 `body.id` 正确；大写 UUID 不返回 400。这些用例和 B-1 一起提交在 `402bd3db7` 中
  - `packages/brain/src/__tests__/routes/task-tasks.test.js`：`non-existent` 换成 `00000000-0000-4000-8000-000000000000`，`t1` 换成 `11111111-1111-4111-8111-111111111111`，断言没动
  - `packages/brain/src/__tests__/integration/brain-endpoint-contracts.test.js`：200 用例改用 `{ ...SAMPLE_TASK, id: '22222222-2222-4222-8222-222222222222' }`，没有改共享的 `SAMPLE_TASK.id`，因为 PATCH 用例还在用它；`nonexistent-id` 换成 `00000000-0000-4000-8000-000000000000`，断言没动
  - `task-tasks.js` 原有的 404 逻辑没改
- 改 id 前运行：
  - `npx vitest run src/__tests__/routes/task-tasks.test.js ...` → `Tests 2 failed | 25 passed (27)`，失败的是 GET /tasks/:id 的 2 条
  - `npx vitest run -c vitest.integration.config.js src/__tests__/integration/brain-endpoint-contracts.test.js` → `Tests 4 failed | 7 passed (11)`。其中 GET 2 条是预期失败。POST/PATCH 2 条是连带失败：GET 被 400 拦下后没有用掉 `mockResolvedValueOnce`，后面的用例读到了错位的 mock 值
- 说明：`brain-endpoint-contracts.test.js` 被默认的 `vitest.config.js` 排除（`src/__tests__/integration/**`），所以必须用 `-c vitest.integration.config.js` 运行。规格里写的单条命令按默认配置跑会报 "No test files found"
- 改 id 后运行：
  - `cd packages/brain && npx vitest run src/__tests__/task-get-invalid-id.test.js src/__tests__/routes/task-tasks.test.js` → `Test Files 2 passed (2)`，`Tests 33 passed (33)`
  - `cd packages/brain && npx vitest run -c vitest.integration.config.js src/__tests__/integration/brain-endpoint-contracts.test.js` → `Test Files 1 passed (1)`，`Tests 11 passed (11)`，原先连带失败的 POST/PATCH 也一起恢复
- 提交：`129d1d9f9`
