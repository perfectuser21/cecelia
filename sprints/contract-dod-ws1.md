# Contract DoD — Workstream 1: 新增 `/api/brain/time` 路由与挂载

**范围**: 新建 `packages/brain/src/routes/time.js`，在 `packages/brain/server.js` 挂载 `/api/brain/time`
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 文件存在且非空
  Test: node -e "const fs=require('fs'),p='packages/brain/src/routes/time.js';if(!fs.existsSync(p))process.exit(1);if(fs.readFileSync(p,'utf8').trim().length===0)process.exit(2)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 默认导出 Express Router（源码包含 `export default router` 或 `export default Router()` 模式）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\s+default\s+\w+/.test(c))process.exit(1);if(!/Router\s*\(/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 注册 GET 根路径处理器（`router.get('/'` 或等价）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\s*\(\s*['\"]\/['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 从 `./src/routes/time.js` 引入路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 通过 `app.use('/api/brain/time', ...)` 挂载新路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\s*\(\s*['\"]\/api\/brain\/time['\"]/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 `sprints/tests/ws1/`）

见 `sprints/tests/ws1/time-endpoint.test.ts`，覆盖：

- responds 200 with application/json content-type
- returns exactly three keys: iso, timezone, unix
- iso field is a parseable ISO-8601 string
- timezone field is a non-empty string
- unix field is an integer seconds timestamp
- iso and unix timestamps agree within 2 seconds
- is idempotent: two sequential calls both return 200 with same shape
