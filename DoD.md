contract_branch: cp-harness-propose-r1-761dfe5f
workstream_index: 1
sprint_dir: sprints/w22-playground-power

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /power（strict-schema + 0^0 拒 + 结果有限性兜底 + oracle）

**范围**：playground/server.js 加 `/power` 路由（含 strict-schema 正则校验 + 显式 0^0 拒 + 显式 Number.isFinite 兜底）+ playground/tests/server.test.js 加 `/power` 用例（含 oracle 复算断言 + schema oracle 断言）+ playground/README.md 端点段加 `/power` 示例。**不动 `/health` / `/sum`（W19）/ `/multiply`（W20）/ `/divide`（W21）的实现/测试**，零新依赖。
**大小**：S（< 100 行 server.js 净增 + 约 250 行测试 + 约 25 行 README）
**依赖**：无（W19 `/sum` + W20 `/multiply` + W21 `/divide` 已合并，作为回归基线）

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 含 `/power` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/power['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/health` 路由（防误删 bootstrap）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/health['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/sum` 路由（防误删 W19）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/sum['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/multiply` 路由（防误删 W20）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/multiply['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/divide` 路由（防误删 W21）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/divide['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 实现 `/power` 时使用 `^-?\d+(\.\d+)?$` 完整匹配正则（防 Number()/parseFloat() 假绿，可与 /multiply、/divide 共享同一字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/\\^-\\?\\\\d\\+\\(\\\\\\.\\\\d\\+\\)\\?\\$/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 含显式 `0^0` 拒判（`Number(a) === 0 && Number(b) === 0` 或等价表达式），位置在 strict-schema 校验通过后、计算之前
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!(/Number\(\s*a\s*\)\s*===\s*0\s*&&\s*Number\(\s*b\s*\)\s*===\s*0/.test(c)||/Number\(\s*b\s*\)\s*===\s*0\s*&&\s*Number\(\s*a\s*\)\s*===\s*0/.test(c)))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 含显式 `Number.isFinite` 结果有限性兜底（覆盖 NaN/Infinity/-Infinity 三种值），位置在算式之后、200 响应之前
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/Number\.isFinite\s*\(/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 在 `/power` 响应体中使用 `power` 字段名（不允许 `result` / `value` / `answer` / `exp` / `exponent` / `pow` / `output` 等漂移命名）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=c.split(/app\.get\(\s*['\"]\/power['\"]/)[1]||'';if(!/power/.test(seg))process.exit(1);if(/\\b(result|value|answer|exp|exponent|exponentiation|pow|output|payload)\\s*:/.test(seg.split(/app\.get\(/)[0]))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 含至少一个引用 `/power` 的测试用例
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes('/power'))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 同时含 `/power` happy（200 + power）与 error（400）断言
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/toBe\(200\)/.test(c)&&/toBe\(400\)/.test(c)&&/power/.test(c)))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 显式覆盖 0^0 不定式拒（含 `a: '0'` 与 `b: '0'` 同一用例），且断言 status === 400
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const m=c.match(/a:\s*['\"]0['\"][^}]*b:\s*['\"]0['\"]/);if(!(m&&/toBe\(400\)/.test(c)))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 显式覆盖结果非有限拒：至少 1 条 0^负（`a:'0'` + 负 b）+ 至少 1 条负^分（负 a + `b:'0.5'`）+ 至少 1 条溢出（大底大指如 `b:'1000'` 或 `b:'10000'`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const c1=/a:\s*['\"]0['\"][^}]*b:\s*['\"]-\d+['\"]/.test(c);const c2=/a:\s*['\"]-\d+['\"][^}]*b:\s*['\"]0\.5['\"]/.test(c);const c3=/b:\s*['\"](1000|10000)['\"]/.test(c);if(!(c1&&c2&&c3))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 至少 2 条 oracle 复算断言形如 `toBe(Number('...') ** Number('...'))`，其中至少 1 条覆盖小数指数（开方语义如 `Number('...') ** Number('0.5')` 或负指数如 `Number('...') ** Number('-...')`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const all=c.match(/toBe\(\s*Number\(['\"][^'\"]+['\"]\)\s*\*\*\s*Number\(['\"][^'\"]+['\"]\)\s*\)/g)||[];const fract=c.match(/toBe\(\s*Number\(['\"][^'\"]+['\"]\)\s*\*\*\s*Number\(['\"](?:0\.\d+|-\d+)['\"]\)\s*\)/g)||[];if(all.length<2||fract.length<1)process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 至少 1 条 schema oracle 断言形如 `expect(Object.keys(res.body)...).toEqual([...])` 含 `'power'`（成功响应顶层 keys 严格等于 ['power']）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/expect\(\s*Object\.keys\(\s*res\.body\s*\)[^)]*\)\.toEqual\(\s*\[\s*['\"]power['\"]\s*\]\s*\)/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 至少 1 条 /power 失败响应断言 body 不含 power 字段（`not.toHaveProperty('power')` 或 `hasOwnProperty('power'))).toBe(false)`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/not\.toHaveProperty\(['\"]power['\"]\)/.test(c)||/hasOwnProperty[^)]*['\"]power['\"][^)]*\)\)\.toBe\(false\)/.test(c)))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 显式覆盖 strict-schema 核心拒绝路径（科学计数法 `1e3` + `Infinity`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/1e3/.test(c)&&/Infinity/.test(c)))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 仍保留现有 `/health` / `/sum` / `/multiply` / `/divide` 用例（bootstrap + W19 + W20 + W21 回归）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')&&c.includes('/divide')))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 含 `/power` 字符串
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/power'))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/power` 0^0 拒绝示例（含 `a=0&b=0` 字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/power');if(idx<0||!/a=0&b=0/.test(c.slice(idx)))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/power` 结果非有限拒绝示例（0^负 / 负^分数 / 溢出 任一：含 `b=-1` 或 `a=-2&b=0.5` 或 `b=1000` 或 `b=10000`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/power');if(idx<0)process.exit(1);const seg=c.slice(idx);if(!(/b=-1/.test(seg)||/b=-3/.test(seg)||/a=-\d+&b=0\.5/.test(seg)||/b=1000/.test(seg)||/b=10000/.test(seg)))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/power` strict-schema 拒绝示例（`1e3` 或 `Infinity` 任一）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/power');if(idx<0||!(/1e3/.test(c.slice(idx))||/Infinity/.test(c.slice(idx))))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 仍含 `/health` / `/sum` / `/multiply` / `/divide` 段（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')&&c.includes('/divide')))process.exit(1)"

- [x] [ARTIFACT] `playground/package.json` 未新增运行时依赖（dependencies 仅 `express`）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"

- [x] [ARTIFACT] `playground/package.json` 未新增 devDependencies（仅 `supertest` + `vitest`，无 zod/joi/ajv/decimal.js/bignumber.js/mathjs）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.devDependencies||{}).sort().join(',');if(d!=='supertest,vitest')process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/w22-playground-power/tests/ws1/）

见 `sprints/w22-playground-power/tests/ws1/power.test.js`，覆盖：

- happy + oracle + 边界
  - GET `/power?a=2&b=10` → 200 + body `{power:1024}`（整数指数）
  - GET `/power?a=2&b=0.5` → 200 + `body.power === Number('2') ** Number('0.5')`（**oracle 探针 #1**：开方）
  - GET `/power?a=4&b=0.5` → 200 + `{power:2}`（整数开方结果）
  - GET `/power?a=2&b=-2` → 200 + `body.power === Number('2') ** Number('-2')`（**oracle 探针 #2**：负指数）
  - GET `/power?a=-2&b=3` → 200 + `{power:-8}`（负底奇整指）
  - GET `/power?a=-2&b=2` → 200 + `{power:4}`（负底偶整指）
  - GET `/power?a=5&b=0` → 200 + `{power:1}`（任意非零^0=1）
  - GET `/power?a=0&b=5` → 200 + `{power:0}`（0^正=0）
  - GET `/power?a=1&b=99999` → 200 + `{power:1}`（1^N=1 不溢出）
- schema oracle
  - GET `/power?a=2&b=10` 响应 `Object.keys(res.body).sort()` 严格等于 `['power']`（无 operation/result/a/b/input 等多余字段）
- 0^0 不定式拒（W22 主探针 #1）
  - GET `/power?a=0&b=0` → 400 + `.error` 非空 + body 不含 `power`（不允许靠 JS `0**0===1` 滑过）
- 结果非有限拒（W22 主探针 #2 — 用 Number.isFinite 一步覆盖 NaN/Infinity/-Infinity）
  - GET `/power?a=0&b=-1` → 400 + body 不含 `power`（0^负=Infinity 拒）
  - GET `/power?a=0&b=-3` → 400 + body 不含 `power`
  - GET `/power?a=-2&b=0.5` → 400 + body 不含 `power`（负^分数=NaN 拒）
  - GET `/power?a=-8&b=0.5` → 400 + body 不含 `power`
  - GET `/power?a=10&b=1000` → 400 + body 不含 `power`（溢出=Infinity 拒）
  - GET `/power?a=2&b=10000` → 400 + body 不含 `power`
- 缺参
  - GET `/power?a=2`（缺 b） → 400 + `.error` 非空 + body 不含 `power`
  - GET `/power?b=3`（缺 a） → 400 + `.error` 非空
  - GET `/power`（双参数都缺） → 400 + `.error` 非空
- strict-schema 拒绝（防 W20/W21 strict 被打回）
  - GET `/power?a=1e3&b=2`（科学计数法） → 400 + body 不含 `power`
  - GET `/power?a=Infinity&b=2` → 400 + body 不含 `power`
  - GET `/power?a=2&b=NaN` → 400 + `.error` 非空
  - GET `/power?a=+2&b=3`（前导正号） → 400
  - GET `/power?a=.5&b=2`（缺整数部分） → 400
  - GET `/power?a=2.&b=3`（缺小数部分） → 400
  - GET `/power?a=0xff&b=2`（十六进制） → 400
  - GET `/power?a=1,000&b=2`（千分位） → 400
  - GET `/power?a=&b=3`（空字符串） → 400
  - GET `/power?a=abc&b=3`（非数字） → 400 + body 不含 `power`
- 反向同义字段（W22 主探针 #3 — schema 完整性反向）
  - GET `/power?a=2&b=10` 成功响应不含 `result`/`value`/`answer`/`exp`/`exponent`/`pow`/`output`/`product`/`sum`/`quotient`
- 回归（不破坏现有 endpoint）
  - GET `/health` → 200 + `{ok:true}`（bootstrap）
  - GET `/sum?a=2&b=3` → 200 + `{sum:5}`（W19）
  - GET `/multiply?a=2&b=3` → 200 + `{product:6}`（W20）
  - GET `/multiply?a=1e3&b=2` → 400（W20 strict 仍生效，不被本轮打回）
  - GET `/divide?a=6&b=2` → 200 + `{quotient:3}`（W21）
  - GET `/divide?a=5&b=0` → 400（W21 除零兜底仍生效）
