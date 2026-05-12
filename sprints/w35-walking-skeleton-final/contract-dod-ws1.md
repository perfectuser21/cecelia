---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /subtract 路由 + 单测 + README

**范围**: 在 `playground/server.js` 新增 `GET /subtract` 路由（含 strict-schema `^-?\d+(\.\d+)?$` 校验 + `Number(minuend) - Number(subtrahend)` 算术 + `Number.isFinite` 兜底 + 返回 `{result, operation: "subtract"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /subtract', ...)` 块；在 `playground/README.md` 加 `/subtract` 端点说明
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 内含 `/subtract` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/subtract['\"]/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内含 strict-schema 浮点正则 `^-?\d+(\.\d+)?$`（复用 STRICT_NUMBER 常量合法，与 W20~W23 同款）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/subtract[\s\S]*?\}\);/);if(!m)process.exit(1);if(!(/\^-\?\\d\+\(\\\.\\d\+\)\?\$/.test(m[0])||/STRICT_NUMBER/.test(m[0])))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内 `/subtract` 路由使用 query 名 `minuend` 和 `subtrahend`（不复用 `a`/`b`/`n`/`value`/`x`/`y`）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/subtract[\s\S]*?\}\);/);if(!m)process.exit(1);if(!(/\bminuend\b/.test(m[0])&&/\bsubtrahend\b/.test(m[0])))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内 `/subtract` 路由含 `Number.isFinite` 结果兜底（与 W22 /power 同款 defensive 设计）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/subtract[\s\S]*?\}\);/);if(!m||!/Number\.isFinite/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内 `/subtract` 路由响应字面含 `operation: "subtract"` 字符串
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/subtract[\s\S]*?\}\);/);if(!m||!/operation\s*:\s*['\"]subtract['\"]/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 内 `/subtract` 路由响应字面含 `result` 字段（不漂到 `difference`/`diff`/`subtraction`/`minus`/`delta` 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/subtract[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bresult\s*:/.test(m[0]))process.exit(1);for(const k of ['difference','diff','subtraction','subtraction_result','sub_result','minus_result','minus','delta']){if(new RegExp('\\b'+k+'\\s*:').test(m[0])){console.error('forbidden key '+k);process.exit(1)}}"

- [x] [ARTIFACT] `playground/tests/server.test.js` 新增 `describe('GET /subtract'` 块（独立 describe，与其他 endpoint 平级）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/subtract/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 端点列表含 `/subtract` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/subtract/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 现存 8 路由（/health /sum /multiply /divide /power /modulo /increment /factorial）全部仍注册存在（不被破坏）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');for(const r of ['/health','/sum','/multiply','/divide','/power','/modulo','/increment','/factorial']){if(!new RegExp(\"app\\\\.get\\\\(['\\\"]\"+r.replace('/','\\\\/')+\"['\\\"]\").test(c)){console.error('missing '+r);process.exit(1)}}"


<!-- BEHAVIOR entries moved to sprints/w35-walking-skeleton-final/tests/ws1/subtract.test.js (v5 purity rule). -->
<!-- DoD.md (PR root) retains full BEHAVIOR list to satisfy harness-dod-integrity check against contract branch original. -->
