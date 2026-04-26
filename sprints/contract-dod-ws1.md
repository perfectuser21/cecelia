# Contract DoD — Workstream 1: build-info 端点实现 + 挂载

**范围**: 新增 `packages/brain/src/routes/build-info.js` 路由模块 + 在 `packages/brain/server.js` 注册挂载，提供 `GET /api/brain/build-info` 运行时身份指纹端点
**大小**: S（PRD 估 <100 行；实际新增约 30-50 行 + 2 行 server.js）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由文件 `packages/brain/src/routes/build-info.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/build-info.js')"

- [ ] [ARTIFACT] 路由文件从 `express` import Router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/import\s*\{[^}]*Router[^}]*\}\s*from\s*['\"]express['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路由文件 default export 一个 Router 实例（`export default router`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/export\s+default\s+\w+/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路由文件注册了 GET / handler
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/router\.get\s*\(\s*['\"]\/['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含 build-info 路由的 import 语句
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/build-info\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 在 `/api/brain/build-info` 挂载该路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/build-info['\"]\s*,/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `sprints/tests/ws1/build-info.test.ts`，覆盖：

- GET / 返回 200 + version/build_time/git_sha 三个非空字符串字段
- version 字段等于 `packages/brain/package.json` 的 `version`
- `process.env.GIT_SHA` 未设置时，`git_sha === "unknown"`
- `process.env.GIT_SHA` 设置后，`git_sha` 等于该值
- `build_time` 匹配 ISO-8601 UTC 格式
- `build_time` 在同一 router 实例的两次连续请求间严格相等
- handler 全程不调用数据库（mock pool.query 调用次数 = 0）
- `package.json` 读失败时返回 HTTP 500 + JSON body 含 `error` 字段
