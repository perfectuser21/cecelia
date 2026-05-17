---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Dashboard HarnessPipelineDetailPage 实时日志区

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 新增实时日志区（EventSource，planner_task_id 参数，data-testid=realtime-log，data-testid=log-entry，完成状态文字）
**大小**: M
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 含 EventSource 构造，URL 含 planner_task_id 参数（禁用 initiative_id/taskId/task_id）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('EventSource'))process.exit(1);if(!c.includes('planner_task_id'))process.exit(1);if(c.includes('initiative_id=')|| c.includes('taskId=')|| c.includes('task_id='))process.exit(1)"

- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 含 data-testid="realtime-log" 实时日志区
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('realtime-log'))process.exit(1)"

- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 含 data-testid="log-entry" 节点行
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('log-entry'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] /pipeline/:id 页面渲染，data-testid=realtime-log 可见
  Test: manual:bash -c 'npx playwright test sprints/tests/ws2/harness-pipeline-detail-page.test.ts --grep "renders realtime log" 2>&1 | grep -q "passed" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] EventSource URL 含 planner_task_id 查询参数，不含禁用参数名 initiative_id/taskId/task_id
  Test: manual:bash -c 'npx playwright test sprints/tests/ws2/harness-pipeline-detail-page.test.ts --grep "uses planner_task_id" 2>&1 | grep -q "passed" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 收到 node_update 事件后日志区追加 data-testid=log-entry 节点行
  Test: manual:bash -c 'npx playwright test sprints/tests/ws2/harness-pipeline-detail-page.test.ts --grep "appends log-entry" 2>&1 | grep -q "passed" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] pipeline 完成后页面显示"Pipeline 已完成"或"Pipeline 失败"状态文字
  Test: manual:bash -c 'npx playwright test sprints/tests/ws2/harness-pipeline-detail-page.test.ts --grep "shows completion status" 2>&1 | grep -q "passed" && echo OK'
  期望: OK
