---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Dashboard 实时日志区

**范围**: 在 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 新增 EventSource hook + 实时日志区渲染
**大小**: M (100-150 行)
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 含 EventSource 构造（含 `new EventSource(` 字符串）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('new EventSource('))process.exit(1)"

- [ ] [ARTIFACT] EventSource URL 使用 `planner_task_id` query param（不用禁用名）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('planner_task_id'))process.exit(1)"

- [ ] [ARTIFACT] 组件处理 `event: done`（含 `onmessage`/`addEventListener('done'` 模式）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('done')&&!c.includes('onmessage'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] 组件文件 EventSource URL 使用 planner_task_id（非禁用参数名 task_id/taskId/id）
  Test: manual:bash -c '
    FILE="apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx"
    grep -q "planner_task_id" "$FILE" || { echo "FAIL: 未使用 planner_task_id"; exit 1; }
    grep -qE "EventSource.*[?&](taskId|task_id|pipeline_id|tid)=" "$FILE" \
      && { echo "FAIL: 使用了禁用 query param"; exit 1; } || true
  '
  期望: exit 0

- [ ] [BEHAVIOR] 组件文件中不含禁用字段名作为 SSE data 属性访问（nodeName/timestamp/name 等）
  Test: manual:bash -c '
    FILE="apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx"
    for BANNED in ".nodeName" ".timestamp" ".step" ".phase" ".stage"; do
      grep -q "$BANNED" "$FILE" && { echo "FAIL: 使用了禁用字段 $BANNED"; exit 1; } || true
    done
    echo "OK"
  '
  期望: exit 0

- [ ] [BEHAVIOR] TypeScript 编译通过，dashboard 无类型错误
  Test: manual:bash -c '
    cd apps/dashboard && npx tsc --noEmit --strict 2>&1 | head -20
    cd apps/dashboard && npx tsc --noEmit --strict
  '
  期望: exit 0

- [ ] [BEHAVIOR] 组件处理 node_update 事件，正确读取 .node/.label/.attempt/.ts 字段
  Test: manual:bash -c '
    FILE="apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx"
    grep -q "\.node\b\|\.label\b\|\.attempt\b\|\.ts\b" "$FILE" \
      || { echo "FAIL: 组件未读取 node/label/attempt/ts 字段"; exit 1; }
    echo "OK"
  '
  期望: exit 0

- [ ] [BEHAVIOR] 组件实现 done 事件处理，关闭 EventSource 并显示完成状态
  Test: manual:bash -c '
    FILE="apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx"
    grep -q "done\|close\(\)" "$FILE" \
      || { echo "FAIL: 未实现 done 事件处理"; exit 1; }
    grep -q "已完成\|失败\|completed\|failed" "$FILE" \
      || { echo "FAIL: 未显示 pipeline 完成状态"; exit 1; }
    echo "OK"
  '
  期望: exit 0

- [ ] [BEHAVIOR] EventSource 连接在组件卸载时正确关闭（useEffect cleanup）
  Test: manual:bash -c '
    FILE="apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx"
    grep -q "\.close()\|es\.close\|eventSource\.close" "$FILE" \
      || { echo "FAIL: 缺少 EventSource cleanup（内存泄漏）"; exit 1; }
    echo "OK"
  '
  期望: exit 0
