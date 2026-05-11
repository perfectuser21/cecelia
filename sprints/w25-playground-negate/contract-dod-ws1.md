---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /negate（浮点 strict-schema · 一元负号 · 跨调用自反 oracle · PR-E Bug 7 验收）

**范围**：
- `playground/server.js`：`/factorial` 之后、`app.listen` 之前新增 `GET /negate` 路由。strict-schema **复用** 已有 `STRICT_NUMBER` 常量（W20 引入，浮点白名单 `^-?\d+(\.\d+)?$`，与 W20/W21/W22/W23 同款；**禁止**复用 W24 `^\d+$` 整数白名单）；判定顺序 = 缺参 → strict regex → `-Number(n)` 取负 → 200 返 `{negation: result}`。**禁用** 位运算 `~Number(n)+1`、`0-Number(n)`、`Math.abs`、`Math.sign`、`Number.isFinite` 兜底；必须用一元负号 `-Number(n)`。
- `playground/tests/server.test.js`：新增 `describe('GET /negate')` 块，含 happy 8+（n=5/-5/0/-0/3.14/-3.14/100/-100）、strict 拒 12+（前导 + / 双负号 / 5. / .5 / 1e2 / 0xff / 1,000 / 空串 / abc / Infinity / NaN / 缺参）、值 oracle 4+（正/负整数 + 正/负小数）、**跨调用自反 oracle 3+**（chained 双 supertest，覆盖正整数 / 负小数 / 零）、schema oracle 2+（成功 keys 严等 ['negation']，错误 keys 严等 ['error']）、错误体不含 negation 1+、type 断言 1+（`typeof === 'number'`）、query 别名锁 2+（value=5 / x=5）、回归断言 7+（旧 7 路由各 ≥ 1）。
- `playground/README.md`：端点列表 + happy（含负数 / 小数 / 零）+ strict 拒 + 自反 oracle 各示例 ≥ 1。

**禁动**：旧 7 路由 `/health`/`/sum`/`/multiply`/`/divide`/`/power`/`/modulo`/`/factorial` 实现与单测一字不动；不引入新依赖（含 BigInt 重写、bignumber.js、decimal.js、mathjs、zod、joi、ajv）；不引入 `Number.isFinite` 兜底；不引入位运算或 `Math.abs/sign` 中间步骤；不支持 path param / body / POST。

**大小**：M（server ≈ 10 行净增 + tests ≈ 200 行净增含自反用例 + README ≈ 35 行）
**依赖**：无（playground 独立子项目；W19~W24 作回归基线）

---

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 含 `GET /negate` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/negate['\"]/m.test(c))process.exit(1)"

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

- [x] [ARTIFACT] `playground/server.js` 仍保留 `/factorial`（防误删 W24）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/factorial['\"]/m.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/negate` 段使用**浮点白名单** `^-?\d+(\.\d+)?$`（必须复用 STRICT_NUMBER 常量，不许另写）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/negate['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/STRICT_NUMBER\.test\s*\(/.test(seg))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/negate` 段**不复用** W24 整数 regex `^\d+$`（必须接受负数与小数）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/negate['\"]/)[1]||'').split(/app\.get\(/)[0];if(/\\^\\\\d\\+\\$/.test(seg))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/negate` 段使用一元负号 `-Number(n)` 实现（不许位运算 / `0-Number(n)` / `Math.abs` / `Math.sign`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/negate['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/-\s*Number\s*\(\s*n\s*\)/.test(seg))process.exit(1);if(/(~\s*Number|Math\.abs|Math\.sign|0\s*-\s*Number)/.test(seg))process.exit(2)"

- [x] [ARTIFACT] `playground/server.js` `/negate` 段响应字段名为 `negation`，禁用 `result`/`value`/`answer`/`negated`/`inverse`/`opposite`/`sign_flipped`/`flipped`/`neg`/`minus`/`output`/`out`/`data`/`payload`/`response`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial` 等同义/复用字段
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/negate['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/negation\s*:/.test(seg))process.exit(1);if(/\\b(result|value|answer|negated|inverse|opposite|sign_flipped|flipped|neg|minus|output|out|data|payload|response|sum|product|quotient|power|remainder|factorial)\\s*:/.test(seg))process.exit(2)"

- [x] [ARTIFACT] `playground/server.js` `/negate` 段不引入 `Number.isFinite` 兜底（一元负号在 strict 合法输入上结果一定有限，多余兜底视为合同违约）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/negate['\"]/)[1]||'').split(/app\.get\(/)[0];if(/Number\.isFinite/.test(seg))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/negate` 段不引入 BigInt（响应必须是 JS Number）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/negate['\"]/)[1]||'').split(/app\.get\(/)[0];if(/BigInt/.test(seg))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/negate` 段不引入字符串型转换 `String(...)`（响应必须是 JS Number 不是 "-5"）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/negate['\"]/)[1]||'').split(/app\.get\(/)[0];if(/String\s*\(/.test(seg))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /negate'` 块
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(c.indexOf(\"describe('GET /negate\")===-1 && c.indexOf('describe(\"GET /negate')===-1)process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 段同时含 happy（toBe(200) + negation）与 error（toBe(400)）断言
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);if(!(/toBe\(200\)/.test(c.slice(i))&&/toBe\(400\)/.test(c.slice(i))&&/negation/.test(c.slice(i))))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 至少 8 条 happy（含 n=5/-5/0/-0/3.14/-3.14/100/-100）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);const seg=c.slice(i);const must=['n:\\s*[\\'\"]5[\\'\"]','n:\\s*[\\'\"]-5[\\'\"]','n:\\s*[\\'\"]0[\\'\"]','n:\\s*[\\'\"]-0[\\'\"]','n:\\s*[\\'\"]3\\.14[\\'\"]','n:\\s*[\\'\"]-3\\.14[\\'\"]','n:\\s*[\\'\"]100[\\'\"]','n:\\s*[\\'\"]-100[\\'\"]'];for(const p of must){if(!new RegExp(p).test(seg)){console.error('miss '+p);process.exit(2)}}"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 显式断言 n=0 与 n=-0 都返 negation === 0（JSON 下负零规范）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);const seg=c.slice(i);if(!/n:\\s*['\"]0['\"][\\s\\S]{0,400}negation:\\s*0\\b/.test(seg))process.exit(2);if(!/n:\\s*['\"]-0['\"][\\s\\S]{0,400}negation:\\s*0\\b/.test(seg))process.exit(3)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 显式覆盖 strict-schema 核心拒绝路径（前导 + / 双负号 / `5.` / `.5` / `1e2` / `0xff` / `1,000` / 空串 / `abc` / `Infinity` / `NaN` / 缺参 各至少 1 条）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);const seg=c.slice(i);const must=['+5','--5','5.','.5','1e2','0xff','1,000','abc','Infinity','NaN'];for(const m of must){if(!seg.includes(m)){console.error('miss '+m);process.exit(2)}}"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 至少 4 条 oracle 值复算断言（独立 -Number(n) 复算或字面量），覆盖正整数 / 负整数 / 正小数 / 负小数 各至少 1 条
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);const seg=c.slice(i);const oracles=seg.match(/expect\\(\\s*res\\.body\\.negation\\s*\\)\\.toBe\\(/g)||[];if(oracles.length<4)process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 至少 3 条**跨调用自反不变量** oracle：同 `it()` 或 `test()` 内两次 `await request(app).get('/negate')`，第二次 query 用 `String(r1.body.negation)`，断言第二次 `body.negation === Number(<原 n>)`。覆盖正整数（如 n=5）+ 负小数（如 n=-3.14）+ 零（n=0，退化为身份）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);const seg=c.slice(i);const reqs=seg.match(/await\\s+request\\(\\s*app\\s*\\)\\s*\\.get\\(\\s*['\"]\\/negate['\"]\\s*\\)/g)||[];if(reqs.length<14)process.exit(2);const chained=seg.match(/String\\s*\\(\\s*[a-zA-Z0-9_.]*\\.body\\.negation\\s*\\)/g)||[];if(chained.length<3)process.exit(3)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 至少 1 条 schema 完整性 oracle：`expect(Object.keys(res.body)...).toEqual(['negation'])` 严等
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);if(!/expect\\(\\s*Object\\.keys\\(\\s*res\\.body\\s*\\)[^)]*\\)\\.toEqual\\(\\s*\\[\\s*['\"]negation['\"]\\s*\\]\\s*\\)/.test(c.slice(i)))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 至少 1 条错误响应 schema 完整性 oracle：`expect(Object.keys(res.body)...).toEqual(['error'])` 严等
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);if(!/expect\\(\\s*Object\\.keys\\(\\s*res\\.body\\s*\\)[^)]*\\)\\.toEqual\\(\\s*\\[\\s*['\"]error['\"]\\s*\\]\\s*\\)/.test(c.slice(i)))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 至少 1 条断言错误响应 body 不含 negation 字段（`not.toHaveProperty('negation')` 或 `hasOwnProperty('negation'))).toBe(false)`）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);const seg=c.slice(i);if(!(/not\\.toHaveProperty\\(['\"]negation['\"]\\)/.test(seg)||/hasOwnProperty[^)]*['\"]negation['\"][^)]*\\)\\)\\.toBe\\(false\\)/.test(seg)))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 至少 1 条 type 断言：`expect(typeof res.body.negation).toBe('number')`（防 generator 返字符串型 "-5"）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);if(!/expect\\(\\s*typeof\\s+res\\.body\\.negation\\s*\\)\\.toBe\\(\\s*['\"]number['\"]\\s*\\)/.test(c.slice(i)))process.exit(2)"

- [x] [ARTIFACT] `playground/tests/server.test.js` `/negate` 至少 2 条 query 别名锁断言（`value=5` 与 `x=5` 都 400 + body 不含 negation）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);const seg=c.slice(i);if(!/value:\\s*['\"]5['\"]/.test(seg))process.exit(2);if(!/x:\\s*['\"]5['\"]/.test(seg))process.exit(3)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 仍保留 `/health` + `/sum` + `/multiply` + `/divide` + `/power` + `/modulo` + `/factorial` 用例（W19~W24 回归基线）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')&&c.includes('/divide')&&c.includes('/power')&&c.includes('/modulo')&&c.includes('/factorial')))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 含 `/negate` 字符串
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/negate'))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/negate` happy 示例（含正数 n=5 或 n=7 等任一字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/negate');if(i<0||!(/n=5/.test(c.slice(i))||/n=7/.test(c.slice(i))))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/negate` 负数示例（含 n=-5 或 n=-100 等任一字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/negate');if(i<0||!(/n=-5/.test(c.slice(i))||/n=-100/.test(c.slice(i))||/n=-3\\.14/.test(c.slice(i))))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/negate` 零示例（含 n=0 字面量，证明 negation === 0）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/negate');if(i<0||!/n=0/.test(c.slice(i)))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/negate` strict-schema 拒示例（含 1e2 / 0xff / abc / Infinity 任一）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/negate');if(i<0||!(/n=1e2/.test(c.slice(i))||/n=0xff/.test(c.slice(i))||/n=abc/.test(c.slice(i))||/n=Infinity/.test(c.slice(i))))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 给出 `/negate` **跨调用自反不变量** 示例（含 `f(f(n)) === n` 或 `negate(negate(n))` 或 两次 curl `n=5` + `n=-5` 演示 / 含"自反"或"involution"中文/英文关键字 任一）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const i=c.indexOf('/negate');if(i<0)process.exit(1);const seg=c.slice(i);if(!(/f\\(f\\(n\\)\\)/.test(seg)||/negate\\(negate/.test(seg)||/自反/.test(seg)||/involution/i.test(seg)))process.exit(2)"

- [x] [ARTIFACT] `playground/README.md` 仍含 `/health` + `/sum` + `/multiply` + `/divide` + `/power` + `/modulo` + `/factorial` 段（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!(c.includes('/health')&&c.includes('/sum')&&c.includes('/multiply')&&c.includes('/divide')&&c.includes('/power')&&c.includes('/modulo')&&c.includes('/factorial')))process.exit(1)"

- [x] [ARTIFACT] `playground/package.json` 未新增运行时依赖（dependencies 仅 `express`）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"

- [x] [ARTIFACT] `playground/package.json` 未新增 devDependencies（仅 `supertest` + `vitest`，无 zod/joi/ajv/decimal.js/bignumber.js/mathjs）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.devDependencies||{}).sort().join(',');if(d!=='supertest,vitest')process.exit(1)"
