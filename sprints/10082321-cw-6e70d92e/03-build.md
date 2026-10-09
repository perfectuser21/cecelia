---
task_id: 6e70d92e-4cf1-4769-93af-28a345b9dc55
step: build
upstream: ["02-spec.md#S-1","02-spec.md#S-2","02-spec.md#S-3","02-spec.md#S-4"]
---
# 构建总结：new-task.mjs 批次自动挂 project

### B-1
- 对应：S-1
- 改动文件：`packages/brain/scripts/coding-workflow/new-task.mjs`（`validatePlan` 新增 `project_required` / `project_name_missing` / `project_conflict` 校验，返回 `projectId`、`project`；文件头注释补充 plan 顶层 `project_id` / `project` 写法）、`packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs`
- 新增测试：`it.each` 增加「有依赖但没挂 project → project_required」「project 缺 name → project_name_missing」「project_id 与 project 同时给 → project_conflict」（均断言 `brain.posts`、`brain.projectPosts` 为空）；「校验：返回 projectId / project」；「单条」用例加 `project_id` 未定义断言；原「批次」「中途 Brain 拒绝」用例计划顶层加 `project_id`。测试桩 `startBrain` 增加 `/api/brain/projects` 处理、`projectPosts`、`order` 到达顺序、`projectFail`。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/new-task.test.mjs`
  - 实现前：`Tests  4 failed | 10 passed (14)`（3 个新校验用例 + projectId/project 返回值用例失败）
  - 实现后：`Tests  14 passed (14)`
- 提交 SHA：`45aa51230`

### B-2
- 对应：S-2
- 改动文件：`new-task.mjs`（`main` 校验通过且非 dry-run 时，若有 `project` 先 `POST /api/brain/projects` 一次，`description` 缺省 `''`；失败输出 `建 project 失败：<回包JSON>` 退出 1 不建任务；`body(t, batch, ids, projectId)` 顶层加 `project_id`；抽出 `postJson` 复用请求逻辑）、`__tests__/new-task.test.mjs`
- 新增测试：「计划带 project：先建 project（只一次），整批任务顶层都挂它的 id」（断言 `projectPosts` 长度 1 且字段匹配、所有任务 `project_id === p0000000-...0001`、`order` 为 `['project','task','task']`）；「建 project 失败：退出非 0，stderr 说明，不建任何任务」；「--dry-run 带 project：不调 Brain」
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/new-task.test.mjs`
  - 实现前：`Tests  4 failed | 15 passed (19)`（S-2/S-3 的 4 个新用例失败）
  - 实现后：`Tests  19 passed (19)`
- 提交 SHA：`5200a78f9`

### B-3
- 对应：S-3
- 改动文件：同 B-2（计划给 `project_id` 时直接作为本批 project_id，不调 `/api/brain/projects`）
- 新增测试：「计划带 project_id：不建 project，每条任务顶层挂该 id，depends_on 仍换真实 id」；「单条计划带 project_id：请求体顶层同样带上」
- 测试命令与输出：同 B-2（实现前在 4 个失败用例中，实现后 `19 passed (19)`）
- 提交 SHA：`5200a78f9`（与 B-2 同一提交，实现共用同一段代码）

### B-4
- 对应：S-4
- 改动文件：无额外文件
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow`
  - 输出：`Test Files  27 passed (27)`，`Tests  500 passed (500)`
- `git diff --name-only a3a4c654c..HEAD` 仅：`packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs`、`packages/brain/scripts/coding-workflow/new-task.mjs`；工作区除 sprints 目录外无未提交改动
- 提交 SHA：无新提交（验证 `45aa51230`、`5200a78f9`）
