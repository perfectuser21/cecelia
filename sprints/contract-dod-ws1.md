# Contract DoD — Workstream 1: 时间查询路由模块 + Server 挂载 + 集成测试

**范围**: 新增 `packages/brain/src/routes/time.js`（三端点实现）+ `packages/brain/server.js` 挂载 + 集成测试 `packages/brain/src/__tests__/routes/time-routes.test.js`
**大小**: S（<100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 通过 `export default` 导出 express Router（源码含 `export default router` 或等价形式）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\s+default\s+router/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 从 express 导入 Router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/import\s*\{[^}]*Router[^}]*\}\s*from\s*['\"]express['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 注册 GET /iso 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/iso['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 注册 GET /unix 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/unix['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 注册 GET /timezone 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/timezone['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 的 /timezone handler 含显式错误分支（try/catch 或 400 状态码常量）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!(/\btry\s*\{/.test(c) && /\bcatch\s*\(/.test(c)) && !/status\(\s*400\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 导入 time 路由模块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/from\s*['\"]\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 在 `/api/brain/time` 前缀挂载 time 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/time['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 集成测试文件 `packages/brain/src/__tests__/routes/time-routes.test.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/routes/time-routes.test.js')"

- [ ] [ARTIFACT] 集成测试文件含 >= 15 个 `it(` 调用（对应合同 BEHAVIOR 覆盖）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/routes/time-routes.test.js','utf8');const n=(c.match(/\bit\(/g)||[]).length;if(n<15)process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/time-routes.test.ts`，覆盖：
- GET /iso: HTTP 200 / body.iso 为字符串 / Date.parse 可解析 / 与服务器时间偏差 <10 秒 / 以 Z 结尾
- GET /unix: HTTP 200 / body.unix 为数字 / Number.isInteger 真 / 与当前 Unix 时间偏差 ≤5 秒
- GET /timezone 合法：HTTP 200 / body.tz 回显 / Asia/Shanghai iso 以 +08:00 结尾 / iso 可解析且时间接近 / America/New_York 偏移为 -04:00 或 -05:00
- GET /timezone 错误：非法 tz → 400 且 body.error 非空 / 缺失 tz → 400 且 error 提及 tz / 非法请求不使 Brain 崩溃（后续 /iso 仍 200）
