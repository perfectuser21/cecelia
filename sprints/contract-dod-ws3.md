---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Dashboard HarnessStreamPage + 路由注册

**范围**: 新建 `apps/dashboard/src/pages/harness/HarnessStreamPage.tsx`；在 `apps/api/features/system-hub/index.ts` 新增 `/harness/:id` 路由
**大小**: M（120-150 行净增，2 文件）
**依赖**: Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness/HarnessStreamPage.tsx` 文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness/HarnessStreamPage.tsx')"

- [ ] [ARTIFACT] `apps/api/features/system-hub/index.ts` 新增 `/harness/:id` 路由指向 `HarnessStreamPage`
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/system-hub/index.ts','utf8');if(!c.includes('/harness/:id'))process.exit(1)"

- [ ] [ARTIFACT] `HarnessStreamPage.tsx` 使用 `useParams` 读取 `id`（initiative_id）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessStreamPage.tsx','utf8');if(!c.includes('useParams'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] TypeScript 编译 HarnessStreamPage.tsx 无类型错误
  Test: manual:bash -c 'cd /workspace && npx tsc --project apps/dashboard/tsconfig.json --noEmit 2>&1 | grep -i "HarnessStreamPage" | grep -i "error" && { echo "FAIL: TS 编译错误"; exit 1; }; echo "PASS: TS 编译通过"'
  期望: PASS: TS 编译通过

- [ ] [BEHAVIOR] `HarnessStreamPage.tsx` 使用原生 `EventSource` API 建立 SSE 连接
  Test: manual:bash -c 'FILE="apps/dashboard/src/pages/harness/HarnessStreamPage.tsx"; grep -q "new EventSource(" "$FILE" || grep -q "EventSource(" "$FILE" || { echo "FAIL: 未使用 EventSource"; exit 1; }; echo "PASS: 使用 EventSource"'
  期望: PASS: 使用 EventSource

- [ ] [BEHAVIOR] `HarnessStreamPage.tsx` 处理 `event: node_update` 更新节点状态
  Test: manual:bash -c 'FILE="apps/dashboard/src/pages/harness/HarnessStreamPage.tsx"; grep -q "node_update" "$FILE" || { echo "FAIL: 未处理 node_update 事件"; exit 1; }; echo "PASS: 处理 node_update"'
  期望: PASS: 处理 node_update

- [ ] [BEHAVIOR] `HarnessStreamPage.tsx` 处理 `event: done` 关闭 SSE 连接
  Test: manual:bash -c 'FILE="apps/dashboard/src/pages/harness/HarnessStreamPage.tsx"; grep -q "done" "$FILE" || { echo "FAIL: 未处理 done 事件"; exit 1; }; grep -q "close\(\)" "$FILE" || grep -q "\.close()" "$FILE" || grep -q "eventSource.close" "$FILE" || { echo "FAIL: 未在 done 时关闭连接"; exit 1; }; echo "PASS: 处理 done 并关闭"'
  期望: PASS: 处理 done 并关闭

- [ ] [BEHAVIOR] `/harness/:id` 路由注册在 `system-hub` routes 数组中（component 为 HarnessStreamPage）
  Test: manual:bash -c 'FILE="apps/api/features/system-hub/index.ts"; grep -q "harness" "$FILE" && grep -q "HarnessStreamPage" "$FILE" || { echo "FAIL: 路由未正确注册"; exit 1; }; echo "PASS: 路由注册正确"'
  期望: PASS: 路由注册正确

- [ ] [BEHAVIOR] `HarnessStreamPage.tsx` 构造 SSE 连接 URL 使用 `/api/brain/harness/pipeline/{id}/stream`（不使用禁用参数 planner_task_id）
  Test: manual:bash -c 'FILE="apps/dashboard/src/pages/harness/HarnessStreamPage.tsx"; grep -q "planner_task_id" "$FILE" && { echo "FAIL: 禁用参数 planner_task_id 出现"; exit 1; }; grep -q "harness/pipeline" "$FILE" || { echo "FAIL: SSE URL 路径不正确"; exit 1; }; echo "PASS: SSE URL 路径正确"'
  期望: PASS: SSE URL 路径正确
