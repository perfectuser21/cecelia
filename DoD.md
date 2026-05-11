contract_branch: cp-harness-propose-r2-385f2b20
workstream_index: 1
sprint_dir: sprints/w24-playground-factorial

---
---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /factorial（int-only · 上界 18 拒 · 跨调用递推 oracle · PR-D Bug 6 验收）

**范围**：
- `playground/server.js`：`/modulo` 之后、`app.listen` 之前新增 `GET /factorial` 路由。strict-schema 用**新的** `^\d+$` 整数白名单（**禁止**复用既有浮点 `STRICT_NUMBER`）；判定顺序 = 缺参 → strict regex → `Number(n) > 18` 上界拒 → 迭代 `for(i=2; i<=Number(n); i++) result*=i` 累积复算 → 200 返 `{factorial: result}`。
- `playground/tests/server.test.js`：新增 `describe('GET /factorial')` 块，含 happy 7+（n=0/1/2/5/10/12/18）、上界拒 3+（19/20/100）、strict 拒 8+、值 oracle 3+（含 n=18 严等 6402373705728000）、**跨调用递推 oracle 2+**（k=5 与 k=18 同 it 内两次 supertest）、schema oracle 2+、错误体不含 factorial 1+、错误体 keys 严等 ["error"] 1+、回归断言 6+。
- `playground/README.md`：端点列表 + happy（含 n=0）+ 上界拒 + strict 拒 + 跨调用递推 各示例 ≥ 1。

**禁动**：旧 6 路由 `/health`/`/sum`/`/multiply`/`/divide`/`/power`/`/modulo` 实现与单测一字不动；不引入新依赖（含 BigInt 重写、bignumber.js、decimal.js、mathjs、zod、joi、ajv）；不引入 `Number.isFinite` 兜底（strict + `n ≤ 18` 已保证有限）；不支持负数 / 浮点 / 复数 / gamma 延拓阶乘。

**大小**：M（server ≈ 12 行净增 + tests ≈ 220 行净增含递推用例 + README ≈ 35 行）
**依赖**：无（playground 独立子项目；W19~W23 作回归基线）

---

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 含 `GET /factorial` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/factorial['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/health`（防误删 bootstrap）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/health['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/sum`（防误删 W19）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/sum['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/multiply`（防误删 W20）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/multiply['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/divide`（防误删 W21）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/divide['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/power`（防误删 W22）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/power['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/modulo`（防误删 W23）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/modulo['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/factorial` 段使用**整数严格白名单** `^\d+$`（不允许浮点 / 负号 / 前导 +），且不复用 `STRICT_NUMBER`
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/\\^\\\\d\\+\\$/.test(seg))process.exit(1);if(/STRICT_NUMBER/.test(seg))process.exit(2)"

- [x] [ARTIFACT] `playground/server.js` `/factorial` 段含显式 `Number(n) > 18` 上界拒判定（位置在 strict 通过后、计算之前）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/Number\(\s*n\s*\)\s*>\s*18/.test(seg))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/factorial` 段响应字段名为 `factorial`，禁用 `result`/`value`/`answer`/`fact`/`f`/`out`/`output`/`data`/`payload`/`response`/`product`/`sum`/`quotient`/`power`/`remainder` 等同义/复用字段
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/factorial\s*:/.test(seg))process.exit(1);if(/\\b(result|value|answer|fact|f|out|output|data|payload|response|product|sum|quotient|power|remainder)\\s*:/.test(seg))process.exit(2)"

- [x] [ARTIFACT] `playground/server.js` `/factorial` 段不引入 `Number.isFinite` 兜底（strict + `n ≤ 18` 已保证结果有限，多余兜底视为合同违约）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(/Number\.isFinite/.test(seg))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/factorial` 段不引入 BigInt（响应必须是 JS Number，不能是 BigInt 字符串）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(/BigInt/.test(seg))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/factorial` 段不引入 Stirling / gamma / lgamma / Lanczos 近似实现（必须迭代精确累积）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(/(Stirling|stirling|gamma|lgamma|Lanczos|lanczos|Math\.exp|Math\.log)/.test(seg))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /factorial'` 块
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(c.indexOf(\"describe('GET /factorial\")===-1 && c.indexOf('describe(\"GET /factorial')===-1)process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 段同时含 happy（toBe(200) + factorial）与 error（toBe(400)）断言
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);if(!(/toBe\(200\)/.test(c.slice(i))&&/toBe\(400\)/.test(c.slice(i))&&/factorial/.test(c.slice(i))))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 至少 7 条 happy（含 n=0/1/2/5/10/12/18）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);const seg=c.slice(i);const must=['n:\\s*[\\'\"]0[\\'\"]','n:\\s*[\\'\"]1[\\'\"]','n:\\s*[\\'\"]2[\\'\"]','n:\\s*[\\'\"]5[\\'\"]','n:\\s*[\\'\"]10[\\'\"]','n:\\s*[\\'\"]12[\\'\"]','n:\\s*[\\'\"]18[\\'\"]'];for(const p of must){if(!new RegExp(p).test(seg)){console.error('miss '+p);process.exit(2)}}"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 显式断言 0! = 1 与 1! = 1（数学定义）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);const seg=c.slice(i);if(!/n:\\s*['\"]0['\"][\\s\\S]{0,400}factorial:\\s*1\\b/.test(seg))process.exit(2);if(!/n:\\s*['\"]1['\"][\\s\\S]{0,400}factorial:\\s*1\\b/.test(seg))process.exit(3)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 显式断言 18! = 6402373705728000（精度上界字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);if(!/6402373705728000/.test(c.slice(i)))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 至少 3 条上界拒（n=19、n=20、n=100），断言 status 400
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);const seg=c.slice(i);const must=['n:\\s*[\\'\"]19[\\'\"]','n:\\s*[\\'\"]20[\\'\"]','n:\\s*[\\'\"]100[\\'\"]'];for(const p of must){if(!new RegExp(p).test(seg)){console.error('miss '+p);process.exit(2)}};if(!/toBe\\(400\\)/.test(seg))process.exit(3)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 显式覆盖 strict-schema 核心拒绝路径（`-1` + `5.5` + `+5`（含前导正号）+ `1e2`（科学计数法）+ `0xff`（十六进制）+ `Infinity` + `NaN` + `abc`/空串 各至少 1 条）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);const seg=c.slice(i);const must=['-1','5.5','+5','1e2','0xff','Infinity','NaN'];for(const m of must){if(!seg.includes(m)){console.error('miss '+m);process.exit(2)}}"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 至少 3 条 oracle 值复算断言（独立 product 复算或字面量），其中至少 1 条覆盖 n=18 边界（断言 `6402373705728000`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);const seg=c.slice(i);const oracles=seg.match(/expect\\(\\s*res\\.body\\.factorial\\s*\\)\\.toBe\\(/g)||[];if(oracles.length<3)process.exit(2);if(!/6402373705728000/.test(seg))process.exit(3)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 至少 2 条**跨调用递推不变量** oracle：同 `it()` 内两次 `await request(app).get('/factorial')`，断言 `body_k.factorial === k * body_(k-1).factorial`，覆盖 k=5（小数）+ k=18（精度边界）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);const seg=c.slice(i);const reqs=seg.match(/await\\s+request\\(\\s*app\\s*\\)\\s*\\.get\\(\\s*['\"]\\/factorial['\"]\\s*\\)/g)||[];if(reqs.length<14)process.exit(2);const recur=seg.match(/\\*\\s*[a-zA-Z0-9_.]*\\.body\\.factorial/g)||[];if(recur.length<2)process.exit(3);if(!/n:\\s*['\"]17['\"]/.test(seg))process.exit(4)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 至少 1 条 schema oracle：`expect(Object.keys(res.body)...).toEqual(['factorial'])` 严等
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);if(!/expect\\(\\s*Object\\.keys\\(\\s*res\\.body\\s*\\)[^)]*\\)\\.toEqual\\(\\s*\\[\\s*['\"]factorial['\"]\\s*\\]\\s*\\)/.test(c.slice(i)))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 至少 1 条错误响应 schema oracle：`expect(Object.keys(res.body)...).toEqual(['error'])` 严等
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);if(!/expect\\(\\s*Object\\.keys\\(\\s*res\\.body\\s*\\)[^)]*\\)\\.toEqual\\(\\s*\\[\\s*['\"]error['\"]\\s*\\]\\s*\\)/.test(c.slice(i)))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 至少 1 条断言错误响应 body 不含 factorial 字段（`not.toHaveProperty('factorial')` 或 `hasOwnProperty('factorial'))).toBe(false)`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);const seg=c.slice(i);if(!(/not\\.toHaveProperty\\(['\"]factorial['\"]\\)/.test(seg)||/hasOwnProperty[^)]*['\"]factorial['\"][^)]*\\)\\)\\.toBe\\(false\\)/.test(seg)))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 仍保留 `/health` + `/sum` + `/multiply` + `/divide` + `/power` + `/modulo` 用例（W19~W23 回归基线）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')&&c.includes('/divide')&&c.includes('/power')&&c.includes('/modulo')))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 含 `/factorial` 字符串
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/factorial'))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/factorial` happy 示例（含 `n=5` 或 `n=10` 或 `n=12` 字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/factorial');if(i<0||!(/n=5/.test(c.slice(i))||/n=10/.test(c.slice(i))||/n=12/.test(c.slice(i))))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/factorial` 数学边界示例（含 `n=0` 字面量，证明 0!=1）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/factorial');if(i<0||!/n=0/.test(c.slice(i)))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/factorial` 上界拒示例（含 `n=19` 或 `n=20` 或 `n=100`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/factorial');if(i<0||!(/n=19/.test(c.slice(i))||/n=20/.test(c.slice(i))||/n=100/.test(c.slice(i))))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/factorial` strict-schema 拒示例（`-1` 或 `5.5` 或 `1e2` 任一）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/factorial');if(i<0||!(/n=-1/.test(c.slice(i))||/n=5\\.5/.test(c.slice(i))||/n=1e2/.test(c.slice(i))))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/factorial` **跨调用递推不变量** 示例（含 `factorial(n) === n * factorial(n-1)` 或两次 curl `n=5` + `n=4` 演示）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/factorial');if(i<0)process.exit(1);const seg=c.slice(i);if(!(/factorial\\(n\\)\\s*===\\s*n\\s*\\*\\s*factorial\\(n-1\\)/.test(seg)||/递推/.test(seg)))process.exit(2)"

- [x] [ARTIFACT] `playground/README.md` 仍含 `/health` + `/sum` + `/multiply` + `/divide` + `/power` + `/modulo` 段（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')&&c.includes('/divide')&&c.includes('/power')&&c.includes('/modulo')))process.exit(1)"

- [x] [ARTIFACT] `playground/package.json` 未新增运行时依赖（dependencies 仅 `express`）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"

- [x] [ARTIFACT] `playground/package.json` 未新增 devDependencies（仅 `supertest` + `vitest`，无 zod/joi/ajv/decimal.js/bignumber.js/mathjs）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.devDependencies||{}).sort().join(',');if(d!=='supertest,vitest')process.exit(1)"


---

> **注**：v7.4 [BEHAVIOR] 条目已全部搬迁到 `sprints/w24-playground-factorial/tests/ws1/factorial.test.js` 的 45 个 `test()` 块中（DoD 纯度规则：本文件只装 [ARTIFACT]）。
