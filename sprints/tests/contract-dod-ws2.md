---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Dashboard 实时日志区

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 新增实时日志区 + EventSource hook：连接 `GET /api/brain/harness/stream?planner_task_id={id}`，渲染 node_update 列表（节点中文标签 + `ts` 时间），done 事件后显示"Pipeline 已完成 ✅"/"Pipeline 失败 ❌"，卸载时 close EventSource
**大小**: M (100-150 行)
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 含 `new EventSource(` 构造
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('new EventSource('))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 含实时日志区渲染（至少含节点标签或 ts 字段的 JSX 渲染）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.match(/\.label|\.ts\b|realtimeLogs|streamLogs|liveLog/))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] EventSource URL 使用合规 query param `planner_task_id`（不使用禁用名 id/taskId/task_id/pipeline_id/tid）
  Test: manual:bash -c 'SRC=$(cat apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx); echo "$SRC" | grep -q "planner_task_id" || { echo "FAIL: 未使用 planner_task_id query param"; exit 1; }; echo "$SRC" | grep -qE "EventSource\s*\([^)]*[?&](taskId|task_id|pipeline_id|tid)=" && { echo "FAIL: 使用了禁用 query param"; exit 1; } || true; echo "OK: query param 合规"'
  期望: exit 0

- [ ] [BEHAVIOR] 组件读取 SSE data 合规字段 `.node` 和 `.label`（不使用禁用字段名 `.nodeName`/`.name`）
  Test: manual:bash -c 'SRC=$(cat apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx); echo "$SRC" | grep -qE "\.node\b|data\.node|event\.node" || { echo "FAIL: 未使用 .node 字段"; exit 1; }; echo "$SRC" | grep -qE "\.label\b|data\.label" || { echo "FAIL: 未使用 .label 字段"; exit 1; }; echo "$SRC" | grep -qE "\.nodeName\b|data\.nodeName" && { echo "FAIL: 使用了禁用字段 .nodeName"; exit 1; } || true; echo "OK: 字段名合规"'
  期望: exit 0

- [ ] [BEHAVIOR] 组件处理 `done` 事件并显示"Pipeline 已完成 ✅"或"Pipeline 失败 ❌"完成状态文案
  Test: manual:bash -c 'SRC=$(cat apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx); echo "$SRC" | grep -qE "addEventListener\s*\(\s*['\''\""]done['\''\""]|type.*done|['\''\""]done['\''\""].*=>" || { echo "FAIL: 未处理 done 事件"; exit 1; }; echo "$SRC" | grep -qE "已完成|失败|Pipeline 已完成|Pipeline 失败" || { echo "FAIL: 未显示完成状态文案"; exit 1; }; echo "OK: done 事件处理 + 文案存在"'
  期望: exit 0

- [ ] [BEHAVIOR] 组件在卸载时调用 EventSource.close()（防内存泄漏）
  Test: manual:bash -c 'SRC=$(cat apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx); echo "$SRC" | grep -qE "\.close\(\)|es\.close|eventSource\.close|sse\.close|EventSource.*close" || { echo "FAIL: 未调用 EventSource.close() on unmount"; exit 1; }; echo "OK: close() 调用存在"'
  期望: exit 0

- [ ] [BEHAVIOR] 组件读取 SSE data 合规时间字段 `.ts`（不使用禁用字段名 `.timestamp`/`.time`）
  Test: manual:bash -c 'SRC=$(cat apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx); echo "$SRC" | grep -qE "\.ts\b|data\.ts\b|event\.ts\b" || { echo "FAIL: 未使用 .ts 时间字段"; exit 1; }; echo "$SRC" | grep -qE "data\.timestamp\b|\.timestamp\b" && { echo "FAIL: 使用了禁用字段 .timestamp"; exit 1; } || true; echo "OK: .ts 字段合规"'
  期望: exit 0
