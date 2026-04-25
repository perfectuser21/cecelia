# Contract DoD — Workstream 2: HTTP 端点注册到 Brain Server

**范围**: 修改 `packages/brain/server.js`，import WS1 的 health router 并用 `app.use('/api/brain/health', healthRouter)` 注册
**大小**: S（server.js 改动 <10 行）
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/server.js` 从 `./src/health.js` import 模块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/from\s*['\"]\.\/src\/health\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 注册 `/api/brain/health` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.(use|get)\s*\(\s*['\"]\/api\/brain\/health['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 的 `/api/brain/health` 注册使用 WS1 导入的 router 变量（而非 inline 逻辑）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');const m=c.match(/import\s+(\w+)\s+from\s*['\"]\.\/src\/health\.js['\"]/);if(!m)process.exit(1);const name=m[1];const re=new RegExp('app\\\\.(use|get)\\\\s*\\\\(\\\\s*[\\'\"]\\\\/api\\\\/brain\\\\/health[\\'\"]\\\\s*,[^)]*\\\\b'+name+'\\\\b');if(!re.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws2/）

见 `sprints/tests/ws2/health-endpoint.test.ts`，覆盖 7 个 `it()`：
- GET /api/brain/health 返回 HTTP 200
- GET /api/brain/health 响应 Content-Type 含 application/json
- GET /api/brain/health 响应 body 键集合严格等于 {status, uptime_seconds, version}
- GET /api/brain/health 响应 body.status 严格等于 "ok"
- GET /api/brain/health 响应 body.version 严格等于 package.json 的 version
- GET /api/brain/health 响应 body.uptime_seconds 是非负 number
- GET /api/brain/health 5 个并发请求全部返回 200 且 body schema 正确
