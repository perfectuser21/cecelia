# Contract DoD — Workstream 1: 健康路由模块（routes/health.js 占位实现）

**范围**: 新增 `packages/brain/src/routes/health.js`，导出 Express Router，对挂载点 `GET /` 返回 `{status:'ok', uptime_seconds, version:'pending'}` 三字段。**严格占位**：`version` 必须是字面量 `'pending'`，不读 `package.json`，不调用 `process.uptime()`。读 package.json + process.uptime 由 WS3 接管。
**大小**: S
**依赖**: 无
**派发顺序**: Phase B 第一个；WS2/WS3/WS4 必须等本 PR merged 后才派发

> **占位边界 ARTIFACT 的语义说明**：第 6/7/8 条 ARTIFACT（要求含 `'pending'` 字面量、禁止 `package.json` 引用、禁止 `process.uptime`）**仅在 WS1 PR 阶段**的 Evaluator 步骤验证。WS3 PR 合并后，`'pending'` 会被替换为读 `package.json`、`process.uptime` 会被引入——这是 WS3 演进的预期效果，不视为对 WS1 ARTIFACT 的回归违反。Harness Evaluator 不应在 WS3 PR 阶段重跑 WS1 ARTIFACT。

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

- [ ] [ARTIFACT] [占位边界] 该文件含字面量 `'pending'` 或 `"pending"` 字符串（version 占位标记，由 WS3 替换）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(!/['\"]pending['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] [占位边界] 该文件**不含** `package.json` 字符串（WS1 不越界读 package.json，留给 WS3）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/package\.json/.test(c))process.exit(1)"

- [ ] [ARTIFACT] [占位边界] 该文件**不含** `process.uptime` 调用（WS1 不越界引入 process.uptime，留给 WS3）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/process\.uptime/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/health-router.test.ts`，覆盖：
- GET / returns 200 when mounted on a bare app
- responds with status="ok" string field
- responds with uptime_seconds as a finite non-negative number
- responds with version as a non-empty string
- does not error when called twice in succession

跑测命令（Repo Root）: `npx vitest run --config sprints/vitest.config.ts tests/ws1/`
