# Contract DoD — Workstream 1: build-info 路由实现 + server.js 挂载（Round 2）

**范围**: 新建 `packages/brain/src/routes/build-info.js`（Express Router）+ 在 `packages/brain/server.js` 挂载到 `/api/brain/build-info`，含 R2/R3/R4 + Cascade 加固，并叠加本轮 R-001/R-002/R-003 收口
**大小**: S（< 100 行实现 + ~220-260 行测试）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/build-info.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/build-info.js')"

- [ ] [ARTIFACT] `build-info.js` 含 `import express` 与 `export default router`，且 router 由 `express.Router()` 构造
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/import\s+express\s+from\s+['\"]express['\"]/.test(c))process.exit(1);if(!/express\.Router\s*\(\s*\)/.test(c))process.exit(2);if(!/export\s+default\s+router/.test(c))process.exit(3)"

- [ ] [ARTIFACT] `build-info.js` 在模块顶层（非 handler 内）调用 `new Date().toISOString()` 生成 built_at 缓存
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');const m=c.match(/new\s+Date\s*\(\s*\)\s*\.toISOString\s*\(\s*\)/g)||[];if(m.length<1)process.exit(1);const handlerBody=c.match(/router\.get\s*\(\s*['\"]\/['\"]\s*,[\s\S]*?\}\s*\)\s*;?/);if(handlerBody&&/new\s+Date\s*\(\s*\)\s*\.toISOString/.test(handlerBody[0]))process.exit(2)"

- [ ] [ARTIFACT] [R3] `build-info.js` 含 `try { ... } catch (...) { ... = 'unknown' }` 包裹 git SHA 读取，catch 分支显式赋值字符串 `'unknown'`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/git\s+rev-parse|rev-parse\s+HEAD/.test(c))process.exit(1);if(!/try\s*\{[\s\S]*?catch[\s\S]*?['\"]unknown['\"][\s\S]*?\}/.test(c))process.exit(2)"

- [ ] [ARTIFACT] [R2] `build-info.js` 用 `readFileSync` + `JSON.parse` 读取 `packages/brain/package.json` 的 version 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/readFileSync\s*\([^)]*package\.json[^)]*\)/.test(c))process.exit(1);if(!/JSON\.parse\s*\(/.test(c))process.exit(2);if(!/\.version/.test(c))process.exit(3)"

- [ ] [ARTIFACT] [R2] `build-info.js` **不**得使用 `import ... from '...package.json' assert { type: 'json' }`（Node 版本不稳定）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(/import\s+[^;]*from\s+['\"][^'\"]*package\.json['\"]\s*assert\s*\{/.test(c))process.exit(1);if(/with\s*\{\s*type\s*:\s*['\"]json['\"]\s*\}/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `packages/brain/server.js` 含 `import` 引入 build-info router 的语句
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/build-info\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] [R3] `build-info.js` catch 块**不**含 `throw` / `if (err.code` / `err.code ===` 等条件分支（保证 catch 全部 Error 子类）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');const m=c.match(/catch\s*\([^)]*\)\s*\{[\s\S]*?\}/g)||[];for(const b of m){if(/\bthrow\b/.test(b))process.exit(1);if(/\.code\s*===|\.code\s*==/.test(b))process.exit(2);if(/if\s*\(\s*\w+\.code\b/.test(b))process.exit(3)}"

- [ ] [ARTIFACT] `packages/brain/server.js` 含 `app.use('/api/brain/build-info', ...)` 挂载语句（宽松正则，允许变量名差异）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\s*\(\s*['\"]\/api\/brain\/build-info['\"]\s*,/.test(c))process.exit(1)"

- [ ] [ARTIFACT] [R-003] `packages/brain/server.js` 严格字面字符串匹配 `app.use('/api/brain/build-info'`（含单引号；防止挂错路径如漏 `/brain` 或拼错前缀，宽松正则可能漏过）
  Test: bash -c "grep -F \"app.use('/api/brain/build-info'\" packages/brain/server.js > /dev/null"

- [ ] [ARTIFACT] [R4] `packages/brain/server.js` 中 `app.use('/api/brain/build-info', ...)` 这一行**不**含 `internalAuth`（端点为公开诊断端点）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');const lines=c.split(/\r?\n/);const target=lines.filter(l=>/app\.use\s*\(\s*['\"]\/api\/brain\/build-info['\"]/.test(l));if(target.length===0)process.exit(1);for(const l of target){if(/internalAuth/.test(l))process.exit(2)}"

- [ ] [ARTIFACT] [Cascade] `build-info.js` **不** import `db.js` / `pg` / `pool` 等数据库依赖（保持 stateless）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(/from\s+['\"][^'\"]*\bdb(\.js)?['\"]/.test(c))process.exit(1);if(/from\s+['\"]pg['\"]/.test(c))process.exit(2);if(/from\s+['\"][^'\"]*\bpool[^'\"]*['\"]/.test(c))process.exit(3)"

- [ ] [ARTIFACT] [Cascade] `build-info.js` 模块独立可加载（不启动 server，单独 import 即可解析 default export）
  Test: bash -c "cd /workspace && node --input-type=module -e \"import('./packages/brain/src/routes/build-info.js').then(m => process.exit(m.default ? 0 : 1)).catch(e => { console.error(e); process.exit(2) })\""

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/build-info.test.js`，覆盖（共 11 个 it）：
- GET /api/brain/build-info 返回 HTTP 200 + JSON 三字段（键集合严格等于 git_sha/package_version/built_at）
- built_at 是合法 ISO 8601（new Date(x).toISOString() === x）
- 连续两次请求 built_at 字段值完全相等（启动时缓存）
- [R-002] vi.resetModules + 重新 dynamic import 后 built_at 必然变化（覆盖 ESM cache 假阳性风险）
- package_version 严格等于 packages/brain/package.json 的 version 字段
- [R-001] git rev-parse 成功时 body.git_sha 等于 trim 后的 stdout 字符串（覆盖 cwd/SHA-source 选择路径）
- [R3] git rev-parse 抛 generic Error 时 git_sha 回退为字符串 'unknown' 且端点仍返回 200
- [R3] git rev-parse 抛 ENOENT-coded Error 时 git_sha 回退为 'unknown'（CI 容器无 .git 场景）
- [R3] git rev-parse 抛 TypeError 子类时 git_sha 回退为 'unknown'（catch 不限 Error 子类）
- [R4] 端点是公开的：不带任何鉴权头也返回 200（不被 internalAuth 拦截）
- [R-003] 挂载到 /api/brain/build-info 时返回 200，挂错路径（漏 /brain 或加多余前缀）时 404（cascade 路径定位）
