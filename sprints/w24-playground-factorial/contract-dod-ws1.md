---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /factorial（strict-schema `^\d+$` + 上界 18 拒 + 跨调用递推 oracle）

**范围**: `playground/server.js` 加 `/factorial` 路由（strict-schema `^\d+$` 校验 + 显式 `Number(n) > 18` 上界拒 + 迭代复算 + 字段锁死 `factorial`）+ `playground/tests/server.test.js` 加 `/factorial` describe 块 + `playground/README.md` 加 `/factorial` 段。**不动 `/health` / `/sum` / `/multiply` / `/divide` / `/power` / `/modulo` 的实现/测试/README 段**，零新依赖。
**大小**: M（约 14 行 server.js 净增 + 约 240 行测试 + 约 35 行 README）
**依赖**: 无（W19~W23 已合并，作为回归基线）

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `GET /factorial` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/factorial['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/health` `/sum` `/multiply` `/divide` `/power` `/modulo` 路由（防误删 W19~W23 + bootstrap）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');for(const r of ['/health','/sum','/multiply','/divide','/power','/modulo']){if(!c.includes(\"'\"+r+\"'\")&&!c.includes('\"'+r+'\"'))process.exit(1)}"

- [ ] [ARTIFACT] `playground/server.js` 实现 `/factorial` 时使用 `^\\d+$` 完整匹配正则（非负整数白名单，与 W20~W23 的 `^-?\\d+(\\.\\d+)?$` 浮点 regex 字面不同）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/\\^\\\\d\\+\\$/.test(seg))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/factorial` 含显式上界拒 `Number(n) > 18` 判定
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/Number\(\s*n\s*\)\s*>\s*18/.test(seg))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/factorial` 响应体严格使用字段名 `factorial`（不允许 `result`/`value`/`fact`/`f`/`output`/`product`/`sum`/`quotient`/`power`/`remainder` 等漂移）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(!/factorial\s*:/.test(seg))process.exit(1);if(/\\b(result|value|fact|output|product|sum|quotient|power|remainder|operation|data|payload|response)\\s*:/.test(seg))process.exit(2)"

- [ ] [ARTIFACT] `playground/server.js` `/factorial` 不引入 BigInt 重写（响应必为 JS Number；strict + n≤18 已保证整数精度无损）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(/BigInt/.test(seg))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/factorial` 不引入 Stirling/Lanczos gamma 近似（严禁 Math.lgamma / Math.gamma / Math.exp 等近似算法字符串）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const seg=(c.split(/app\.get\(\s*['\"]\/factorial['\"]/)[1]||'').split(/app\.get\(/)[0];if(/lgamma|gamma|Stirling|Lanczos|Math\.exp/.test(seg))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 `/factorial` describe 块
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes('/factorial'))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 含 happy 200 + 错误 400 + 上界拒 + 跨调用递推 oracle 至少各 1 条
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const idx=c.indexOf('/factorial');if(idx<0)process.exit(1);const seg=c.slice(idx);if(!(/toBe\(200\)/.test(seg)&&/toBe\(400\)/.test(seg)&&/n=19|n:\s*['\"]19['\"]/.test(seg)&&/n=17|n:\s*['\"]17['\"]/.test(seg)))process.exit(2)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` `/factorial` 至少 1 条 schema oracle `Object.keys(res.body)).toEqual(['factorial'])`
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');const idx=c.indexOf('/factorial');if(idx<0)process.exit(1);if(!/expect\(\s*Object\.keys\(\s*res\.body\s*\)[^)]*\)\.toEqual\(\s*\[\s*['\"]factorial['\"]\s*\]\s*\)/.test(c.slice(idx)))process.exit(2)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 仍保留现有 `/health` / `/sum` / `/multiply` / `/divide` / `/power` / `/modulo` 用例（W19~W23 + bootstrap 回归）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');for(const r of ['/health','/sum','/multiply','/divide','/power','/modulo']){if(!c.includes(r))process.exit(1)}"

- [ ] [ARTIFACT] `playground/README.md` 含 `/factorial` 字符串 + happy 示例（含 `n=5` 或 `n=0` 或 `n=10` 或 `n=18` 任一字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/factorial'))process.exit(1);const idx=c.indexOf('/factorial');if(!/n=5|n=0|n=10|n=18/.test(c.slice(idx)))process.exit(2)"

- [ ] [ARTIFACT] `playground/README.md` `/factorial` 段给出上界拒示例（`n=19` 或 `n=20` 或 `n=100` 字面量）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');const idx=c.indexOf('/factorial');if(idx<0)process.exit(1);if(!(/n=19|n=20|n=100/.test(c.slice(idx))))process.exit(2)"

- [ ] [ARTIFACT] `playground/README.md` 仍含 `/health` / `/sum` / `/multiply` / `/divide` / `/power` / `/modulo` 段（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');for(const r of ['/health','/sum','/multiply','/divide','/power','/modulo']){if(!c.includes(r))process.exit(1)}"

- [ ] [ARTIFACT] `playground/package.json` 未新增运行时依赖（dependencies 仅 `express`）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` 未新增 devDependencies（仅 `supertest` + `vitest`，无 zod/joi/ajv/decimal.js/bignumber.js/mathjs）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.devDependencies||{}).sort().join(',');if(d!=='supertest,vitest')process.exit(1)"

- [ ] [ARTIFACT] PR diff 行级断言 — 无旧路由 `app.get` 被删除（防 generator 改 server.js 时误删 W19~W23 任一）
  Test: manual:bash -c 'cd /workspace && DEL=$(git diff origin/main -- playground/server.js 2>/dev/null | grep -E "^-\s*app\.get\(\s*[\x27\x22](\/health|\/sum|\/multiply|\/divide|\/power|\/modulo)[\x27\x22]" | wc -l); [ "$DEL" = "0" ]'

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，v7.4 与 evaluator v1.1 协议对齐）

- [ ] [BEHAVIOR] GET /factorial?n=5 → 200 + body `.factorial == 120`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4101 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4101/factorial?n=5" | jq -e ".factorial == 120"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=10 → 200 + `.factorial == 3628800`（中位数 happy）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4102 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4102/factorial?n=10" | jq -e ".factorial == 3628800"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=12 → 200 + `.factorial == 479001600`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4103 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4103/factorial?n=12" | jq -e ".factorial == 479001600"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=0 → 200 + `.factorial == 1`（数学定义 0! = 1，边界 #1）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4104 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4104/factorial?n=0" | jq -e ".factorial == 1"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=1 → 200 + `.factorial == 1`（边界 #2）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4105 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4105/factorial?n=1" | jq -e ".factorial == 1"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=18 → 200 + `.factorial == 6402373705728000`（精度上界，Number.MAX_SAFE_INTEGER 之下最大阶乘）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4106 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4106/factorial?n=18" | jq -e ".factorial == 6402373705728000"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=05 → 200 + `.factorial == 120`（前导 0 strict 通过，与 n=5 等价）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4107 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4107/factorial?n=05" | jq -e ".factorial == 120"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=5 响应 `.factorial | type == "number"`（PRD Response Schema field type 验证）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4108 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4108/factorial?n=5" | jq -e ".factorial | type == \"number\""; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=3 响应顶层 keys 严格等于 `["factorial"]`（PRD Response Schema 完整性验证）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4109 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4109/factorial?n=3" | jq -e "keys == [\"factorial\"]"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=4 响应不含禁用字段 `product`（W20 字段名复读漂移反向探针）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4110 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4110/factorial?n=4" | jq -e "has(\"product\") | not"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=4 响应不含禁用字段 `result`（generic 漂移反向探针）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4111 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4111/factorial?n=4" | jq -e "has(\"result\") | not"; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=4 响应不含禁用字段 `value` / `fact` / `output` / `sum`（4 个同义反向探针一次跑）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4112 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://127.0.0.1:4112/factorial?n=4"); echo "$RESP" | jq -e "has(\"value\") | not" > /dev/null && echo "$RESP" | jq -e "has(\"fact\") | not" > /dev/null && echo "$RESP" | jq -e "has(\"output\") | not" > /dev/null && echo "$RESP" | jq -e "has(\"sum\") | not" > /dev/null; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] 跨调用递推不变量 `factorial(5) === 5 * factorial(4)` （W24 核心 oracle 探针）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4113 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; F5=$(curl -fs "http://127.0.0.1:4113/factorial?n=5" | jq -r ".factorial"); F4=$(curl -fs "http://127.0.0.1:4113/factorial?n=4" | jq -r ".factorial"); kill $SPID 2>/dev/null; [ "$F5" = "120" ] && [ "$F4" = "24" ] && [ "$((5 * F4))" = "$F5" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 跨调用递推不变量边界 `factorial(18) === 18 * factorial(17)` （精度上界 oracle）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4114 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; F18=$(curl -fs "http://127.0.0.1:4114/factorial?n=18" | jq -r ".factorial"); F17=$(curl -fs "http://127.0.0.1:4114/factorial?n=17" | jq -r ".factorial"); kill $SPID 2>/dev/null; [ "$F18" = "6402373705728000" ] && [ "$F17" = "355687428096000" ] && [ "$((18 * F17))" = "$F18" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 跨调用递推不变量中段 `factorial(10) === 10 * factorial(9)` （中位数 oracle 加固）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4115 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; F10=$(curl -fs "http://127.0.0.1:4115/factorial?n=10" | jq -r ".factorial"); F9=$(curl -fs "http://127.0.0.1:4115/factorial?n=9" | jq -r ".factorial"); kill $SPID 2>/dev/null; [ "$F10" = "3628800" ] && [ "$F9" = "362880" ] && [ "$((10 * F9))" = "$F10" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=19 → 400 + body 不含 `factorial`（上界拒 #1，> Number.MAX_SAFE_INTEGER 起点）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4116 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/r4116.json -w "%{http_code}" "http://127.0.0.1:4116/factorial?n=19"); HAS=$(jq "has(\"factorial\")" < /tmp/r4116.json); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$HAS" = "false" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=20 → 400（上界拒 #2）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4117 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4117/factorial?n=20"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=100 → 400（上界拒 #3，远超上界）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4118 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4118/factorial?n=100"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial (无 query) → 400 + body 不含 `factorial`（缺参拒）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4119 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/r4119.json -w "%{http_code}" "http://127.0.0.1:4119/factorial"); HAS=$(jq "has(\"factorial\")" < /tmp/r4119.json); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$HAS" = "false" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?value=5 → 400（PRD 禁用 query 名反向探针：generator 不许漂移到 `value`/`num`/`x` 等同义词）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4120 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4120/factorial?value=5"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?num=5 → 400（PRD 禁用 query 名反向探针 #2）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4121 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4121/factorial?num=5"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=-1 → 400（strict 拒负数）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4122 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4122/factorial?n=-1"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=5.5 → 400（strict 拒小数；防 generator 复用 `^-?\\d+(\\.\\d+)?$` 浮点 regex 假绿）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4123 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4123/factorial?n=5.5"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=5.0 → 400（strict 拒浮点形整数，"整数 only"严格）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4124 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4124/factorial?n=5.0"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=1e2 → 400（strict 拒科学计数法，防 Number("1e2")===100 假绿）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4125 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4125/factorial?n=1e2"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=0xff → 400（strict 拒十六进制）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4126 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4126/factorial?n=0xff"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=abc → 400 + body 不含 `factorial`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4127 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/r4127.json -w "%{http_code}" "http://127.0.0.1:4127/factorial?n=abc"); HAS=$(jq "has(\"factorial\")" < /tmp/r4127.json); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$HAS" = "false" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /factorial?n=Infinity → 400（strict 拒 Infinity 字面量，防 Number 隐式解析）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4128 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4128/factorial?n=Infinity"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 错误响应 schema 严格 — `keys == ["error"]` 且 `.error | type == "string" and length > 0`，body 不含 `factorial` 与 `message`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4129 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; RESP=$(curl -s "http://127.0.0.1:4129/factorial?n=abc"); echo "$RESP" | jq -e "keys == [\"error\"]" > /dev/null && echo "$RESP" | jq -e ".error | type == \"string\" and length > 0" > /dev/null && echo "$RESP" | jq -e "has(\"factorial\") | not" > /dev/null && echo "$RESP" | jq -e "has(\"message\") | not" > /dev/null; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] 现有 6 路由回归 — `/health` `/sum` `/multiply` `/divide` `/power` `/modulo` happy 全 200
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=4130 node server.js > /dev/null 2>&1 & SPID=$!; sleep 2; curl -fs "http://127.0.0.1:4130/health" | jq -e ".ok == true" > /dev/null && curl -fs "http://127.0.0.1:4130/sum?a=2&b=3" | jq -e ".sum == 5" > /dev/null && curl -fs "http://127.0.0.1:4130/multiply?a=2&b=3" | jq -e ".product == 6" > /dev/null && curl -fs "http://127.0.0.1:4130/divide?a=6&b=2" | jq -e ".quotient == 3" > /dev/null && curl -fs "http://127.0.0.1:4130/power?a=2&b=10" | jq -e ".power == 1024" > /dev/null && curl -fs "http://127.0.0.1:4130/modulo?a=5&b=3" | jq -e ".remainder == 2" > /dev/null; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0
