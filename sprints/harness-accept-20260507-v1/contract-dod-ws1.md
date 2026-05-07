---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: harness-health endpoint 实现 + 注册

**范围**:
- 新建 `packages/brain/src/routes/harness-health.js` 暴露 Express Router（含 `GET /health` 处理函数）。
- 修改 `packages/brain/server.js` import + mount 新 Router 到 `/api/brain/harness` 前缀，且必须在既有 `harnessRoutes` 之前 mount，避免被 wildcard 拦截。

**大小**: S（< 100 行）

**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness-health.js` 文件存在，default export 是 Express Router 且注册了 `GET /health`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness-health.js','utf8'); if(!/export\s+default\s+router|export\s*{\s*router\s+as\s+default\s*}/.test(c))process.exit(1); if(!/router\.get\(['\\\"]\/health['\\\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 包含对 `./src/routes/harness-health.js` 的 import 语句
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8'); if(!/from\s+['\\\"]\.\/src\/routes\/harness-health\.js['\\\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 把新 Router 挂到 `/api/brain/harness` 前缀
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8'); const m=c.match(/app\.use\(['\\\"]\/api\/brain\/harness['\\\"]\s*,\s*(\w+)\)/g)||[]; if(m.length<2)process.exit(1)"

- [ ] [ARTIFACT] 新 Router 必须在既有 `harnessRoutes` mount 之前 mount（顺序保护，防 wildcard 拦截 `/health`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8'); const healthIdx=c.search(/app\.use\(['\\\"]\/api\/brain\/harness['\\\"]\s*,\s*harnessHealthRoutes/); const baseIdx=c.search(/app\.use\(['\\\"]\/api\/brain\/harness['\\\"]\s*,\s*harnessRoutes\)/); if(healthIdx<0||baseIdx<0||healthIdx>baseIdx)process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/harness-accept-20260507-v1/tests/ws1/harness-health.test.ts`，覆盖：
- GET /api/brain/harness/health 在正常路径返回 200 + JSON {langgraph_version:string, last_attempt_at:string|null, healthy:true}
- 三字段类型严格校验（不接受 number / 不接受 undefined）
- LangGraph 包元数据读取失败时降级 `langgraph_version === "unknown"`，HTTP 仍 200，healthy 仍 true
- DB 查询失败时 `last_attempt_at === null`，HTTP 仍 200，healthy 仍 true
