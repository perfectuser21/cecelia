# Contract DoD — Workstream 1: F1 接任务（start-dev endpoint + Dashboard 按钮）

**范围**: 新增 `POST /api/brain/tasks/:id/start-dev` 路由 handler；Dashboard task 列表行加"开始开发"按钮（仅 status=pending 时渲染）。
**大小**: M
**依赖**: 无

**Round 2 修订**: 补 worktree 失败 try/catch ARTIFACT 检测。

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/tasks.js` 中已注册 `POST /tasks/:id/start-dev` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/tasks.js','utf8');if(!/router\.post\(\s*['\"]\/tasks\/:[a-zA-Z_]+\/start-dev['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/tasks/TaskPrdPage.tsx` 含 `data-testid="start-dev-button"`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/tasks/TaskPrdPage.tsx','utf8');if(!c.includes('data-testid=\"start-dev-button\"'))process.exit(1)"

- [ ] [ARTIFACT] start-dev handler 返回 200 + JSON 响应字段说明在源文件 JSDoc 中标注（worktree_path / branch）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/tasks.js','utf8');if(!/start-dev/.test(c)||!/worktree_path/.test(c)||!/branch/.test(c))process.exit(1)"

- [ ] [ARTIFACT] start-dev handler 区段含 try / catch（worktree 失败错误隔离结构，防止裸异常冒到 Express 默认 500）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/tasks.js','utf8');const m=c.match(/start-dev[\s\S]{0,2000}?\}\);/);if(!m)process.exit(1);const seg=m[0];if(!/\btry\s*\{/.test(seg)||!/\bcatch\s*\(/.test(seg))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/start-dev-route.test.ts`，覆盖：
- POST /tasks/:id/start-dev 路由已注册
- happy path: pending task → 200 + {worktree_path, branch} 字段非空，branch 以 cp- 开头
- happy path: task.status 由 pending 切到 in_progress
- 重复调用同一 task → 409 且不再调用 worktree 创建函数
- 非 pending 状态调用（completed）→ 409
- worktree 创建失败时不修改 task.status
- worktree 创建失败 → HTTP 500 且响应 body 不含未脱敏 stack（Round 2 新增）
