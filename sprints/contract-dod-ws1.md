# Contract DoD — Workstream 1: HTTP server 骨架 + `/iso` + 404/405 兜底

**范围**: 新建 `scripts/harness-dogfood/time-api.js`，导出 `createServer(port)` / `handler(req, res)`；实现 `/iso` 路由 + 404 fallback + 405 非 GET 拦截；`require.main === module` 时读取 `PORT` 环境变量（默认 18080）并启动。
**大小**: S（单文件约 50-70 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/harness-dogfood/time-api.js` 文件存在
  Test: test -f scripts/harness-dogfood/time-api.js

- [ ] [ARTIFACT] time-api.js 导出 createServer（module.exports 包含 createServer）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/module\.exports\s*=[\s\S]*createServer/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 `/iso` 路由字符串
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]\/iso['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 not_found 错误体字符串
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/not_found/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 method_not_allowed 错误体字符串
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/method_not_allowed/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 读取 PORT 环境变量
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/process\.env\.PORT/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 `require.main === module` 直跑分支
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/require\.main\s*===\s*module/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 不引入任何 require 非 Node 内置模块（仅依赖 http / 无 npm 包）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');const reqs=[...c.matchAll(/require\(['\x22]([^'\x22]+)['\x22]\)/g)].map(m=>m[1]);const builtins=new Set(['http','url','os','path','fs','util']);const bad=reqs.filter(r=>!builtins.has(r));if(bad.length>0){console.error('FAIL: non-builtin requires: '+bad.join(','));process.exit(1)}"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/iso.test.ts`，覆盖：
- GET /iso 返回 200 且 iso 字段符合 ISO 8601 毫秒 Z 格式
- GET /iso 的 Content-Type 为 application/json
- GET /iso 的 iso 字段对应时间与现在相差不超过 5 秒
- GET /unknown-xyz 返回 404 且 body 为 {error:not_found}
- POST /iso 返回 405 且 body 为 {error:method_not_allowed}
- createServer(0) 返回已监听的 server，address().port 为正整数
