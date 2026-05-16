---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Dashboard HarnessStreamPage + 路由注册

**范围**: 新建 `apps/dashboard/src/pages/harness/HarnessStreamPage.tsx`；在 `apps/api/features/system-hub/index.ts` 新增 `/harness/:id` 路由
**大小**: M（120-150 行净增，2 文件）
**依赖**: Workstream 2 完成后

## ARTIFACT 条目

- [x] [ARTIFACT] `apps/dashboard/src/pages/harness/HarnessStreamPage.tsx` 文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness/HarnessStreamPage.tsx')"

- [x] [ARTIFACT] `apps/api/features/system-hub/index.ts` 新增 `/harness/:id` 路由指向 `HarnessStreamPage`
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/system-hub/index.ts','utf8');if(!c.includes('/harness/:id'))process.exit(1)"

- [x] [ARTIFACT] `HarnessStreamPage.tsx` 使用 `useParams` 读取 `id`（initiative_id）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessStreamPage.tsx','utf8');if(!c.includes('useParams'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] TypeScript 编译 HarnessStreamPage.tsx 无类型错误
  Test: manual:bash -c 'cd /workspace && npx tsc --project apps/dashboard/tsconfig.json --noEmit > /tmp/tsc-ws3.txt 2>&1; node -e "require(\"fs\").readFileSync(\"/tmp/tsc-ws3.txt\",\"utf8\").split(\"\\n\").filter(function(l){return l.toLowerCase().indexOf(\"harnessstreampage\")>=0&&l.toLowerCase().indexOf(\"error\")>=0}).length&&process.exit(1)||process.stdout.write(\"PASS: TS 编译通过\\n\")"'
  期望: PASS: TS 编译通过

- [x] [BEHAVIOR] `HarnessStreamPage.tsx` 使用原生 `EventSource` API 建立 SSE 连接
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/harness/HarnessStreamPage.tsx\",\"utf8\");if(!c.includes(\"new EventSource(\")&&!c.includes(\"EventSource(\"))process.exit(1);console.log(\"PASS: 使用 EventSource\")"'
  期望: PASS: 使用 EventSource

- [x] [BEHAVIOR] `HarnessStreamPage.tsx` 处理 `event: node_update` 更新节点状态
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/harness/HarnessStreamPage.tsx\",\"utf8\");if(!c.includes(\"node_update\"))process.exit(1);console.log(\"PASS: 处理 node_update\")"'
  期望: PASS: 处理 node_update

- [x] [BEHAVIOR] `HarnessStreamPage.tsx` 处理 `event: done` 关闭 SSE 连接
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/harness/HarnessStreamPage.tsx\",\"utf8\");if(!c.includes(\"done\"))process.exit(1);if(!c.includes(\".close()\")&&!c.includes(\"eventSource.close\"))process.exit(1);console.log(\"PASS: 处理 done 并关闭\")"'
  期望: PASS: 处理 done 并关闭

- [x] [BEHAVIOR] `/harness/:id` 路由注册在 `system-hub` routes 数组中（component 为 HarnessStreamPage）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/features/system-hub/index.ts\",\"utf8\");if(!c.includes(\"harness\")||!c.includes(\"HarnessStreamPage\"))process.exit(1);console.log(\"PASS: 路由注册正确\")"'
  期望: PASS: 路由注册正确

- [x] [BEHAVIOR] `HarnessStreamPage.tsx` 构造 SSE 连接 URL 使用 `/api/brain/harness/pipeline/{id}/stream`（不使用禁用参数 planner_task_id）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/harness/HarnessStreamPage.tsx\",\"utf8\");if(c.includes(\"planner_task_id\"))process.exit(1);if(!c.includes(\"harness/pipeline\"))process.exit(1);console.log(\"PASS: SSE URL 路径正确\")"'
  期望: PASS: SSE URL 路径正确
