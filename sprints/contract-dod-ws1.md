# Contract DoD — Workstream 1: build-info Router + server.js mount

**范围**: 新建 `packages/brain/src/routes/build-info.js`（Express Router，导出三字段 build-info），并在 `packages/brain/server.js` 通过 `app.use('/api/brain/build-info', ...)` 挂载。
**大小**: S（总改动 < 80 行）
**依赖**: 无

> **PRD 事实修正备注**：PRD SC-002 写"`packages/brain/src/server.js`"，仓库实际入口在 `packages/brain/server.js`（对照 `packages/brain/package.json` 的 `"main": "server.js"`）。本 DoD 按真实路径校验，不改 PRD 行为意图。

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `packages/brain/src/routes/build-info.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/build-info.js')"

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 含 `Router` 导入与 `export default` 一个 router 实例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/import\s*\{[^}]*\bRouter\b[^}]*\}\s*from\s*['\"]express['\"]/.test(c))process.exit(1);if(!/export\s+default\s+\w+/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 在模块顶层缓存 `built_at`（用 `new Date().toISOString()` 且赋给一个常量/变量，禁止写在 handler 内部 —— 否则两次请求值会变）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');const lines=c.split('\n');let inHandler=false,depth=0,topLevelHasIso=false;for(const ln of lines){const d=(ln.match(/\{/g)||[]).length-(ln.match(/\}/g)||[]).length;if(/router\.(get|use)\s*\(/.test(ln))inHandler=true;if(!inHandler&&/new\s+Date\s*\(\s*\)\s*\.\s*toISOString\s*\(\s*\)/.test(ln))topLevelHasIso=true;depth+=d;if(inHandler&&depth<=0)inHandler=false}if(!topLevelHasIso)process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 通过 `child_process` 执行 git 解析，且用 try/catch 包裹（保证 git 不可用时不抛）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/from\s+['\"](node:)?child_process['\"]/.test(c))process.exit(1);if(!/git\s+rev-parse\s+HEAD/.test(c))process.exit(2);if(!/try\s*\{[\s\S]*?execSync[\s\S]*?\}\s*catch/.test(c))process.exit(3)"

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 含字面量字符串 `'unknown'` 或 `\"unknown\"`（git 失败回退值）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/['\"]unknown['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` import 了 build-info 路由模块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/build-info\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 通过 `app.use('/api/brain/build-info', ...)` 字面量挂载（精确前缀 path）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/build-info['\"]\s*,\s*\w+\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 不引入 `db.js`（PRD 范围限定：不连数据库）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(/from\s+['\"]\.\.\/db\.js['\"]/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/build-info.test.ts`，覆盖：
- returns 200 with application/json content-type
- body contains exactly the three keys git_sha / package_version / built_at
- all three fields are non-empty strings
- body.package_version equals packages/brain/package.json version field
- body.built_at is a valid ISO 8601 string (round-trip equal)
- built_at is identical across two requests within the same process
- git_sha is either 40-char lowercase hex or the literal string "unknown"

见 `tests/ws1/build-info-git-fallback.test.ts`，覆盖：
- returns 200 and git_sha="unknown" when git execSync throws
