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

## BEHAVIOR 条目（v7.4 内嵌可执行 manual:bash —— evaluator v1.1 直接跑，命令首词全在白名单 node/npm/curl/bash/psql + 安全工具 jq/kill/sleep/printf/[）

- [x] [BEHAVIOR] GET /factorial?n=5 返 200 + `{factorial: 120}`，顶层 keys 严等 `["factorial"]`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3201 node server.js & SPID=$!; sleep 2; OK=$(curl -fs "localhost:3201/factorial?n=5" | jq -e ". == {factorial:120}" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] GET /factorial?n=5 响应 `.factorial` 类型为 number（防 BigInt 字符串）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3202 node server.js & SPID=$!; sleep 2; OK=$(curl -fs "localhost:3202/factorial?n=5" | jq -e ".factorial | type == \"number\"" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] GET /factorial?n=0 返 200 + `{factorial: 1}`（数学定义 0!=1）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3203 node server.js & SPID=$!; sleep 2; OK=$(curl -fs "localhost:3203/factorial?n=0" | jq -e ". == {factorial:1}" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] GET /factorial?n=1 返 200 + `{factorial: 1}`（1!=1，防 off-by-one）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3204 node server.js & SPID=$!; sleep 2; OK=$(curl -fs "localhost:3204/factorial?n=1" | jq -e ". == {factorial:1}" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] GET /factorial?n=18 返 200 + `{factorial: 6402373705728000}`（精度上界精确整数，< MAX_SAFE_INTEGER）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3205 node server.js & SPID=$!; sleep 2; OK=$(curl -fs "localhost:3205/factorial?n=18" | jq -e ".factorial == 6402373705728000 and .factorial < 9007199254740991" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] GET /factorial?n=19 返 400（上界拒），错误体严等 `{error: "<non-empty>"}` 不含 factorial 字段
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3206 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/r19.json -w "%{http_code}" "localhost:3206/factorial?n=19"); OK=$(jq -e "(keys == [\"error\"]) and (.error | type == \"string\" and length > 0) and (has(\"factorial\") | not)" < /tmp/r19.json 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] GET /factorial?n=100 返 400（上界拒），错误体不含 factorial
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3207 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/r100.json -w "%{http_code}" "localhost:3207/factorial?n=100"); OK=$(jq -e "has(\"factorial\") | not" < /tmp/r100.json 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] strict-schema 拒：负数 / 小数 / 前导+ / 科学计数法 / 十六进制 / 字母 / 空串 全 400 不含 factorial
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3208 node server.js & SPID=$!; sleep 2; FAIL=0; for Q in "n=-1" "n=5.5" "n=%2B5" "n=1e2" "n=0xff" "n=abc" "n="; do CODE=$(curl -s -o /tmp/s.json -w "%{http_code}" "localhost:3208/factorial?$Q"); [ "$CODE" = "400" ] || FAIL=1; jq -e "has(\"factorial\") | not" < /tmp/s.json >/dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

- [x] [BEHAVIOR] strict-schema 拒：`Infinity` / `NaN` / `1,000` 千分位 / 缺参 全 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3209 node server.js & SPID=$!; sleep 2; FAIL=0; for Q in "n=Infinity" "n=NaN" "n=1,000" ""; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3209/factorial?$Q"); [ "$CODE" = "400" ] || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

- [x] [BEHAVIOR] **跨调用递推不变量**: f(5) === 5 * f(4) === 120（W24 核心 oracle，shell 整数算术严等）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3210 node server.js & SPID=$!; sleep 2; F5=$(curl -fs "localhost:3210/factorial?n=5" | jq ".factorial"); F4=$(curl -fs "localhost:3210/factorial?n=4" | jq ".factorial"); kill $SPID 2>/dev/null; [ -n "$F5" ] && [ -n "$F4" ] && [ "$F5" = "$(( 5 * F4 ))" ] && [ "$F5" = "120" ]'

- [x] [BEHAVIOR] **跨调用递推不变量精度上界**: f(18) === 18 * f(17)（Stirling/Lanczos/浮点累积必断）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3211 node server.js & SPID=$!; sleep 2; F18=$(curl -fs "localhost:3211/factorial?n=18" | jq ".factorial"); F17=$(curl -fs "localhost:3211/factorial?n=17" | jq ".factorial"); kill $SPID 2>/dev/null; [ -n "$F18" ] && [ -n "$F17" ] && [ "$F18" = "$(( 18 * F17 ))" ] && [ "$F18" = "6402373705728000" ]'

- [x] [BEHAVIOR] **跨调用递推不变量边界**: f(1) === 1 * f(0) === 1
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3212 node server.js & SPID=$!; sleep 2; F1=$(curl -fs "localhost:3212/factorial?n=1" | jq ".factorial"); F0=$(curl -fs "localhost:3212/factorial?n=0" | jq ".factorial"); kill $SPID 2>/dev/null; [ "$F1" = "1" ] && [ "$F0" = "1" ] && [ "$F1" = "$(( 1 * F0 ))" ]'

- [x] [BEHAVIOR] **跨调用递推中段**: f(10) === 10 * f(9)（验证中等值的递推关系）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3213 node server.js & SPID=$!; sleep 2; F10=$(curl -fs "localhost:3213/factorial?n=10" | jq ".factorial"); F9=$(curl -fs "localhost:3213/factorial?n=9" | jq ".factorial"); kill $SPID 2>/dev/null; [ -n "$F10" ] && [ -n "$F9" ] && [ "$F10" = "$(( 10 * F9 ))" ] && [ "$F10" = "3628800" ]'

- [x] [BEHAVIOR] 响应禁用字段反向断言：禁 result / value / product / fact / answer / data / payload / sum / quotient / power / remainder
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3214 node server.js & SPID=$!; sleep 2; OK=$(curl -fs "localhost:3214/factorial?n=5" | jq -e "(has(\"result\") | not) and (has(\"value\") | not) and (has(\"product\") | not) and (has(\"fact\") | not) and (has(\"answer\") | not) and (has(\"data\") | not) and (has(\"payload\") | not) and (has(\"sum\") | not) and (has(\"quotient\") | not) and (has(\"power\") | not) and (has(\"remainder\") | not)" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] query 参数名锁死 `n`：别名 `value` 应拒 400 且不含 factorial
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3215 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/a.json -w "%{http_code}" "localhost:3215/factorial?value=5"); OK=$(jq -e "has(\"factorial\") | not" < /tmp/a.json 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] query 别名 num / input / x / a / number / int / val / v / count / size 全拒 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3216 node server.js & SPID=$!; sleep 2; FAIL=0; for K in num input x a number int val v count size length; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3216/factorial?${K}=5"); [ "$CODE" = "400" ] || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

- [x] [BEHAVIOR] 前导 0 strict 通过且等价：n=05 返 `{factorial: 120}`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3217 node server.js & SPID=$!; sleep 2; OK=$(curl -fs "localhost:3217/factorial?n=05" | jq -e ". == {factorial:120}" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] 旧 6 路由回归无损 happy 全过
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3218 node server.js & SPID=$!; sleep 2; FAIL=0; curl -fs "localhost:3218/health" | jq -e ".ok == true" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3218/sum?a=2&b=3" | jq -e ".sum == 5" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3218/multiply?a=2&b=3" | jq -e ".product == 6" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3218/divide?a=6&b=2" | jq -e ".quotient == 3" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3218/power?a=2&b=10" | jq -e ".power == 1024" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3218/modulo?a=10&b=3" | jq -e ".remainder == 1" >/dev/null 2>&1 || FAIL=1; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

- [x] [BEHAVIOR] vitest 全套通过（generator TDD red→green 闭环）
  Test: manual:bash -c 'cd playground && NODE_ENV=test npx vitest run --reporter=basic'

- [x] [BEHAVIOR] PR diff 行级断言：`playground/server.js` 旧 6 路由 `app.get('/(health|sum|multiply|divide|power|modulo)')` 注册行**零删除**（r2 新增，针对 r1 "cascade 失败但前 8 步假绿" 反馈，根除 generator 删旧路由腾位的退化路径）
  Test: manual:bash -c 'git fetch origin main --depth=50 2>/dev/null || true; BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null); [ -n "$BASE" ] || exit 1; DELETED=$(git diff "$BASE" -- playground/server.js | grep -cE "^-[[:space:]]*app\.get\(['\"]/(health|sum|multiply|divide|power|modulo)['\"]") || DELETED=0; [ "$DELETED" -eq 0 ]'

## r2 新增 BEHAVIOR（针对 verification_oracle_completeness=6 + behavior_count_position=6 加固，PRD 禁用清单 1:1 全覆盖）

> 上面 20 条已覆盖核心场景；下面新增 13 条对 PRD `## Response Schema` 段所列的 **禁用 response 字段（12 个）** / **禁用 query 名（26 个）** / **错误体禁用字段（7 个）** 做 1:1 oracle 反向验证。每条独立 [BEHAVIOR] 标签 + 独立 manual:bash 命令，evaluator v1.1 可逐条执行判 PASS/FAIL。

### 禁用 response 字段 1:1（PRD 列 12 个，已有 1 条 lumped；新增 5 条按"语义分组"细分）

- [x] [BEHAVIOR] 响应禁用字段反向 #1: 禁 result（**generic 漂移防御**，W19/W20 实证 generator 倾向写 generic `result`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3220 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3220/factorial?n=4"); OK=$(echo "$RESP" | jq -e "has(\"result\") | not" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] 响应禁用字段反向 #2: 禁 product（**W20 字段复读防御**，generator 不许把 /multiply 模板复读到 /factorial）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3221 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3221/factorial?n=4"); OK=$(echo "$RESP" | jq -e "has(\"product\") | not" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] 响应禁用字段反向 #3: 禁 sum / quotient / power / remainder（**W19/W21/W22/W23 字段复读防御**，4 个旧字段一次扫）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3222 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3222/factorial?n=4"); OK=$(echo "$RESP" | jq -e "(has(\"sum\") | not) and (has(\"quotient\") | not) and (has(\"power\") | not) and (has(\"remainder\") | not)" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] 响应禁用字段反向 #4: 禁 value / answer / fact / f / out / output（**6 个 generic 同义词漂移防御**）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3223 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3223/factorial?n=4"); OK=$(echo "$RESP" | jq -e "(has(\"value\") | not) and (has(\"answer\") | not) and (has(\"fact\") | not) and (has(\"f\") | not) and (has(\"out\") | not) and (has(\"output\") | not)" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] 响应禁用字段反向 #5: 禁 data / payload / response（**3 个包装词漂移防御**，generator 易把响应包成 `{data: {factorial: ...}}`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3224 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3224/factorial?n=4"); OK=$(echo "$RESP" | jq -e "(has(\"data\") | not) and (has(\"payload\") | not) and (has(\"response\") | not)" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

- [x] [BEHAVIOR] 响应 schema 完整性总闸 — 顶层 keys 严等 `["factorial"]`（即上面 12 个禁用字段一次性总闸）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3225 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3225/factorial?n=7"); OK=$(echo "$RESP" | jq -e "keys == [\"factorial\"]" 2>/dev/null && printf OK); kill $SPID 2>/dev/null; [ "$OK" = "OK" ]'

### 禁用 query 名 1:1（PRD 列 26 个，已有 2 条 lumped 覆盖 ~10；新增 3 条扫剩余 16）

- [x] [BEHAVIOR] 禁用 query 名反向 #1: 单字母组 `x` / `y` / `m` / `k` / `i` / `j` / `p` / `q` 全拒 400 + 不含 factorial（8 个单字母）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3226 node server.js & SPID=$!; sleep 2; FAIL=0; for K in x y m k i j p q; do CODE=$(curl -s -o /tmp/q.json -w "%{http_code}" "localhost:3226/factorial?${K}=5"); [ "$CODE" = "400" ] || FAIL=1; jq -e "has(\"factorial\") | not" < /tmp/q.json > /dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

- [x] [BEHAVIOR] 禁用 query 名反向 #2: 双参 query 名 `a` / `b` 拒 400（防 generator 复读 W19~W23 双参模板）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3227 node server.js & SPID=$!; sleep 2; CODE_A=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3227/factorial?a=5"); CODE_B=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3227/factorial?b=5"); CODE_AB=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3227/factorial?a=5&b=3"); kill $SPID 2>/dev/null; [ "$CODE_A" = "400" ] && [ "$CODE_B" = "400" ] && [ "$CODE_AB" = "400" ]'

- [x] [BEHAVIOR] 禁用 query 名反向 #3: 长尾别名 `arg` / `arg1` / `input1` / `v1` / `len` / `length` 全拒（6 个长尾别名）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3228 node server.js & SPID=$!; sleep 2; FAIL=0; for K in arg arg1 input1 v1 len length; do CODE=$(curl -s -o /tmp/q.json -w "%{http_code}" "localhost:3228/factorial?${K}=5"); [ "$CODE" = "400" ] || FAIL=1; jq -e "has(\"factorial\") | not" < /tmp/q.json > /dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

### 错误体禁用字段 1:1（PRD 列 7 个，r1 未覆盖；新增 4 条 1:1 + 1 条 schema 总闸）

- [x] [BEHAVIOR] 错误体禁用替代字段 #1: 禁 `message` / `msg`（generator 易把 `error` 写成 `message`，express 默认 error handler 也用 `message`，必须显式禁）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3229 node server.js & SPID=$!; sleep 2; FAIL=0; for QS in "n=abc" "n=19" ""; do curl -s "localhost:3229/factorial?${QS}" > /tmp/e.json; jq -e "has(\"message\") | not" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; jq -e "has(\"msg\") | not" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

- [x] [BEHAVIOR] 错误体禁用替代字段 #2: 禁 `reason` / `detail` / `details`（3 个细节同义词）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3230 node server.js & SPID=$!; sleep 2; FAIL=0; for QS in "n=abc" "n=19" ""; do curl -s "localhost:3230/factorial?${QS}" > /tmp/e.json; jq -e "has(\"reason\") | not" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; jq -e "has(\"detail\") | not" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; jq -e "has(\"details\") | not" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

- [x] [BEHAVIOR] 错误体禁用替代字段 #3: 禁 `description` / `info`（2 个补充同义词）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3231 node server.js & SPID=$!; sleep 2; FAIL=0; for QS in "n=abc" "n=19" ""; do curl -s "localhost:3231/factorial?${QS}" > /tmp/e.json; jq -e "has(\"description\") | not" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; jq -e "has(\"info\") | not" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

- [x] [BEHAVIOR] 错误体 schema 完整性总闸 — 顶层 keys 严等 `["error"]` 跨三类 error path（strict / 上界 / 缺参），且每类 body 不含 factorial（防"既报错又给值"混合污染）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3232 node server.js & SPID=$!; sleep 2; FAIL=0; for QS in "n=abc" "n=19" ""; do curl -s "localhost:3232/factorial?${QS}" > /tmp/e.json; jq -e "keys == [\"error\"]" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; jq -e "has(\"factorial\") | not" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; jq -e ".error | type == \"string\" and length > 0" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'

- [x] [BEHAVIOR] 错误体三类 error path × 7 个禁用替代字段 7 × 3 = 21 项总扫（一次性兜底防漏）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3233 node server.js & SPID=$!; sleep 2; FAIL=0; for QS in "n=abc" "n=19" ""; do curl -s "localhost:3233/factorial?${QS}" > /tmp/e.json; for ALT in message msg reason detail details description info; do jq -e "has(\"${ALT}\") | not" < /tmp/e.json > /dev/null 2>&1 || FAIL=1; done; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
