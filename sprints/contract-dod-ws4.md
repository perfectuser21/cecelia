---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Dashboard HarnessDetailPage /harness/:id

**范围**: `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx` 新建页面（含 EventSource 连接到 /api/brain/harness/stream?initiative_id=:id，实时日志区 data-testid=realtime-log，节点行 data-testid=log-entry，完成状态文字）+ router 注册 /harness/:id
**大小**: M
**依赖**: Workstream 2

## ARTIFACT 条目

- [ ] [ARTIFACT] apps/dashboard/src/pages/harness/HarnessDetailPage.tsx 存在，含 EventSource 构造
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('EventSource'))process.exit(1)"

- [ ] [ARTIFACT] HarnessDetailPage.tsx EventSource URL 含 initiative_id 参数（禁用 taskId/task_id/id/planner_task_id）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('initiative_id'))process.exit(1);if(c.includes('taskId=') || c.includes('task_id=') || c.includes('planner_task_id='))process.exit(1)"

- [ ] [ARTIFACT] HarnessDetailPage.tsx 含 data-testid=\"realtime-log\" 和 data-testid=\"log-entry\"
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('realtime-log'))process.exit(1);if(!c.includes('log-entry'))process.exit(1)"

- [ ] [ARTIFACT] router 含 /harness/:id → HarnessDetailPage 路由注册
  Test: node -e "const files=['apps/dashboard/src/config/routes.tsx','apps/dashboard/src/App.tsx','apps/dashboard/src/router.tsx'];let found=false;for(const f of files){try{const c=require('fs').readFileSync(f,'utf8');if(c.includes('/harness/') && c.includes('HarnessDetailPage')){found=true;break;}}catch(e){}}if(!found)process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] /harness/:id 页面渲染，data-testid=realtime-log 可见
  Test: manual:bash -c 'npx playwright test sprints/tests/ws4/harness-detail-page.test.ts --grep "renders realtime-log" 2>&1 | grep -q "passed" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] EventSource URL 含 initiative_id 查询参数，不含禁用参数名 taskId/task_id/planner_task_id
  Test: manual:bash -c 'npx playwright test sprints/tests/ws4/harness-detail-page.test.ts --grep "uses initiative_id" 2>&1 | grep -q "passed" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 收到 node_update 事件后日志区追加 data-testid=log-entry 节点行
  Test: manual:bash -c 'npx playwright test sprints/tests/ws4/harness-detail-page.test.ts --grep "appends log-entry" 2>&1 | grep -q "passed" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] pipeline 完成后页面显示 "Pipeline 已完成" 或 "Pipeline 失败" 状态文字
  Test: manual:bash -c 'npx playwright test sprints/tests/ws4/harness-detail-page.test.ts --grep "shows completion" 2>&1 | grep -q "passed" && echo OK'
  期望: OK
