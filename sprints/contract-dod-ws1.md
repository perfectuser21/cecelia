# Contract DoD — Workstream 1: build-info 路由实现 + server.js 挂载

**范围**: 新建 `packages/brain/src/routes/build-info.js`（Express Router）+ 在 `packages/brain/server.js` 挂载到 `/api/brain/build-info`
**大小**: S（< 100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/build-info.js')"

- [ ] [ARTIFACT] `build-info.js` 含 `import express` 与 `export default router`，且 router 由 `express.Router()` 构造
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/import\s+express\s+from\s+['\"]express['\"]/.test(c))process.exit(1);if(!/express\.Router\s*\(\s*\)/.test(c))process.exit(2);if(!/export\s+default\s+router/.test(c))process.exit(3)"

- [ ] [ARTIFACT] `build-info.js` 含 `try { ... } catch` 包裹 git SHA 读取，catch 分支显式赋值字符串 `'unknown'`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/git\s+rev-parse|rev-parse\s+HEAD/.test(c))process.exit(1);if(!/try\s*\{[\s\S]*?catch[\s\S]*?['\"]unknown['\"][\s\S]*?\}/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `build-info.js` 在模块顶层（非 handler 内）调用 `new Date().toISOString()` 生成 built_at 缓存
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');const m=c.match(/new\s+Date\s*\(\s*\)\s*\.toISOString\s*\(\s*\)/g)||[];if(m.length<1)process.exit(1);const handlerBody=c.match(/router\.get\s*\(\s*['\"]\/['\"]\s*,[\s\S]*?\}\s*\)\s*;?/);if(handlerBody&&/new\s+Date\s*\(\s*\)\s*\.toISOString/.test(handlerBody[0]))process.exit(2)"

- [ ] [ARTIFACT] `build-info.js` 含读取 `packages/brain/package.json` version 字段的代码
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/package\.json/.test(c))process.exit(1);if(!/\.version/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含 `import` 引入 build-info router 的语句
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/build-info\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含 `app.use('/api/brain/build-info', ...)` 挂载语句
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\s*\(\s*['\"]\/api\/brain\/build-info['\"]\s*,/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/build-info.test.js`，覆盖：
- GET /api/brain/build-info 返回 HTTP 200 + JSON 三字段（键集合严格等于 git_sha/package_version/built_at）
- built_at 是合法 ISO 8601（new Date(x).toISOString() === x）
- 连续两次请求 built_at 字段值完全相等（启动时缓存）
- package_version 严格等于 packages/brain/package.json 的 version 字段
- git rev-parse 抛异常时 git_sha 回退为字符串 'unknown' 且端点仍返回 200
