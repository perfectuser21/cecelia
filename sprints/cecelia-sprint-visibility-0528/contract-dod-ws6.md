---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 6: Messages API + thread_lookup status 生命周期

**范围**: packages/brain/src/routes/harness.js 新增 GET/POST /messages/:initiativeId/:subTaskId；packages/brain/src/lib/harness-thread-lookup.js 新增导出 updateHarnessThreadStatus
**大小**: S（~70 行净增，2 文件）
**依赖**: harness_messages 表（WS1 migration PR #3162）；表未就绪时端点优雅降级（GET→[]，POST→503）

## ARTIFACT 条目

- [x] [ARTIFACT] routes/harness.js 含 /messages/ 路由（GET + POST）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes(\"router.get('/messages/:initiativeId/:subTaskId'\"))process.exit(1);if(!c.includes(\"router.post('/messages/:initiativeId/:subTaskId'\"))process.exit(1)"

- [x] [ARTIFACT] harness-thread-lookup.js 导出 updateHarnessThreadStatus
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/harness-thread-lookup.js','utf8');if(!c.includes('export async function updateHarnessThreadStatus'))process.exit(1)"

- [x] [ARTIFACT] harness 路由已挂载到 Brain server（routes.js → /harness）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes.js','utf8');if(!c.includes(\"router.use('/harness', harnessRouter)\"))process.exit(1)"

## BEHAVIOR 条目（实跑 sprint test 验证，harness-v5-checks 起真实 Brain）

- [x] [BEHAVIOR] GET 不存在 initiativeId 返 200 + {messages: []}
  Test: tests/ws6/messages-api.test.ts

- [x] [BEHAVIOR] GET 响应无禁用字段（data/items/results/payload/list）
  Test: tests/ws6/messages-api.test.ts

- [x] [BEHAVIOR] POST 返 201 + {id, message, created_at}（表就绪时）
  Test: tests/ws6/messages-api.test.ts

- [x] [BEHAVIOR] POST 响应无禁用字段（data/result/payload/body）
  Test: tests/ws6/messages-api.test.ts

- [x] [BEHAVIOR] POST 缺 message 字段返回 4xx
  Test: tests/ws6/messages-api.test.ts

- [x] [BEHAVIOR] POST 后 GET 能读回消息，consumed_at = null
  Test: tests/ws6/messages-api.test.ts
