contract_branch: cp-harness-propose-r2-ed20a544
workstream_index: 1
sprint_dir: sprints/w33-walking-skeleton-happy

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /ping 路由 + 单测 + README

**范围**: 在 `playground/server.js` 新增 `GET /ping` 路由（**单行 handler** `(req, res) => res.json({ pong: true })`；**不读 query**、**不加输入校验**、**不加 error 分支**、**不加 method 守卫**——本 endpoint 在定义层面不存在拒绝路径）；在 `playground/tests/server.test.js` 新增 `describe('GET /ping', ...)` 块；在 `playground/README.md` 加 `/ping` 端点说明（至少 1 个 happy 示例）
**大小**: S
**依赖**: 无

> v5.0 纯度规则：本文件只装 [ARTIFACT] 条目；BEHAVIOR 实跑全部由 `sprints/w33-walking-skeleton-happy/tests/ws1/ping.test.js` 的 17 个 it() 块承担（CI Sprint Tests 实跑环节执行）。

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 内含 `/ping` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/ping['\"]/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内 `/ping` 路由响应字面含 `pong` 字段（不漂到 `ping`/`status`/`ok`/`result`/`message` 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/ping['\"][\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bpong\s*:/.test(m[0]))process.exit(1);for(const k of ['status','alive','healthy','pong_value','is_alive','is_ok','message','data','payload','answer']){if(new RegExp('\\b'+k+'\\s*:').test(m[0])){console.error('forbidden key '+k);process.exit(1)}}"

- [x] [ARTIFACT] `playground/server.js` 内 `/ping` 路由响应字面含布尔字面量 `true`（不漂到字符串 `"true"`/数字 `1`/字符串 `"ok"`/字符串 `"pong"` 等）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/ping['\"][\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bpong\s*:\s*true\b/.test(m[0])){console.error('pong must be literal boolean true');process.exit(1)}"

- [x] [ARTIFACT] `playground/server.js` 内 `/ping` 路由不含 query 校验（trivial spec 反画蛇添足）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/ping['\"][\s\S]*?\}\);/);if(!m)process.exit(1);if(/req\.query/.test(m[0])){console.error('/ping must not read req.query (trivial spec)');process.exit(1)};if(/status\(40[0-9]\)/.test(m[0])){console.error('/ping must not return 4xx (trivial spec)');process.exit(1)}"

- [x] [ARTIFACT] `playground/server.js` 末尾保留 `export default app`（tests/ws1/ping.test.js 依赖此 default export 做 supertest，generator 修改 server.js 时不许误删此行）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/^export\s+default\s+app\s*;?\s*$/m.test(c)){console.error('missing: export default app');process.exit(1)}"

- [x] [ARTIFACT] `playground/tests/server.test.js` 新增 `describe('GET /ping'` 块（独立 describe，与其他 endpoint 平级）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/ping/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 端点列表含 `/ping` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/ping/.test(c))process.exit(1)"

- [x] [ARTIFACT] `sprints/w33-walking-skeleton-happy/tests/ws1/ping.test.js` 含 17 个 it() 块（happy 3 + schema 完整性 + 禁用字段反向 + 时变字段反向 + query 静默忽略 3 + 确定性 1 + 8 路由回归 8）
  Test: node -e "const c=require('fs').readFileSync('sprints/w33-walking-skeleton-happy/tests/ws1/ping.test.js','utf8');const n=(c.match(/\\b(?:it|test)\\(/g)||[]).length;if(n<15){console.error('expected >=15 it()/test() blocks, got '+n);process.exit(1)}"
