# Contract DoD — Workstream 1: 健康路由模块（routes/health.js 独立可调用）

**范围**: 新增 `packages/brain/src/routes/health.js`，导出 Express Router，对挂载点 `GET /` 返回 `{status:'ok', uptime_seconds, version}` 三字段。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/health.js')"

- [ ] [ARTIFACT] 该文件以 `import { Router } from 'express'` 风格导入 Express Router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(!/import\s*\{\s*Router\s*\}\s*from\s*['\"]express['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 该文件含 `export default` 导出语句（与其他路由模块一致）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(!/export\s+default\s+\w+/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 该文件不引入数据库依赖（无 `from '../db.js'`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/from\s+['\"]\.\.\/db(\.js)?['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 该文件不引入 tick / scheduler 模块（无 `from '../tick'`、无 `from '../scheduler'`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/from\s+['\"]\.\.\/(tick|scheduler)/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/health-router.test.ts`，覆盖：
- GET / returns 200 when mounted on a bare app
- responds with status="ok" string field
- responds with uptime_seconds as a finite non-negative number
- responds with version as a non-empty string
- does not error when called twice in succession
