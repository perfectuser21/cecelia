---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /uppercase 路由 + 单测 describe 块 + README 段

**范围**: 在 `playground/server.js` 加 `GET /uppercase`（query 名严格 text，strict-schema `^[A-Za-z]+$`，`text.toUpperCase()` 算术，返回 `{result, operation: "uppercase"}`）+ 在 `playground/tests/server.test.js` 加 `describe('GET /uppercase', ...)` 块 + 在 `playground/README.md` 端点列表加 `/uppercase` 段。零依赖。不动其他八条路由的代码、单测、README 段。
**大小**: S
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 注册 `app.get('/uppercase'`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/uppercase['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/uppercase` 路由含 strict-schema ASCII 字母正则 `^[A-Za-z]+$`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/\^\[A-Za-z\]\+\$/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/uppercase` 路由响应字面包含 `operation: 'uppercase'` 与字面 `result`（按 PR-G 死规则字面字段名）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/operation\s*:\s*['\"]uppercase['\"]/.test(c))process.exit(1);if(!/\bresult\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含独立 `describe('GET /uppercase'` 块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/uppercase['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 端点列表含 `/uppercase` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/uppercase/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 不引入新外部依赖（仅 express，零额外 import）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const imports=(c.match(/^import .+ from ['\"]([^'\"]+)['\"]/gm)||[]);const ext=imports.map(l=>l.match(/from ['\"]([^'\"]+)['\"]/)[1]).filter(p=>!p.startsWith('.'));const bad=ext.filter(p=>p!=='express');if(bad.length){console.error('引入新外部依赖:',bad);process.exit(1)}"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接执行）

- [ ] [BEHAVIOR] GET /uppercase?text=hello → 200 + `{result:"HELLO", operation:"uppercase"}` 严 schema（happy 全小写 + 字段值 + 字面 operation）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3201 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3201/uppercase?text=hello"); RC=0; echo "$RESP" | jq -e ".result == \"HELLO\"" > /dev/null || RC=1; echo "$RESP" | jq -e ".operation == \"uppercase\"" > /dev/null || RC=1; echo "$RESP" | jq -e ".result | type == \"string\"" > /dev/null || RC=1; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /uppercase?text=hello 响应顶层 keys 字面集合 == ["operation","result"]（schema 完整性，禁多余字段）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3202 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3202/uppercase?text=hello"); RC=0; echo "$RESP" | jq -e "(keys | sort) == [\"operation\",\"result\"]" > /dev/null || RC=1; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /uppercase?text=hello 响应不含任一禁用字段名（uppercased / upper / transformed / mapped / output / value / input / text / data / payload / sum / product / quotient / power / remainder / factorial / negation）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3203 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3203/uppercase?text=hello"); RC=0; for BAD in uppercased upper upper_text transformed transformed_text mapped output value input text data payload response answer out meta original sum product quotient power remainder factorial negation; do if echo "$RESP" | jq -e "has(\"$BAD\")" > /dev/null 2>&1; then echo "FAIL: 禁用字段 $BAD"; RC=1; fi; done; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /uppercase?text=hello123（含数字）→ 400 + error 非空 string + keys==["error"] + 无 result 无 operation（strict-schema 拒 + error 体严 schema）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3204 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/w34_dod_b4 -w "%{http_code}" "http://localhost:3204/uppercase?text=hello123"); RC=0; [ "$CODE" = "400" ] || { echo "FAIL code=$CODE"; RC=1; }; jq -e ".error | type == \"string\" and length > 0" < /tmp/w34_dod_b4 > /dev/null || { echo "FAIL error"; RC=1; }; jq -e "(keys | sort) == [\"error\"]" < /tmp/w34_dod_b4 > /dev/null || { echo "FAIL keys"; RC=1; }; jq -e "has(\"result\") | not" < /tmp/w34_dod_b4 > /dev/null || { echo "FAIL has result"; RC=1; }; jq -e "has(\"operation\") | not" < /tmp/w34_dod_b4 > /dev/null || { echo "FAIL has operation"; RC=1; }; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /uppercase?text=a（单字符 happy）→ 200 + `{result:"A", operation:"uppercase"}`（覆盖最小输入边界，generator 不许写"长度≥2 才认"）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3205 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3205/uppercase?text=a"); RC=0; echo "$RESP" | jq -e ".result == \"A\" and .operation == \"uppercase\"" > /dev/null || RC=1; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /uppercase?text=AbCdEf（混合大小写）→ 200 + `{result:"ABCDEF", operation:"uppercase"}`（逐字符映射正确）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3206 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3206/uppercase?text=AbCdEf"); RC=0; echo "$RESP" | jq -e ".result == \"ABCDEF\" and .operation == \"uppercase\"" > /dev/null || RC=1; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /uppercase?value=hello（错 query 名）→ 400（query 名必须严格 text，错名等同缺参）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3207 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/w34_dod_b7 -w "%{http_code}" "http://localhost:3207/uppercase?value=hello"); RC=0; [ "$CODE" = "400" ] || RC=1; jq -e "(keys | sort) == [\"error\"]" < /tmp/w34_dod_b7 > /dev/null || RC=1; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] GET /uppercase?text=hello&text=world（多 query 名）→ 400（拒多 text）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3208 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/w34_dod_b8 -w "%{http_code}" "http://localhost:3208/uppercase?text=hello&text=world"); RC=0; [ "$CODE" = "400" ] || RC=1; jq -e "(keys | sort) == [\"error\"]" < /tmp/w34_dod_b8 > /dev/null || RC=1; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] 8 路由回归 happy 全过（/health /sum /multiply /divide /factorial /increment）+ vitest 全套绿
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3209 node server.js & SPID=$!; sleep 2; RC=0; curl -fs "http://localhost:3209/health" | jq -e ".ok == true" > /dev/null || RC=1; curl -fs "http://localhost:3209/sum?a=2&b=3" | jq -e ".sum == 5" > /dev/null || RC=1; curl -fs "http://localhost:3209/multiply?a=7&b=5" | jq -e ".product == 35" > /dev/null || RC=1; curl -fs "http://localhost:3209/divide?a=10&b=2" | jq -e ".quotient == 5" > /dev/null || RC=1; curl -fs "http://localhost:3209/factorial?n=5" | jq -e ".factorial == 120" > /dev/null || RC=1; curl -fs "http://localhost:3209/increment?value=10" | jq -e ".result == 11 and .operation == \"increment\"" > /dev/null || RC=1; kill $SPID 2>/dev/null; [ $RC -eq 0 ] || exit 1; cd .. && npm --prefix playground test 2>&1 | tee /tmp/w34_vitest.log; grep -E "Test Files.*passed" /tmp/w34_vitest.log > /dev/null || exit 1; ! grep -E "Test Files.*failed|Tests.*failed" /tmp/w34_vitest.log > /dev/null'
  期望: exit 0
