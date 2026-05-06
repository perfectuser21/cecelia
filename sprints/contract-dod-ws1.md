# Contract DoD — Workstream 1: F1 接任务（start-dev endpoint + Dashboard 按钮）

**范围**: 新增 `POST /api/brain/tasks/:id/start-dev` 路由 handler；Dashboard task 列表行加"开始开发"按钮（仅 status=pending 时渲染）。
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/tasks.js` 中已注册 `POST /tasks/:id/start-dev` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/tasks.js','utf8');if(!/router\.post\(\s*['\"]\/tasks\/:[a-zA-Z_]+\/start-dev['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/tasks/TaskPrdPage.tsx` 含 `data-testid="start-dev-button"`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/tasks/TaskPrdPage.tsx','utf8');if(!c.includes('data-testid=\"start-dev-button\"'))process.exit(1)"

- [ ] [ARTIFACT] start-dev handler 返回 200 + JSON 响应字段说明在源文件 JSDoc 中标注（worktree_path / branch）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/tasks.js','utf8');if(!/start-dev/.test(c)||!/worktree_path/.test(c)||!/branch/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/start-dev-route.test.ts`，覆盖：
- POST /tasks/:id/start-dev 路由已注册
- happy path: pending task → 200 + {worktree_path, branch} 字段非空，branch 以 cp- 开头
- happy path: task.status 由 pending 切到 in_progress
- 重复调用同一 task → 409 且不再调用 worktree 创建函数
- 非 pending 状态调用（in_progress/completed/failed）→ 409
- worktree 创建失败时不修改 task.status
