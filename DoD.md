contract_branch: cp-harness-propose-r1-70b4a3ee
workstream_index: 1
sprint_dir: sprints/w21-playground-divide

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /divide（strict-schema + 除零兜底 + oracle）

**范围**：playground/server.js 加 `/divide` 路由（含 strict-schema 正则校验 + 显式除零兜底）+ playground/tests/server.test.js 加 `/divide` 用例（含 oracle 复算断言）+ playground/README.md 端点段加 `/divide` 示例。**不动 `/health` / `/sum`（W19）/ `/multiply`（W20）的实现/测试**，零新依赖。
**大小**：S（< 100 行 server.js 净增 + 约 200 行测试 + 约 20 行 README）
**依赖**：无（W19 `/sum` + W20 `/multiply` 已合并，作为回归基线）

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `/divide` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/divide['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/health` 路由（防误删 bootstrap）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/health['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/sum` 路由（防误删 W19）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/sum['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/multiply` 路由（防误删 W20）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/multiply['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 实现 `/divide` 时使用 `^-?\d+(\.\d+)?$` 完整匹配正则（防 Number()/parseFloat() 假绿，可与 /multiply 共享同一字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/\\^-\\?\\\\d\\+\\(\\\\\\.\\\\d\\+\\)\\?\\$/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 含显式除零判定（`Number(b) === 0` 或等价表达式），位置在 strict-schema 校验通过后、除法运算之前
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!(/Number\(\s*b\s*\)\s*===\s*0/.test(c)||/Number\(\s*b\s*\)\s*==\s*0/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 在 `/divide` 响应体中使用 `quotient` 字段名（不允许 `result` / `value` / `answer` 等漂移命名）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const div=c.split(/app\.get\(\s*['\"]\/divide['\"]/)[1]||'';if(!/quotient/.test(div))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含至少一个引用 `/divide` 的测试用例
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes('/divide'))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 同时含 `/divide` happy（200 + quotient）与 error（400）断言
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/toBe\(200\)/.test(c)&&/toBe\(400\)/.test(c)&&/quotient/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 显式覆盖除零兜底（`b: '0'` 或 `b=0` query），且断言 status === 400
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/b:\s*['\"]0['\"]/.test(c)&&/toBe\(400\)/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 至少 1 条 oracle 复算断言形如 `toBe(Number('...') / Number('...'))`（用同一表达式独立复算严格相等）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/toBe\(\s*Number\(['\"][^'\"]+['\"]\)\s*\/\s*Number\(['\"][^'\"]+['\"]\)\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 显式覆盖 strict-schema 核心拒绝路径（科学计数法 `1e3` + `Infinity`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/1e3/.test(c)&&/Infinity/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 仍保留现有 `/health` / `/sum` / `/multiply` 用例（bootstrap + W19 + W20 回归）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 含 `/divide` 字符串
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/divide'))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 给出 `/divide` 除零拒绝示例（含 `b=0` 字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/divide');if(idx<0||!/b=0/.test(c.slice(idx)))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 给出 `/divide` strict-schema 拒绝示例（`1e3` 或 `Infinity` 任一）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/divide');if(idx<0||!(/1e3/.test(c.slice(idx))||/Infinity/.test(c.slice(idx))))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 仍含 `/health` / `/sum` / `/multiply` 段（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')))process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` 未新增运行时依赖（dependencies 仅 `express`）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` 未新增 devDependencies（仅 `supertest` + `vitest`，无 zod/joi/ajv/decimal.js/bignumber.js）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.devDependencies||{}).sort().join(',');if(d!=='supertest,vitest')process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/w21-playground-divide/tests/ws1/）

见 `sprints/w21-playground-divide/tests/ws1/divide.test.js`，覆盖：

- happy + oracle + 边界
  - GET `/divide?a=6&b=2` → 200 + body `{quotient:3}`
  - GET `/divide?a=1&b=3` → 200 + `body.quotient === Number('1')/Number('3')`（**oracle 探针**）
  - GET `/divide?a=1.5&b=0.5` → 200 + `body.quotient === Number('1.5')/Number('0.5')`（oracle）
  - GET `/divide?a=-6&b=2` → 200 + `{quotient:-3}`（负被除数合法）
  - GET `/divide?a=6&b=-2` → 200 + `{quotient:-3}`（负除数合法）
  - GET `/divide?a=0&b=5` → 200 + `{quotient:0}`（被除数 0 合法）
- 除零兜底（W21 主探针）
  - GET `/divide?a=5&b=0` → 400 + `.error` 非空 + body 不含 `quotient`
  - GET `/divide?a=0&b=0` → 400 + body 不含 `quotient`（0/0 也拒）
  - GET `/divide?a=6&b=0.0` → 400 + body 不含 `quotient`（小数零也拒）
- 缺参
  - GET `/divide?a=6`（缺 b） → 400 + `.error` 非空 + body 不含 `quotient`
  - GET `/divide?b=2`（缺 a） → 400 + `.error` 非空
  - GET `/divide`（双参数都缺） → 400 + `.error` 非空
- strict-schema 拒绝（防 W20 strict 被打回）
  - GET `/divide?a=1e3&b=2`（科学计数法） → 400 + body 不含 `quotient`
  - GET `/divide?a=Infinity&b=2` → 400 + body 不含 `quotient`
  - GET `/divide?a=6&b=NaN` → 400 + `.error` 非空
  - GET `/divide?a=+6&b=2`（前导正号） → 400
  - GET `/divide?a=.5&b=2`（缺整数部分） → 400
  - GET `/divide?a=6.&b=2`（缺小数部分） → 400
  - GET `/divide?a=0xff&b=2`（十六进制） → 400
  - GET `/divide?a=1,000&b=2`（千分位） → 400
  - GET `/divide?a=&b=3`（空字符串） → 400
  - GET `/divide?a=abc&b=3`（非数字） → 400 + body 不含 `quotient`
- 回归（不破坏现有 endpoint）
  - GET `/health` → 200 + `{ok:true}`（bootstrap）
  - GET `/sum?a=2&b=3` → 200 + `{sum:5}`（W19）
  - GET `/multiply?a=2&b=3` → 200 + `{product:6}`（W20）
  - GET `/multiply?a=1e3&b=2` → 400（W20 strict 仍生效，不被本轮打回）
