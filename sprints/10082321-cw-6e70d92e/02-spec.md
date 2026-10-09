---
task_id: 6e70d92e-4cf1-4769-93af-28a345b9dc55
step: spec
upstream: ["01-intent.md#I-1","01-intent.md#I-2","01-intent.md#I-3","01-intent.md#I-4"]
---
# 实现规格：new-task.mjs 批次自动挂 project

背景约束（来自代码）：
- `packages/brain/src/routes/task-tasks.js:242` 的 `assertProjectRootForMultiTask`：带 `payload.depends_on` 的任务，请求体顶层 `project_id` 必须指向 project 根，否则 400。
- `POST /api/brain/projects`（`packages/brain/src/routes/task-projects.js:22`）：`name` 必填，可带 `description`，成功返回 201 + 新行（含 `id`）。

### S-1
对应：I-1

改动文件：
- `packages/brain/scripts/coding-workflow/new-task.mjs`
- `packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs`

实现：
- `validatePlan(plan)` 在原有校验之外读取计划顶层 `project_id` 与 `project`：
  - 任一任务 `depends_on` 非空，且 `project_id` 不是非空字符串、`project` 也没给 → `errors` 追加 `project_required`。
  - `project` 给了但 `project.name` 不是非空字符串 → 追加 `project_name_missing`。
  - `project_id` 与 `project` 同时给 → 追加 `project_conflict`（避免歧义）。
  - 返回值新增 `projectId`（字符串或 null）与 `project`（`{name, description}` 或 null）。
- 校验失败沿用现有路径：stderr 打 `计划不合格：...`、退出码 2、不发任何请求（含 `--dry-run`）。
- 更新文件头注释：说明 plan 顶层可写 `project_id` 或 `project: {name, description?}`，有依赖时必须二选一。
- 现有用例「批次：按顺序创建…」「中途 Brain 拒绝…」带 depends_on，改为在计划顶层加 `project_id`，保持原断言通过。

验证：
- 新增 `it.each` 用例「有依赖但没挂 project → project_required，不调 Brain」：计划 `{ tasks: [{key:'a',...},{key:'b',...,depends_on:['a']}] }`，断言 `validatePlan(obj).errors` 含 `project_required`、`runScript` 退出码非 0、`stderr` 含 `project_required`、`brain.posts` 为空、`brain.projectPosts` 为空。
- 新增用例：`project` 缺 name → `project_name_missing`；同时给两者 → `project_conflict`（同样断言不调 Brain）。
- 单条无依赖、无 project 的计划仍成功且请求体不含 `project_id`（在原「单条」用例加 `expect(brain.posts[0].project_id).toBeUndefined()`）。
- 命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/new-task.test.mjs` 全部通过。

### S-2
对应：I-2

改动文件：
- `packages/brain/scripts/coding-workflow/new-task.mjs`
- `packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs`

实现：
- `main` 在校验通过、非 dry-run 时：若计划给了 `project`，先 `POST {BRAIN_URL}/api/brain/projects`，请求体 `{ name, description }`（description 缺省为 `''`），只调一次。
  - 返回非 2xx 或无 `id` → stderr 输出 `建 project 失败：<回包JSON>`，退出 1，不建任何任务。
  - 成功则以返回 `id` 作为本批 project_id。
- `body(t, batch, ids, projectId)`：`projectId` 非空时请求体顶层加 `project_id: projectId`（所有任务都挂，不只带依赖的）。
- 成功输出保持 `[{key,id,title}]` 数组不变；`--dry-run` 输出中附带 project 信息不作要求，但不得调 Brain。

测试桩改动：`startBrain` 同时处理 `POST /api/brain/projects`，记录到 `state.projectPosts`，返回 201 `{ id: 'p0000000-0000-4000-8000-000000000001', ... }`；可选 `projectFail` 使其返回 500。

验证（新增用例）：
- 计划 `{ project: { name: '大改X', description: '为什么' }, tasks: [a, b(depends_on a)] }` → 退出 0；`brain.projectPosts` 长度 1 且 `toMatchObject({ name: '大改X', description: '为什么' })`；`brain.posts.every(p => p.project_id === 'p0000000-0000-4000-8000-000000000001')` 为真；断言 project 请求先于第一条任务请求（桩里用统一递增序号记录到达顺序）。
- `projectFail` 时：退出非 0、stderr 含 `建 project 失败`、`brain.posts` 为空。
- 命令同 S-1。

### S-3
对应：I-3

改动文件：
- `packages/brain/scripts/coding-workflow/new-task.mjs`
- `packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs`

实现：计划给了 `project_id` 时直接用作本批 project_id，不调 `/api/brain/projects`；每条任务请求体顶层 `project_id` 等于该值。

验证（新增用例）：
- 计划 `{ project_id: '11111111-1111-4111-8111-111111111111', tasks: [a, b(depends_on a)] }` → 退出 0；`brain.projectPosts` 为空；`brain.posts` 长度 2 且每条 `project_id === '11111111-1111-4111-8111-111111111111'`；`payload.depends_on` 仍按原逻辑换成真实 id。
- 单条计划 `{ project_id: '...', title, acceptance }` 同样带上顶层 `project_id`。
- 命令同 S-1。

### S-4
对应：I-4

改动文件：无额外文件（仅 S-1~S-3 所列两个文件）。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow` 全部通过（含 runner/__tests__ 下用例，确认未引入回归；runner 侧不依赖 new-task.mjs 的输出格式变化，因输出格式保持不变）。
- `git diff --name-only` 只出现 `packages/brain/scripts/coding-workflow/new-task.mjs` 与 `packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs`（sprints 目录产物除外）。
