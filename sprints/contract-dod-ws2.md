---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: 前端 EventSource 实时日志区

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 新增 EventSource hook 连接 `/api/brain/harness/stream?planner_task_id={id}`；新增实时日志区（`data-testid="sse-log"`）；追加 node_update 日志行；done 事件后显示"Pipeline 已完成 ✅ PASS"或"Pipeline 失败 ❌ FAIL"（含 verdict 文本）
**大小**: M（80-120 行净增，1 文件）
**依赖**: Workstream 1（Backend SSE 端点存在）

## Risks

| # | 风险 | 触发条件 | 缓解 |
|---|---|---|---|
| R1 | Vite proxy 未路由 SSE 路径 → EventSource 握手被截断 | `vite.config.ts` proxy 未含 `/api/brain/harness/stream` | Generator 实现时确认 proxy；CI E2E 直连 localhost:5221 |
| R2 | 旧浏览器无 EventSource 原生支持 → 日志区空白无提示 | IE / 旧版 Safari | CI 用 Chromium；可接受 |
| R3 | SSE 断连后 EventSource 自动重连累积请求 | 网络抖动 | 前端重连加 5s debounce；`useEffect` cleanup 时 `es.close()` |
| R4 | done 事件 verdict=null 时 UI 显示异常 | pipeline 无 evaluator 环节 | UI 应判断 `verdict ?? "—"` 安全渲染，CI mock 覆盖 null 分支 |

## ARTIFACT 条目

- [ ] [ARTIFACT] `HarnessPipelineDetailPage.tsx` 使用 `EventSource` API（含字面量）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('EventSource'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] EventSource URL 使用 query 参数名字面量 `planner_task_id`（不含禁用名 id/taskId/task_id/pipeline_id/tid）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('planner_task_id'))process.exit(1);if(/[\"']id[\"']|taskId|[?&]task_id[^_]|pipeline_id|[\"']tid[\"']/.test(c.slice(c.indexOf('EventSource'))))process.exit(2);console.log('OK')"

- [ ] [ARTIFACT] JSX 含 `data-testid="sse-log"` 属性的日志容器元素
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('data-testid=\"sse-log\"'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `useEffect` cleanup 含 `es.close()` 或等效方式防止 SSE 断连 cascade（对应 R3）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('.close()'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] EventSource 连接 URL 含 `planner_task_id=` query 参数（Playwright 路由拦截验证，禁用 id/taskId 等）
  Test: manual:bash -c 'lsof -i:5211 2>/dev/null | grep -q LISTEN || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && npx playwright test /workspace/sprints/tests/ws2/sse-ui.spec.ts --grep "EventSource URL" --project=chromium --base-url http://localhost:5211 --timeout=60000 2>&1 && echo OK'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] `[data-testid="sse-log"]` 日志区在 pipeline 详情页可见（toBeVisible，SSE mock 注入后）
  Test: manual:bash -c 'lsof -i:5211 2>/dev/null | grep -q LISTEN || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && npx playwright test /workspace/sprints/tests/ws2/sse-ui.spec.ts --grep "SSE 日志区可见" --project=chromium --base-url http://localhost:5211 --timeout=60000 2>&1 && echo OK'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] node_update 事件追加日志行，日志区含节点 label 文本（toContainText "Proposer" + "Generator"）
  Test: manual:bash -c 'lsof -i:5211 2>/dev/null | grep -q LISTEN || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && npx playwright test /workspace/sprints/tests/ws2/sse-ui.spec.ts --grep "日志行含节点" --project=chromium --base-url http://localhost:5211 --timeout=60000 2>&1 && echo OK'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] event: done 后页面含"Pipeline 已完成"文本（toBeVisible + toContainText，非仅 navigate）
  Test: manual:bash -c 'lsof -i:5211 2>/dev/null | grep -q LISTEN || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && npx playwright test /workspace/sprints/tests/ws2/sse-ui.spec.ts --grep "完成消息" --project=chromium --base-url http://localhost:5211 --timeout=60000 2>&1 && echo OK'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] done.verdict="PASS" 时页面渲染"PASS"文本（toBeVisible，对应 Playwright mock 注入的 verdict 字段）
  Test: manual:bash -c 'lsof -i:5211 2>/dev/null | grep -q LISTEN || (cd /workspace/apps/dashboard && npm run dev -- --port 5211 > /tmp/dash.log 2>&1 & sleep 10); cd /workspace && npx playwright test /workspace/sprints/tests/ws2/sse-ui.spec.ts --grep "verdict 显示" --project=chromium --base-url http://localhost:5211 --timeout=60000 2>&1 && echo OK'
  期望: OK (exit 0)
