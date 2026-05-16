contract_branch: cp-harness-propose-r2-9d693319
workstream_index: 2
sprint_dir: sprints

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: 前端 EventSource 实时日志区

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 新增 EventSource hook 连接 `/api/brain/harness/stream?planner_task_id={id}`；新增实时日志区（`data-testid="sse-log"`）；追加 node_update 日志行；done 事件后显示"Pipeline 已完成 ✅ PASS"或"Pipeline 失败 ❌ FAIL"（含 verdict 文本）
**大小**: M（80-120 行净增，1 文件）
**依赖**: Workstream 1（Backend SSE 端点存在）

## ARTIFACT 条目

- [x] [ARTIFACT] `HarnessPipelineDetailPage.tsx` 使用 `EventSource` API（含字面量）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('EventSource'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] EventSource URL 使用 query 参数名字面量 `planner_task_id`（不含禁用名 id/taskId/task_id/pipeline_id/tid）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('planner_task_id'))process.exit(1);if(/[\"']id[\"']|taskId|[?&]task_id[^_]|pipeline_id|[\"']tid[\"']/.test(c.slice(c.indexOf('EventSource'))))process.exit(2);console.log('OK')"

- [x] [ARTIFACT] JSX 含 `data-testid="sse-log"` 属性的日志容器元素
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('data-testid=\"sse-log\"'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `useEffect` cleanup 含 `es.close()` 或等效方式防止 SSE 断连 cascade（对应 R3）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('.close()'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [x] [BEHAVIOR] EventSource 连接 URL 含 `planner_task_id=` query 参数（Playwright 路由拦截验证，禁用 id/taskId 等）
  Test: bash -c 'curl -sf http://localhost:5211/ > /dev/null 2>&1 || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && LD_LIBRARY_PATH=/tmp/arm64-libs/extracted:$LD_LIBRARY_PATH npx playwright test sprints/tests/ws2/sse-ui.spec.ts --grep "EventSource URL" --project=chromium --timeout=60000 2>&1'

- [x] [BEHAVIOR] `[data-testid="sse-log"]` 日志区在 pipeline 详情页可见（toBeVisible，SSE mock 注入后）
  Test: bash -c 'curl -sf http://localhost:5211/ > /dev/null 2>&1 || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && LD_LIBRARY_PATH=/tmp/arm64-libs/extracted:$LD_LIBRARY_PATH npx playwright test sprints/tests/ws2/sse-ui.spec.ts --grep "SSE 日志区可见" --project=chromium --timeout=60000 2>&1'

- [x] [BEHAVIOR] node_update 事件追加日志行，日志区含节点 label 文本（toContainText "Proposer" + "Generator"）
  Test: bash -c 'curl -sf http://localhost:5211/ > /dev/null 2>&1 || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && LD_LIBRARY_PATH=/tmp/arm64-libs/extracted:$LD_LIBRARY_PATH npx playwright test sprints/tests/ws2/sse-ui.spec.ts --grep "日志行含节点" --project=chromium --timeout=60000 2>&1'

- [x] [BEHAVIOR] event: done 后页面含"Pipeline 已完成"文本（toBeVisible + toContainText，非仅 navigate）
  Test: bash -c 'curl -sf http://localhost:5211/ > /dev/null 2>&1 || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && LD_LIBRARY_PATH=/tmp/arm64-libs/extracted:$LD_LIBRARY_PATH npx playwright test sprints/tests/ws2/sse-ui.spec.ts --grep "完成消息" --project=chromium --timeout=60000 2>&1'

- [x] [BEHAVIOR] done.verdict="PASS" 时页面渲染"PASS"文本（toBeVisible，对应 Playwright mock 注入的 verdict 字段）
  Test: bash -c 'curl -sf http://localhost:5211/ > /dev/null 2>&1 || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && LD_LIBRARY_PATH=/tmp/arm64-libs/extracted:$LD_LIBRARY_PATH npx playwright test sprints/tests/ws2/sse-ui.spec.ts --grep "verdict 显示" --project=chromium --timeout=60000 2>&1'
