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

- [ ] [ARTIFACT] `HarnessPipelineDetailPage.tsx` 使用 `EventSource` API（含字面量）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('EventSource'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] EventSource URL 使用 query 参数名字面量 `planner_task_id`
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('planner_task_id'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] JSX 含 `data-testid="sse-log"` 属性的日志容器元素
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('data-testid=\"sse-log\"'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `useEffect` cleanup 含 `es.close()`
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('.close()'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] EventSource 连接 URL 含 `planner_task_id=` query 参数
- [ ] [BEHAVIOR] `[data-testid="sse-log"]` 日志区在 pipeline 详情页可见
- [ ] [BEHAVIOR] node_update 事件后日志区含节点 label 文本（Proposer + Generator）
- [ ] [BEHAVIOR] event: done 后页面含"Pipeline 已完成"文本
- [ ] [BEHAVIOR] done.verdict="PASS" 时页面渲染"PASS"文本
