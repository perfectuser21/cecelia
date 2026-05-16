---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Dashboard HarnessRunPage + 路由注册

**范围**: 新建 `apps/dashboard/src/pages/harness/HarnessRunPage.tsx`（EventSource + 节点列表渲染）；在 `apps/dashboard/src/App.tsx` DynamicRouter 注册 `/harness/:id` 路由
**大小**: M（~180 行净增，2 文件）
**依赖**: Workstream 2 完成后（SSE 端点就绪）

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness/HarnessRunPage.tsx` 文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness/HarnessRunPage.tsx')"

- [ ] [ARTIFACT] `HarnessRunPage.tsx` 使用 `EventSource` 建立 SSE 连接
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessRunPage.tsx','utf8');if(!c.includes('EventSource'))process.exit(1)"

- [ ] [ARTIFACT] `HarnessRunPage.tsx` 连接 SSE 端点 URL 包含 `/api/brain/initiatives`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessRunPage.tsx','utf8');if(!c.includes('api/brain/initiatives'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/App.tsx` 包含 `/harness/:id` 路由注册
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('/harness/'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] HarnessRunPage.tsx 连接 SSE URL 严格包含 `/api/brain/initiatives/:id/events`（不使用禁用路径 /harness/pipeline）
  Test: manual:bash -c 'FILE="apps/dashboard/src/pages/harness/HarnessRunPage.tsx"; grep -q "api/brain/initiatives" "$FILE"||{echo "FAIL: SSE URL 不含 /api/brain/initiatives";exit 1;}; grep -q "harness/pipeline" "$FILE"&&{echo "FAIL: 使用了禁用路径 /harness/pipeline";exit 1;}; echo "PASS: SSE URL 路径正确"'
  期望: PASS: SSE URL 路径正确

- [ ] [BEHAVIOR] HarnessRunPage.tsx 处理 node_update 事件（schema 字段值匹配）
  Test: manual:bash -c 'FILE="apps/dashboard/src/pages/harness/HarnessRunPage.tsx"; grep -q "node_update" "$FILE"||{echo "FAIL: 未处理 node_update 事件";exit 1;}; grep -q "onmessage\|addEventListener\|\.data" "$FILE"||{echo "FAIL: 未提取 SSE data";exit 1;}; echo "PASS: node_update 事件处理存在"'
  期望: PASS: node_update 事件处理存在

- [ ] [BEHAVIOR] HarnessRunPage.tsx 不含禁用字段名（timestamp/agent/step/success/complete）作为数据字段引用
  Test: manual:bash -c 'FILE="apps/dashboard/src/pages/harness/HarnessRunPage.tsx"; for f in "\.timestamp" "\.agent" "data\.step" "status.*success" "status.*complete"; do grep -qE "$f" "$FILE"&&{echo "FAIL: 禁用字段引用 $f 存在";exit 1;};done; echo "PASS: 无禁用字段引用"'
  期望: PASS: 无禁用字段引用

- [ ] [BEHAVIOR] App.tsx DynamicRouter 注册了 /harness/:id 路由且指向 HarnessRunPage
  Test: manual:bash -c 'FILE="apps/dashboard/src/App.tsx"; grep -q "HarnessRunPage" "$FILE"||{echo "FAIL: App.tsx 未引用 HarnessRunPage";exit 1;}; grep -q "/harness/" "$FILE"||{echo "FAIL: App.tsx 未注册 /harness/:id 路由";exit 1;}; echo "PASS: 路由注册正确"'
  期望: PASS: 路由注册正确

- [ ] [BEHAVIOR] HarnessRunPage.tsx 渲染节点列表（node + status 字段用于显示）
  Test: manual:bash -c 'FILE="apps/dashboard/src/pages/harness/HarnessRunPage.tsx"; grep -q "\.node\b\|node\b" "$FILE"||{echo "FAIL: 未渲染 node 字段";exit 1;}; grep -q "\.status\b\|status\b" "$FILE"||{echo "FAIL: 未渲染 status 字段";exit 1;}; echo "PASS: 节点列表渲染存在"'
  期望: PASS: 节点列表渲染存在

- [ ] [BEHAVIOR] HarnessRunPage.tsx 在 cleanup 时关闭 EventSource 连接（useEffect return 或 onbeforeunload）
  Test: manual:bash -c 'FILE="apps/dashboard/src/pages/harness/HarnessRunPage.tsx"; grep -qE "\.close\(\)|eventSource\.close|es\.close|sse\.close" "$FILE"||{echo "FAIL: 未关闭 EventSource 连接";exit 1;}; echo "PASS: EventSource 关闭逻辑存在"'
  期望: PASS: EventSource 关闭逻辑存在
