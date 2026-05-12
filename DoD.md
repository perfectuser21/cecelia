contract_branch: cp-harness-propose-r2-78b3578b
workstream_index: 1
sprint_dir: sprints/w37-walking-skeleton-final-b14

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /decrement (Round 2)

**范围**: `playground/server.js` 加 `/decrement` 路由 + `playground/tests/server.test.js` 加 `describe('GET /decrement')` + `playground/README.md` 加 `/decrement` 段
**大小**: S (<100 行净增 / ≤ 3 文件)
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 注册 `app.get('/decrement'` 路由
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/decrement['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 路由含 strict-schema 整数正则 `^-?\d+$` 与精度上界数字 9007199254740990
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/9007199254740990/.test(c)||!/\^-\?\\\\d\+\$/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /decrement'` 独立块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(\s*['\"]GET \/decrement/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 含 `/decrement` 端点段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/decrement/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行；vitest 不被 evaluator 读）

- [ ] [BEHAVIOR] `GET /decrement?value=5` 返 200 + `{result:4, operation:"decrement"}`（字段值字面）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3201 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3201/decrement?value=5"); R=$(echo "$RESP" | jq -e ".result == 4 and .operation == \"decrement\"" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] success 响应顶层 keys 严格等于 `["operation","result"]`（schema 完整性）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3202 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3202/decrement?value=5"); R=$(echo "$RESP" | jq -e "keys == [\"operation\",\"result\"]" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] success 响应反向不含任一禁用字段名（PRD 完整 19 个：`decremented`/`prev`/`predecessor`/`minus_one`/`sub_one`/`incremented`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`negation`/`value`/`input`/`output`/`data`/`payload`/`answer`/`meta`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3203 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3203/decrement?value=5"); FAIL=0; for k in decremented prev predecessor minus_one sub_one incremented sum product quotient power remainder factorial negation value input output data payload answer meta; do if echo "$RESP" | jq -e "has(\"$k\")" >/dev/null 2>&1; then echo "FAIL: $k present"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] success 响应 `operation` 字面字符串 `"decrement"`，PRD 禁用 8 变体（`dec`/`decr`/`decremented`/`prev`/`previous`/`predecessor`/`minus_one`/`sub_one`）一律不等（Round-2 新增）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3210 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3210/decrement?value=5"); FAIL=0; for v in dec decr decremented prev previous predecessor minus_one sub_one; do if ! echo "$RESP" | jq -e ".operation != \"$v\"" >/dev/null 2>&1; then echo "FAIL: operation 漂到 $v"; FAIL=1; fi; done; ! echo "$RESP" | jq -e ".operation == \"decrement\"" >/dev/null 2>&1 && { echo "FAIL: operation 非字面 decrement"; FAIL=1; }; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] 错误路径 `GET /decrement?value=foo` 返 400 + error body 顶层 keys 严格等于 `["error"]` 且不含 `result`/`operation`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3204 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3204/decrement?value=foo"); RESP=$(curl -s "localhost:3204/decrement?value=foo"); R=$(echo "$RESP" | jq -e "keys == [\"error\"] and (.error | type == \"string\" and length > 0)" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 错误体反向不含 4 个 PRD 禁用替代错误名（`message`/`msg`/`reason`/`detail`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3211 node server.js & SPID=$!; sleep 2; RESP=$(curl -s "localhost:3211/decrement?value=foo"); FAIL=0; for k in message msg reason detail; do if echo "$RESP" | jq -e "has(\"$k\")" >/dev/null 2>&1; then echo "FAIL: error body 含 $k"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] 精度上下界 happy：`value=9007199254740990` → 200 + `{result:9007199254740989,operation:"decrement"}`；`value=-9007199254740990` → 200 + `{result:-9007199254740991,operation:"decrement"}`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3205 node server.js & SPID=$!; sleep 2; R1=$(curl -fs "localhost:3205/decrement?value=9007199254740990" | jq -e ".result == 9007199254740989 and .operation == \"decrement\"" 2>/dev/null && echo OK); R2=$(curl -fs "localhost:3205/decrement?value=-9007199254740990" | jq -e ".result == -9007199254740991 and .operation == \"decrement\"" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R1" = "OK" ] && [ "$R2" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 精度上下界拒：`value=9007199254740991` → 400；`value=-9007199254740991` → 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3206 node server.js & SPID=$!; sleep 2; C1=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement?value=9007199254740991"); C2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement?value=-9007199254740991"); kill $SPID 2>/dev/null; [ "$C1" = "400" ] && [ "$C2" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] strict-schema 全部非法输入返 400：`value=1.5` / `value=1e2` / `value=abc` / `value=+5` / `value=` / 缺 value
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3207 node server.js & SPID=$!; sleep 2; FAIL=0; for q in "value=1.5" "value=1e2" "value=abc" "value=+5" "value=" ""; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3207/decrement?$q"); if [ "$CODE" != "400" ]; then echo "FAIL: $q expect 400 got $CODE"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] PRD 完整 9 个禁用 query 名（`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`）一律返 400（Round-2 新增 — Reviewer Issue 5）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3212 node server.js & SPID=$!; sleep 2; FAIL=0; for q in "n=5" "x=5" "a=5" "b=5" "num=5" "number=5" "input=5" "v=5" "val=5"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3212/decrement?$q"); if [ "$CODE" != "400" ]; then echo "FAIL: 禁用 query $q expect 400 got $CODE"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] 8 路由回归 happy 全通过（/health /sum /multiply /divide /power /modulo /increment /factorial）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3208 node server.js & SPID=$!; sleep 2; FAIL=0; [ "$(curl -s -o /dev/null -w "%{http_code}" "localhost:3208/health")" = "200" ] || FAIL=1; curl -fs "localhost:3208/sum?a=2&b=3" | jq -e ".sum == 5" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3208/multiply?a=7&b=5" | jq -e ".product == 35" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3208/divide?a=10&b=2" | jq -e ".quotient == 5" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3208/power?a=2&b=10" | jq -e ".power == 1024" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3208/modulo?a=10&b=3" | jq -e ".remainder == 1" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3208/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\"" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3208/factorial?n=5" | jq -e ".factorial == 120" >/dev/null 2>&1 || FAIL=1; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0
