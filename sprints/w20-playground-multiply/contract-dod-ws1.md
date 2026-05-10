---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /multiply（strict-schema）

**范围**：playground/server.js 加 `/multiply` 路由（含 strict-schema 正则校验）+ playground/tests/server.test.js 加 `/multiply` 用例 + playground/README.md 端点段加 `/multiply` 示例。**不动 `/health` 与 `/sum` 的实现/测试**，零新依赖。
**大小**：S（< 100 行净增）
**依赖**：无（W19 `/sum` 已合并，作为回归基线）

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `/multiply` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/multiply['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/health` 路由（防误删 W19 之前的基线）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/health['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/sum` 路由（防误删 W19）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/sum['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 实现 `/multiply` 时使用 `^-?\d+(\.\d+)?$` 完整匹配正则（防 Number() / parseFloat() 假绿）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/\\^-\\?\\\\d\\+\\(\\\\\\.\\\\d\\+\\)\\?\\$/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含至少一个引用 `/multiply` 的测试用例
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes('/multiply'))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 同时含 `/multiply` happy（200 + product）与 error（400）断言
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/toBe\(200\)/.test(c)&&/toBe\(400\)/.test(c)&&/product/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 显式覆盖 strict-schema 核心拒绝路径（科学计数法 `1e3` + `Infinity`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/1e3/.test(c)&&/Infinity/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 仍保留现有 `/sum` 与 `/health` 用例（W19 + bootstrap 回归）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(c.includes('/sum')&&c.includes('/health')))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 含 `/multiply` 字符串且给出至少 1 条 strict-schema 拒绝示例（`1e3` 或 `Infinity` 任一）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!(c.includes('/multiply')&&(/1e3/.test(c)||/Infinity/.test(c))))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 仍含 `/sum` 与 `/health` 段（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!(c.includes('/sum')&&c.includes('/health')))process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` 未新增运行时依赖（dependencies 仅 `express`）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` 未新增 devDependencies（仅 `supertest` + `vitest`，无 zod/joi/ajv）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.devDependencies||{}).sort().join(',');if(d!=='supertest,vitest')process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/w20-playground-multiply/tests/ws1/）

见 `sprints/w20-playground-multiply/tests/ws1/multiply.test.js`，覆盖：

- happy + 边界
  - GET `/multiply?a=2&b=3` → 200 + body `{product:6}`
  - GET `/multiply?a=0&b=5` → 200 + `{product:0}`（零合法）
  - GET `/multiply?a=-2&b=3` → 200 + `{product:-6}`（负数合法）
  - GET `/multiply?a=1.5&b=2` → 200 + `{product:3}`（标准小数合法）
- 缺参
  - GET `/multiply?a=2`（缺 b） → 400 + `.error` 非空字符串 + body 不含 `product`
  - GET `/multiply` （双参数都缺） → 400 + `.error` 非空
- strict-schema 拒绝（防 W19 宽松校验复现）
  - GET `/multiply?a=1e3&b=2`（科学计数法） → 400 + `.error` 非空 + body 不含 `product`
  - GET `/multiply?a=Infinity&b=2` → 400 + `.error` 非空 + body 不含 `product`
  - GET `/multiply?a=NaN&b=2` → 400 + `.error` 非空
  - GET `/multiply?a=+2&b=3`（前导正号） → 400 + `.error` 非空
  - GET `/multiply?a=.5&b=2`（缺整数部分） → 400 + `.error` 非空
  - GET `/multiply?a=5.&b=2`（缺小数部分） → 400 + `.error` 非空
  - GET `/multiply?a=0xff&b=2`（十六进制） → 400 + `.error` 非空
  - GET `/multiply?a=1,000&b=2`（千分位） → 400 + `.error` 非空
  - GET `/multiply?a=&b=3`（空字符串） → 400 + `.error` 非空
  - GET `/multiply?a=abc&b=3`（非数字） → 400 + `.error` 非空 + body 不含 `product`
- 回归（不破坏现有 endpoint）
  - GET `/health` → 200 + `{ok:true}`
  - GET `/sum?a=2&b=3` → 200 + `{sum:5}`（W19）
