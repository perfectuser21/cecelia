# Contract DoD — Workstream 2: Server Mount + Integration Smoke

**范围**: 在 `packages/brain/server.js` 的 `app.use('/api/brain', brainRoutes)` 之前注入 `app.use('/api/brain/health', healthRoutes)` 挂载，新增集成 smoke 测试。
**大小**: S
**依赖**: Workstream 1

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/server.js` 含 health 路由模块的 import 语句
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/health\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含 `app.use('/api/brain/health', ...)` 挂载行
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/health['\"]\s*,/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `app.use('/api/brain/health', ...)` 行出现在 `app.use('/api/brain', brainRoutes)` 之前
  Test: node -e "const lines=require('fs').readFileSync('packages/brain/server.js','utf8').split(/\\r?\\n/);let health=-1,brain=-1;for(let i=0;i<lines.length;i++){if(health<0&&/app\\.use\\(\\s*['\\\"]\\/api\\/brain\\/health['\\\"]/.test(lines[i]))health=i;if(brain<0&&/app\\.use\\(\\s*['\\\"]\\/api\\/brain['\\\"]\\s*,\\s*brainRoutes/.test(lines[i]))brain=i;}if(health<0||brain<0||health>=brain){console.error('health='+health+' brain='+brain);process.exit(1)}"

- [ ] [ARTIFACT] 集成测试文件 `packages/brain/src/__tests__/integration/health.integration.test.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/health.integration.test.js')"

- [ ] [ARTIFACT] 集成测试文件含至少 3 个 `it(` 块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/health.integration.test.js','utf8');const m=c.match(/\\bit\\s*\\(/g)||[];if(m.length<3)process.exit(1)"

---

## BEHAVIOR 索引（实际测试在 sprints/tests/ws2/）

见 `sprints/tests/ws2/health-integration.test.ts`，覆盖：
- GET /api/brain/health returns 200 with status/uptime_seconds/version fields
- version field equals packages/brain/package.json version field
- POST /api/brain/health returns 404 or 405, never 200 or 5xx
- PUT /api/brain/health returns 404 or 405, never 200 or 5xx
- DELETE /api/brain/health returns 404 or 405, never 200 or 5xx
- uptime_seconds strictly increases between two sequential requests with 150ms gap
