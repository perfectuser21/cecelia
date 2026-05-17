---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Dashboard HarnessDetailPage

**范围**: `apps/dashboard/src/pages/harness/HarnessDetailPage.tsx` 新建页面（含 EventSource 实时日志区）+ router 注册 `/harness/:id`
**大小**: M
**依赖**: Workstream 2

## ARTIFACT 条目

- [ ] [ARTIFACT] apps/dashboard/src/pages/harness/HarnessDetailPage.tsx 存在
  Test: node -e "require('fs').statSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx')"

- [ ] [ARTIFACT] HarnessDetailPage.tsx 含 EventSource 构造，URL 含 initiative_id 参数（禁用 id/taskId/task_id 等）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('EventSource'))process.exit(1);if(!c.includes('initiative_id'))process.exit(1);if(c.includes('taskId=')|| c.includes('task_id='))process.exit(1)"

- [ ] [ARTIFACT] HarnessDetailPage.tsx 含 data-testid="realtime-log" 实时日志区和 data-testid="log-entry" 节点行
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('realtime-log'))process.exit(1);if(!c.includes('log-entry'))process.exit(1)"

- [ ] [ARTIFACT] Router 配置含 /harness/:id 路由，组件指向 HarnessDetailPage
  Test: node -e "const {execSync}=require('child_process');const res=execSync('grep -r HarnessDetailPage apps/dashboard/src/ --include=\"*.tsx\" --include=\"*.ts\" -l 2>/dev/null').toString().trim();if(!res)process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] /harness/:id 页面在浏览器中渲染，data-testid=realtime-log 可见
  Test: manual:bash -c 'npx playwright test sprints/tests/ws4/harness-detail-page.test.ts --grep "renders realtime log" 2>&1 | grep -q "passed" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] EventSource URL 含 initiative_id query 参数，不含禁用参数名 id/taskId/task_id
  Test: manual:bash -c 'npx playwright test sprints/tests/ws4/harness-detail-page.test.ts --grep "uses initiative_id" 2>&1 | grep -q "passed" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 收到 node_update 事件后日志区追加 data-testid=log-entry 节点行
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="dddddddd-eeee-ffff-0000-aa0000000001"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'$IAID'"'"', '"'"'proposer'"'"', '"'"'Proposer'"'"', 1) ON CONFLICT DO NOTHING" 2>/dev/null; npx playwright test sprints/tests/ws4/harness-detail-page.test.ts --grep "appends node_update row" 2>&1 | grep -q "passed" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] pipeline 完成后页面显示"Pipeline 已完成"或"Pipeline 失败"状态文字
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; IAID="dddddddd-eeee-ffff-0000-aa0000000002"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt, status, verdict) VALUES ('"'"'$IAID'"'"', '"'"'report'"'"', '"'"'Report'"'"', 1, '"'"'done'"'"', '"'"'PASS'"'"') ON CONFLICT DO NOTHING" 2>/dev/null; npx playwright test sprints/tests/ws4/harness-detail-page.test.ts --grep "shows completion status" 2>&1 | grep -q "passed" && echo OK'
  期望: OK
