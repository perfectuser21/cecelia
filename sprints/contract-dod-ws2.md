# Contract DoD — Workstream 2: 端点挂载到 /api/brain/health 前缀

**范围**: 修改 `packages/brain/server.js`，import Workstream 1 的 health router 并通过 `app.use('/api/brain/health', healthRouter)` 挂载。
**大小**: S
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/server.js` 含 import 语句从 `./src/routes/health.js` 引入 health router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/health\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含 `app.use('/api/brain/health'` 挂载语句（精确字符串匹配）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/health['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 挂载语句使用的是 ws1 中 import 进来的同一个标识符（防挂错路由）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');const im=c.match(/import\s+(\w+)\s+from\s+['\"]\.\/src\/routes\/health\.js['\"]/);if(!im)process.exit(1);const id=im[1];const re=new RegExp(\"app\\\\.use\\\\(\\\\s*['\\\"]\\\\/api\\\\/brain\\\\/health['\\\"]\\\\s*,\\\\s*\"+id+\"\\\\s*\\\\)\");if(!re.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/api-brain-mount.test.ts`，覆盖：
- GET /api/brain/health returns 200 with application/json content-type
- response body is a plain JSON object containing status, uptime_seconds, version
- ignores query string parameters and still returns 200 with status=ok
- GET /api/brain/health/extra-suffix does not collide with the contract
