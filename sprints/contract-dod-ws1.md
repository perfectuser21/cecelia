# Contract DoD — Workstream 1: `/api/brain/time` 路由 + `createApp()` 工厂 + server.js 挂载

**范围**: 新建 `packages/brain/src/routes/time.js` + 新建 `packages/brain/src/app.js`（具名导出 `createApp`，无副作用）+ `packages/brain/server.js` 改用 `createApp()`
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 文件存在且非空
  Test: node -e "const fs=require('fs'),p='packages/brain/src/routes/time.js';if(!fs.existsSync(p))process.exit(1);if(fs.readFileSync(p,'utf8').trim().length===0)process.exit(2)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 默认导出 Express Router（源码包含 `export default` 并 new 出一个 Router）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\s+default\s+\w+/.test(c))process.exit(1);if(!/Router\s*\(/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 注册 GET 根路径处理器（`router.get('/'` 或等价）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\s*\(\s*['\"]\/['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/app.js` 文件存在且具名导出 `createApp` 函数
  Test: node -e "const fs=require('fs'),p='packages/brain/src/app.js';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!/export\s+(function\s+createApp|(?:const|let)\s+createApp\s*=|\{[^}]*\bcreateApp\b[^}]*\})/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `packages/brain/src/app.js` 内部挂载 `/api/brain/time` 路由（字面量出现）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/app.js','utf8');if(!c.includes('/api/brain/time'))process.exit(1);if(!/app\.use\s*\(/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `packages/brain/src/app.js` import 了 time 路由模块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/app.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/app.js` 纯构造无副作用（**不得**出现 `app.listen(` / `pool.connect(` / `initTickLoop(` / `runSelfCheck(` / `runMigrations(` 等启动副作用字面量）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/app.js','utf8');const banned=['app.listen(','initTickLoop(','runSelfCheck(','runMigrations(','createServer('];for(const t of banned){if(c.includes(t)){console.error('forbidden token in app.js:',t);process.exit(1)}}"

- [ ] [ARTIFACT] `packages/brain/server.js` 从 `./src/app.js` 引入 `createApp`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\{[^}]*\bcreateApp\b[^}]*\}\s+from\s+['\"]\.\/src\/app\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 调用 `createApp()` 获取 app 实例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/createApp\s*\(\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 顶层不再直接 `const app = express()`（防止双 app 源）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(/\bconst\s+app\s*=\s*express\s*\(\s*\)/.test(c)){console.error('server.js 仍直接 new express() — 必须通过 createApp() 获取');process.exit(1)}"

## BEHAVIOR 索引（实际测试在 `sprints/tests/ws1/`）

见 `sprints/tests/ws1/time-endpoint.test.ts`，覆盖（全部通过 `supertest(createApp())` 调用，禁止 fetch 到外部端口）：

- responds 200 with application/json content-type
- returns exactly three keys: iso, timezone, unix
- iso field matches strict ISO-8601 regex with T separator and timezone suffix
- timezone field is a non-empty string
- unix field is an integer seconds timestamp within plausible window
- iso and unix timestamps agree within 2 seconds
- is idempotent: two sequential calls both return 200 with identical shape and timezone
