---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Dashboard HarnessDetailPage /harness/:id

**范围**: `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx` 新建页面（含 EventSource 连接到 `/api/brain/harness/stream?initiative_id=:id`，实时日志区 data-testid=realtime-log，节点行 data-testid=log-entry，监听 run_completed 事件显示完成状态）+ router 注册 `/harness/:id`
**大小**: M
**依赖**: Workstream 2

## ARTIFACT 条目

- [ ] [ARTIFACT] apps/dashboard/src/pages/harness/HarnessDetailPage.tsx 存在，含 EventSource 构造
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('EventSource'))process.exit(1)"

- [ ] [ARTIFACT] HarnessDetailPage.tsx EventSource URL 含 initiative_id 参数（禁用 taskId/task_id/id/planner_task_id）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('initiative_id'))process.exit(1);if(/taskId=|task_id=|planner_task_id=/.test(c))process.exit(1)"

- [ ] [ARTIFACT] HarnessDetailPage.tsx 含 data-testid=\"realtime-log\" 和 data-testid=\"log-entry\"
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('realtime-log'))process.exit(1);if(!c.includes('log-entry'))process.exit(1)"

- [ ] [ARTIFACT] router 含 /harness/:id → HarnessDetailPage 路由注册
  Test: node -e "const files=['apps/dashboard/src/config/routes.tsx','apps/dashboard/src/App.tsx','apps/dashboard/src/router.tsx'];let found=false;for(const f of files){try{const c=require('fs').readFileSync(f,'utf8');if(c.includes('/harness/') && c.includes('HarnessDetailPage')){found=true;break;}}catch(e){}}if(!found)process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] EventSource URL schema 字段正确 — 使用 initiative_id 参数，值为路由 :id（禁用 taskId/task_id/id/planner_task_id）
  Test: manual:bash -c 'FILE=apps/dashboard/src/pages/harness/HarnessDetailPage.tsx; grep -q "initiative_id" "$FILE" && ! grep -qE "taskId=|task_id=|planner_task_id=" "$FILE" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] node_update keys 完整性 — 组件监听 node_update 事件，处理 node/status/ts 字段并追加 log-entry
  Test: manual:bash -c 'FILE=apps/dashboard/src/pages/harness/HarnessDetailPage.tsx; grep -q "node_update" "$FILE" && grep -q "log-entry" "$FILE" && grep -qE "\\.node|\\.status|\\.ts" "$FILE" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用事件名反向校验 — 不监听 done/finish/error 等 PRD 禁用事件名（须监听 run_completed）
  Test: manual:bash -c 'FILE=apps/dashboard/src/pages/harness/HarnessDetailPage.tsx; grep -q "run_completed" "$FILE" && ! grep -qE "addEventListener\s*\(\s*['"'"'\"](done|finish)['"'"'\"]" "$FILE" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] run_completed data 字段处理 — 组件读取 initiative_run_id/verdict 字段，显示 Pipeline 已完成 / Pipeline 失败
  Test: manual:bash -c 'FILE=apps/dashboard/src/pages/harness/HarnessDetailPage.tsx; grep -q "initiative_run_id" "$FILE" && grep -qE "Pipeline.*(已完成|失败)|已完成|失败" "$FILE" && echo OK'
  期望: OK
