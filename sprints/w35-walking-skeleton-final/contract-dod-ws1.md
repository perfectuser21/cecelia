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

## BEHAVIOR 条目（内嵌可执行 manual: 命令；evaluator 直接跑判 PASS/FAIL；v7.6 ≥ 4 阈值，实际 ≥ 18）

### 类型 1: schema 字段值（PRD Response Schema 字段逐项 codify）

- [x] [BEHAVIOR] GET /subtract?minuend=10&subtrahend=3 → 200 + result 字面等于 7（值复算严格相等）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3801 NODE_ENV=production node server.js > /tmp/w35-b1.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3801/subtract?minuend=10&subtrahend=3"); R=$(echo "$RESP" | jq -e ".result == 7" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=10&subtrahend=3 → operation 字面字符串严格等于 "subtract"（禁用变体 sub/subtraction/minus/diff）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3802 NODE_ENV=production node server.js > /tmp/w35-b2.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3802/subtract?minuend=10&subtrahend=3"); R=$(echo "$RESP" | jq -e ".operation == \"subtract\"" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=10&subtrahend=3 → result 类型为 number
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3803 NODE_ENV=production node server.js > /tmp/w35-b3.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3803/subtract?minuend=10&subtrahend=3"); R=$(echo "$RESP" | jq -e ".result | type == \"number\"" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

### 类型 2: keys 完整性（顶层 keys 字面集合 == ["operation","result"]）

- [x] [BEHAVIOR] GET /subtract?minuend=10&subtrahend=3 → 顶层 keys 字面集合等于 ["operation","result"]（不允许多余字段，不允许少字段）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3804 NODE_ENV=production node server.js > /tmp/w35-b4.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3804/subtract?minuend=10&subtrahend=3"); R=$(echo "$RESP" | jq -e "keys | sort == [\"operation\",\"result\"]" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

### 类型 3: 禁用字段反向（24 个禁用名一律 has(X) | not）

- [x] [BEHAVIOR] GET /subtract?minuend=10&subtrahend=3 → 响应不含首要禁用字段（difference/diff/subtraction/subtraction_result/sub_result/minus_result/minus/delta）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3805 NODE_ENV=production node server.js > /tmp/w35-b5.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3805/subtract?minuend=10&subtrahend=3"); OK=YES; for k in difference diff subtraction subtraction_result sub_result minus_result minus delta; do echo "$RESP" | jq -e "has(\"$k\") | not" >/dev/null || OK=NO; done; kill $SPID 2>/dev/null; [ "$OK" = "YES" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=10&subtrahend=3 → 响应不含 generic 禁用字段（value/input/output/data/payload/response/answer/out/meta）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3806 NODE_ENV=production node server.js > /tmp/w35-b6.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3806/subtract?minuend=10&subtrahend=3"); OK=YES; for k in value input output data payload response answer out meta; do echo "$RESP" | jq -e "has(\"$k\") | not" >/dev/null || OK=NO; done; kill $SPID 2>/dev/null; [ "$OK" = "YES" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=10&subtrahend=3 → 响应不含其他 endpoint 字段名（sum/product/quotient/power/remainder/factorial/negation）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3807 NODE_ENV=production node server.js > /tmp/w35-b7.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3807/subtract?minuend=10&subtrahend=3"); OK=YES; for k in sum product quotient power remainder factorial negation; do echo "$RESP" | jq -e "has(\"$k\") | not" >/dev/null || OK=NO; done; kill $SPID 2>/dev/null; [ "$OK" = "YES" ]'
  期望: exit 0

### 类型 4: error path（非法输入返 400 + error 字段 + 错误体 schema 完整）

- [x] [BEHAVIOR] GET /subtract?minuend=abc&subtrahend=3 → 400（strict 拒字母）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3808 NODE_ENV=production node server.js > /tmp/w35-b8.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3808/subtract?minuend=abc&subtrahend=3"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] 错误响应顶层 keys 字面集合等于 ["error"]，且 error 是非空字符串，body 不含 result 也不含 operation
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3809 NODE_ENV=production node server.js > /tmp/w35-b9.log 2>&1 & SPID=$!; sleep 2; curl -s "http://localhost:3809/subtract?minuend=abc&subtrahend=3" -o /tmp/w35-b9-err.json; R=$(jq -e "keys | sort == [\"error\"] and (.error | type == \"string\" and length > 0) and (has(\"result\") | not) and (has(\"operation\") | not)" /tmp/w35-b9-err.json >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

### 类型 5: 边界 happy（零边界 / off-by-one / 负结果 / 双负 / 浮点）

- [x] [BEHAVIOR] GET /subtract?minuend=0&subtrahend=0 → 200 + result==0（零边界）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3810 NODE_ENV=production node server.js > /tmp/w35-b10.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3810/subtract?minuend=0&subtrahend=0"); R=$(echo "$RESP" | jq -e ".result == 0 and .operation == \"subtract\"" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=5&subtrahend=5 → 200 + result==0（minuend===subtrahend 反 off-by-one；不是 ±1）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3811 NODE_ENV=production node server.js > /tmp/w35-b11.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3811/subtract?minuend=5&subtrahend=5"); R=$(echo "$RESP" | jq -e ".result == 0" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=5&subtrahend=10 → 200 + result==-5（负结果，防参数颠倒）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3812 NODE_ENV=production node server.js > /tmp/w35-b12.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3812/subtract?minuend=5&subtrahend=10"); R=$(echo "$RESP" | jq -e ".result == -5" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=-5&subtrahend=-3 → 200 + result==-2（双负输入）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3813 NODE_ENV=production node server.js > /tmp/w35-b13.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3813/subtract?minuend=-5&subtrahend=-3"); R=$(echo "$RESP" | jq -e ".result == -2" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=1.5&subtrahend=0.5 → 200 + result==1（浮点合法，IEEE 754 精确）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3814 NODE_ENV=production node server.js > /tmp/w35-b14.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3814/subtract?minuend=1.5&subtrahend=0.5"); R=$(echo "$RESP" | jq -e ".result == 1" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

### 类型 6: strict-schema 拒（10+ 类非法输入）

- [x] [BEHAVIOR] GET /subtract?minuend=1e2&subtrahend=1 → 400（strict 拒科学计数法）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3815 NODE_ENV=production node server.js > /tmp/w35-b15.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3815/subtract?minuend=1e2&subtrahend=1"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=0xff&subtrahend=1 → 400（strict 拒十六进制）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3816 NODE_ENV=production node server.js > /tmp/w35-b16.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3816/subtract?minuend=0xff&subtrahend=1"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=Infinity&subtrahend=1 → 400（strict 拒 Infinity 字面）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3817 NODE_ENV=production node server.js > /tmp/w35-b17.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3817/subtract?minuend=Infinity&subtrahend=1"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=NaN&subtrahend=1 → 400（strict 拒 NaN 字面）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3818 NODE_ENV=production node server.js > /tmp/w35-b18.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3818/subtract?minuend=NaN&subtrahend=1"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=&subtrahend=3 → 400（strict 拒空串）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3819 NODE_ENV=production node server.js > /tmp/w35-b19.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3819/subtract?minuend=&subtrahend=3"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=%2B5&subtrahend=3 → 400（strict 拒前导 +）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3820 NODE_ENV=production node server.js > /tmp/w35-b20.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3820/subtract?minuend=%2B5&subtrahend=3"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?minuend=--5&subtrahend=3 → 400（strict 拒双重负号）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3821 NODE_ENV=production node server.js > /tmp/w35-b21.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3821/subtract?minuend=--5&subtrahend=3"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

### 类型 7: 缺参 + 错 query 名拒

- [x] [BEHAVIOR] GET /subtract?minuend=10（缺 subtrahend）→ 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3822 NODE_ENV=production node server.js > /tmp/w35-b22.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3822/subtract?minuend=10"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?subtrahend=3（缺 minuend）→ 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3823 NODE_ENV=production node server.js > /tmp/w35-b23.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3823/subtract?subtrahend=3"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract（双缺）→ 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3824 NODE_ENV=production node server.js > /tmp/w35-b24.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3824/subtract"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?a=10&b=3（错 query 名 a/b — W22 强约束）→ 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3825 NODE_ENV=production node server.js > /tmp/w35-b25.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3825/subtract?a=10&b=3"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [x] [BEHAVIOR] GET /subtract?x=10&y=3（错 query 名 x/y）→ 400；GET /subtract?lhs=10&rhs=3（错 query 名 lhs/rhs）→ 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3826 NODE_ENV=production node server.js > /tmp/w35-b26.log 2>&1 & SPID=$!; sleep 2; C1=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3826/subtract?x=10&y=3"); C2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3826/subtract?lhs=10&rhs=3"); kill $SPID 2>/dev/null; [ "$C1" = "400" ] && [ "$C2" = "400" ]'
  期望: exit 0

### 类型 8: 8 路由回归（既有 endpoint 不被破坏）

- [x] [BEHAVIOR] 已有 8 路由 (/health /sum /multiply /divide /power /modulo /increment /factorial) happy 用例回归全通过
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3827 NODE_ENV=production node server.js > /tmp/w35-b27.log 2>&1 & SPID=$!; sleep 2; OK=YES; curl -fs "http://localhost:3827/health" | jq -e ".ok == true" >/dev/null || OK=NO; curl -fs "http://localhost:3827/sum?a=2&b=3" | jq -e ".sum == 5" >/dev/null || OK=NO; curl -fs "http://localhost:3827/multiply?a=2&b=3" | jq -e ".product == 6" >/dev/null || OK=NO; curl -fs "http://localhost:3827/divide?a=6&b=3" | jq -e ".quotient == 2" >/dev/null || OK=NO; curl -fs "http://localhost:3827/power?a=2&b=3" | jq -e ".power == 8" >/dev/null || OK=NO; curl -fs "http://localhost:3827/modulo?a=7&b=3" | jq -e ".remainder == 1" >/dev/null || OK=NO; curl -fs "http://localhost:3827/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\"" >/dev/null || OK=NO; curl -fs "http://localhost:3827/factorial?n=5" | jq -e ".factorial == 120" >/dev/null || OK=NO; kill $SPID 2>/dev/null; [ "$OK" = "YES" ]'
  期望: exit 0
