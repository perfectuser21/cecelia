# Contract DoD — Workstream 1: Health Handler 核心模块

**范围**: 新建 `packages/brain/src/health.js`，纯逻辑模块（`buildHealthPayload` + `readBrainVersion` + default express Router）
**大小**: S（<100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 新建文件 `packages/brain/src/health.js`
  Test: node -e "require('fs').accessSync('packages/brain/src/health.js', require('fs').constants.F_OK)"

- [ ] [ARTIFACT] `packages/brain/src/health.js` export 命名符号 `buildHealthPayload`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health.js','utf8');if(!/export\s+(function|const|async function)\s+buildHealthPayload\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/health.js` export 命名符号 `readBrainVersion`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health.js','utf8');if(!/export\s+(function|const|async function)\s+readBrainVersion\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/health.js` 含 default export
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health.js','utf8');if(!/export\s+default\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/health.js` 从 express 导入 `Router`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health.js','utf8');if(!/import\s*\{[^}]*\bRouter\b[^}]*\}\s*from\s*['\"]express['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/health.js` 不 import `./db.js`（零 DB 耦合）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health.js','utf8');if(/from\s*['\"]\.\/db\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/health.js` 不 import `pg` 包
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health.js','utf8');if(/from\s*['\"]pg['\"]/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/health-handler.test.ts`，覆盖 9 个 `it()`：
- buildHealthPayload 返回对象键集合严格等于 {status, uptime_seconds, version}
- buildHealthPayload 返回的 status 恒等于字符串 "ok"
- buildHealthPayload 以 Math.floor((now - startedAt)/1000) 计算 uptime_seconds
- buildHealthPayload 在 now < startedAt 时返回 uptime_seconds === 0
- buildHealthPayload 在 now === startedAt 时返回 uptime_seconds === 0
- buildHealthPayload 在运行 3600500ms 后返回 uptime_seconds === 3600
- readBrainVersion 读出 packages/brain/package.json 中的 version 值
- readBrainVersion 在 package.json 读取抛错时返回字符串 "unknown" 且不抛出
- buildHealthPayload 缺省参数调用时 version === package.json 的 version
