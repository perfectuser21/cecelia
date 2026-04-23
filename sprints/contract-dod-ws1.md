# Contract DoD — Workstream 1: GET /api/brain/time 路由 + 注册 + 文档

**范围**: 新增 `packages/brain/src/routes/time.js` handler；在 `packages/brain/server.js` 注册；在 `docs/current/SYSTEM_MAP.md` 追加路由条目。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由 handler 文件 `packages/brain/src/routes/time.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 注册 `router.get('/time'` handler（含 `/time` 字面量 + get 方法）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/time['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 以 `export default router` 形式导出 Router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\s+default\s+router\s*;?/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 引入 time 路由模块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+timeRoutes\s+from\s+['\"]\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 将 time 路由挂载到 `/api/brain` 前缀下
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain['\"]\s*,\s*timeRoutes\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `docs/current/SYSTEM_MAP.md` 含 `/api/brain/time` 路由条目
  Test: node -e "const c=require('fs').readFileSync('docs/current/SYSTEM_MAP.md','utf8');if(!c.includes('/api/brain/time'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/time.test.ts`，覆盖：
- GET /api/brain/time 返回 HTTP 200 且 Content-Type 为 application/json
- 响应 body 顶层 key 严格等于 [iso, timezone, unix]
- iso 是合法 ISO 8601 字符串且可被 Date 解析
- timezone 是非空字符串
- unix 是正整数秒
- iso 与 unix 指向同一时刻（差值 ≤ 1 秒）
- 连续两次调用 timezone 完全一致
- 连续两次调用 unix 单调不减
