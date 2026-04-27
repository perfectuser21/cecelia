# Contract DoD — Workstream 3: 预检 HTTP 接口与持久化

**范围**: 新增 `packages/brain/src/routes/preflight.js`，挂到 `server.js`。POST 触发预检并写入 ws1 表，GET 查最新一条。
**大小**: M
**依赖**: ws2 完成

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `packages/brain/src/routes/preflight.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/preflight.js')"

- [ ] [ARTIFACT] 路由模块默认导出 express Router（含 `import { Router }` 与 `export default`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/preflight.js','utf8');if(!(/import\s*\{[^}]*Router[^}]*\}\s*from\s*['\"]express['\"]/.test(c)&&/export\s+default\s+/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] 路由声明 POST `/:id/preflight` 端点
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/preflight.js','utf8');if(!/router\.post\(['\"]\/:id\/preflight/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路由声明 GET `/:id/preflight` 端点
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/preflight.js','utf8');if(!/router\.get\(['\"]\/:id\/preflight/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `server.js` 导入预检路由模块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/from\s+['\"]\.\/src\/routes\/preflight\.js['\"]/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/preflight-api.test.ts`，覆盖：
- POST on a compliant initiative returns 200 with status=passed and persists one row
- GET after two POSTs returns the latest record by checked_at
- POST on a non-compliant initiative returns 200 with status=rejected and non-empty reasons
- POST with unknown initiative_id returns HTTP 404
