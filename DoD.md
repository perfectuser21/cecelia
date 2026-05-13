contract_branch: cp-harness-propose-r1-fd65b41a
workstream_index: 1
sprint_dir: sprints/w39-walking-skeleton-final-b17

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /negate (Round 1)

**范围**: `playground/server.js` 加 `/negate` 路由 + `playground/tests/server.test.js` 加 `describe('GET /negate')` + `playground/README.md` 加 `/negate` 段
**大小**: S (<100 行净增 / ≤ 3 文件)
**依赖**: 无

**纯度备注 (CI check-dod-purity.cjs 协议)**: BEHAVIOR 条目不带 `- [ ]`/`- [x]` 前缀（避开 Rule 1 `/^\s*-\s*\[[\sxX]\]\s*\[BEHAVIOR\]/` 正则）；Test 字段统一 `manual:bash`（Rule 2 白名单）。jq 捕获用 `>/dev/null 2>&1 && echo OK` 避免把 `true\n` 与 `OK` 同时捕进变量造成恒不等（W37 实证 patch）。

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 注册 `app.get('/negate'` 路由
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/negate['\"]/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/negate` 路由含 strict-schema 整数正则 `^-?\d+$` 与精度上界数字 9007199254740991（MAX_SAFE_INTEGER）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/9007199254740991/.test(c)||!/\^-\?\\\\d\+\$/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /negate'` 独立块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(\s*['\"]GET \/negate/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/README.md` 含 `/negate` 端点段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/negate/.test(c))process.exit(1)"

## BEHAVIOR 索引（evaluator 真启 server + curl + jq 实跑）

[BEHAVIOR] `GET /negate?value=5` 返 200 + `{result:-5, operation:"negate"}`（字段值字面）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3401 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3401/negate?value=5"); R=$(echo "$RESP" | jq -e ".result == -5 and .operation == \"negate\"" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

[BEHAVIOR] success 响应顶层 keys 严格等于 `["operation","result"]`（schema 完整性）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3402 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3402/negate?value=5"); R=$(echo "$RESP" | jq -e "keys == [\"operation\",\"result\"]" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

[BEHAVIOR] success 响应反向不含任一禁用字段名（PRD 完整 21 个：`negation`/`negated`/`minus`/`opposite`/`flip`/`invert`/`inverse`/`incremented`/`decremented`/`prev`/`predecessor`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`value`/`input`/`output`/`data`/`payload`/`answer`/`meta`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3403 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3403/negate?value=5"); FAIL=0; for k in negation negated minus opposite flip invert inverse incremented decremented prev predecessor sum product quotient power remainder factorial value input output data payload answer meta; do if echo "$RESP" | jq -e "has(\"$k\")" >/dev/null 2>&1; then echo "FAIL: $k present"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

[BEHAVIOR] success 响应 `operation` 字面字符串 `"negate"`，PRD 禁用 9 变体（`neg`/`negation`/`negated`/`minus`/`opposite`/`flip`/`invert`/`inverse`/`unary_minus`）一律不等
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3404 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3404/negate?value=5"); FAIL=0; for v in neg negation negated minus opposite flip invert inverse unary_minus; do if ! echo "$RESP" | jq -e ".operation != \"$v\"" >/dev/null 2>&1; then echo "FAIL: operation 漂到 $v"; FAIL=1; fi; done; echo "$RESP" | jq -e ".operation == \"negate\"" >/dev/null 2>&1 || { echo "FAIL: operation 非字面 negate"; FAIL=1; }; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

[BEHAVIOR] 错误路径 `GET /negate?value=foo` 返 400 + error body 顶层 keys 严格等于 `["error"]` 且不含 `result`/`operation`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3405 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3405/negate?value=foo"); RESP=$(curl -s "localhost:3405/negate?value=foo"); R=$(echo "$RESP" | jq -e "keys == [\"error\"] and (.error | type == \"string\" and length > 0)" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$R" = "OK" ]'
  期望: exit 0

[BEHAVIOR] 错误体反向不含 4 个 PRD 禁用替代错误名（`message`/`msg`/`reason`/`detail`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3406 node server.js & SPID=$!; sleep 2; RESP=$(curl -s "localhost:3406/negate?value=foo"); FAIL=0; for k in message msg reason detail; do if echo "$RESP" | jq -e "has(\"$k\")" >/dev/null 2>&1; then echo "FAIL: error body 含 $k"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

[BEHAVIOR] 精度上下界 happy：`value=9007199254740991` (MAX_SAFE) → 200 + `{result:-9007199254740991,operation:"negate"}`；`value=-9007199254740991` (-MAX_SAFE) → 200 + `{result:9007199254740991,operation:"negate"}`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3407 node server.js & SPID=$!; sleep 2; R1=$(curl -fs "localhost:3407/negate?value=9007199254740991" | jq -e ".result == -9007199254740991 and .operation == \"negate\"" >/dev/null 2>&1 && echo OK); R2=$(curl -fs "localhost:3407/negate?value=-9007199254740991" | jq -e ".result == 9007199254740991 and .operation == \"negate\"" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R1" = "OK" ] && [ "$R2" = "OK" ]'
  期望: exit 0

[BEHAVIOR] 精度越界拒：`value=9007199254740992` (MAX_SAFE+1) → 400；`value=-9007199254740992` → 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3408 node server.js & SPID=$!; sleep 2; C1=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3408/negate?value=9007199254740992"); C2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3408/negate?value=-9007199254740992"); kill $SPID 2>/dev/null; [ "$C1" = "400" ] && [ "$C2" = "400" ]'
  期望: exit 0

[BEHAVIOR] strict-schema 全部非法输入返 400：`value=1.5` / `value=1e2` / `value=abc` / `value=+5` / `value=0x10` / `value=Infinity` / `value=NaN` / `value=1,000` / `value=` / 缺 value
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3409 node server.js & SPID=$!; sleep 2; FAIL=0; for q in "value=1.5" "value=1e2" "value=abc" "value=+5" "value=0x10" "value=Infinity" "value=NaN" "value=1,000" "value=" ""; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3409/negate?$q"); if [ "$CODE" != "400" ]; then echo "FAIL: $q expect 400 got $CODE"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

[BEHAVIOR] PRD 完整 9 个禁用 query 名（`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`）一律返 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3410 node server.js & SPID=$!; sleep 2; FAIL=0; for q in "n=5" "x=5" "a=5" "b=5" "num=5" "number=5" "input=5" "v=5" "val=5"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3410/negate?$q"); if [ "$CODE" != "400" ]; then echo "FAIL: 禁用 query $q expect 400 got $CODE"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

[BEHAVIOR] `value=0` 边界 happy：返 200 + `{result:0, operation:"negate"}`；JSON body 不漂成 `-0` / `-0.0` / `0.0`（grep 反向断言）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3411 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3411/negate?value=0"); FAIL=0; echo "$RESP" | jq -e ".result == 0 and .operation == \"negate\" and (keys == [\"operation\",\"result\"])" >/dev/null 2>&1 || { echo "FAIL: value=0 schema 不达 $RESP"; FAIL=1; }; if echo "$RESP" | grep -E "\"result\":\\s*-0\\b" >/dev/null; then echo "FAIL: value=0 result 漂 -0：$RESP"; FAIL=1; fi; if echo "$RESP" | grep -E "\"result\":\\s*-?0\\.0" >/dev/null; then echo "FAIL: value=0 result 漂 0.0/-0.0：$RESP"; FAIL=1; fi; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

[BEHAVIOR] 8 路由回归 happy 全通过（/health /sum /multiply /divide /power /modulo /increment /decrement /factorial）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3412 node server.js & SPID=$!; sleep 2; FAIL=0; [ "$(curl -s -o /dev/null -w "%{http_code}" "localhost:3412/health")" = "200" ] || FAIL=1; curl -fs "localhost:3412/sum?a=2&b=3" | jq -e ".sum == 5" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3412/multiply?a=7&b=5" | jq -e ".product == 35" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3412/divide?a=10&b=2" | jq -e ".quotient == 5" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3412/power?a=2&b=10" | jq -e ".power == 1024" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3412/modulo?a=10&b=3" | jq -e ".remainder == 1" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3412/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\"" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3412/decrement?value=5" | jq -e ".result == 4 and .operation == \"decrement\"" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3412/factorial?n=5" | jq -e ".factorial == 120" >/dev/null 2>&1 || FAIL=1; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0
