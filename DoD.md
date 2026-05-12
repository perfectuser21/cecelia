contract_branch: cp-harness-propose-r1-bc8ff9f0
workstream_index: 1
sprint_dir: sprints/w38-walking-skeleton-final-b15

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /abs (Round 1)

**范围**: `playground/server.js` 加 `/abs` 路由 + `playground/tests/server.test.js` 加 `describe('GET /abs')` + `playground/README.md` 加 `/abs` 段
**大小**: S (<100 行净增 / ≤ 3 文件)
**依赖**: 无

**FIX 备注 (W38 B15 verdict regex 修后 final happy 真验)**: 沿用 W37 /decrement Round-2 的合同结构（已经被 evaluator + final_evaluate 真验证过）；replace 全部 `/decrement`→`/abs`、`decrement`→`abs`、operation 8 变体清单、result 公式从 `N-1` 换成 `Math.abs(N)`、9 路由回归现在含 W37 已上线的 `/decrement`。BEHAVIOR 段每条带 `Test: manual:bash` 内嵌命令而非"索引指向 vitest"，evaluator v1.1 直接执行判 PASS/FAIL。

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 注册 `app.get('/abs'` 路由
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/abs['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/abs` 路由含 strict-schema 整数正则 `^-?\d+$` 与精度上界数字 9007199254740990
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/9007199254740990/.test(c)||!/\^-\?\\\\d\+\$/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /abs'` 独立块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(\s*['\"]GET \/abs/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 含 `/abs` 端点段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/abs/.test(c))process.exit(1)"

## BEHAVIOR 条目（evaluator 真启 server + curl + jq 实跑；v7.4 + Bug 9 修后 ≥ 4 条必备覆盖 4 类）

- [ ] [BEHAVIOR] `GET /abs?value=-5` 返 200 + `{result:5, operation:"abs"}`（字段值字面 — schema 字段值 类）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3401 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3401/abs?value=-5"); R=$(echo "$RESP" | jq -e ".result == 5 and .operation == \"abs\"" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] success 响应顶层 keys 严格等于 `["operation","result"]`（keys 完整性 类）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3402 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3402/abs?value=-5"); R=$(echo "$RESP" | jq -e "keys == [\"operation\",\"result\"]" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] success 响应反向不含任一禁用字段名（PRD 完整 23 个：`absolute`/`absoluteValue`/`abs_value`/`magnitude`/`modulus`/`positive`/`absval`/`abs_val`/`decremented`/`incremented`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`negation`/`value`/`input`/`output`/`data`/`payload`/`answer`/`meta` — 禁用字段反向 类）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3403 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3403/abs?value=-5"); FAIL=0; for k in absolute absoluteValue abs_value magnitude modulus positive absval abs_val decremented incremented sum product quotient power remainder factorial negation value input output data payload answer meta; do if echo "$RESP" | jq -e "has(\"$k\")" >/dev/null 2>&1; then echo "FAIL: $k present"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] success 响应 `operation` 字面字符串 `"abs"`，PRD 禁用 8 变体（`absolute`/`absoluteValue`/`abs_value`/`magnitude`/`modulus`/`positive`/`absval`/`abs_val`）一律不等
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3410 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3410/abs?value=-5"); FAIL=0; for v in absolute absoluteValue abs_value magnitude modulus positive absval abs_val; do if ! echo "$RESP" | jq -e ".operation != \"$v\"" >/dev/null 2>&1; then echo "FAIL: operation 漂到 $v"; FAIL=1; fi; done; if ! echo "$RESP" | jq -e ".operation == \"abs\"" >/dev/null 2>&1; then echo "FAIL: operation 非字面 abs"; FAIL=1; fi; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] 错误路径 `GET /abs?value=foo` 返 400 + error body 顶层 keys 严格等于 `["error"]` 且不含 `result`/`operation`（error path 类）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3404 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3404/abs?value=foo"); RESP=$(curl -s "localhost:3404/abs?value=foo"); R=$(echo "$RESP" | jq -e "keys == [\"error\"] and (.error | type == \"string\" and length > 0)" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 错误体反向不含 4 个 PRD 禁用替代错误名（`message`/`msg`/`reason`/`detail`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3411 node server.js & SPID=$!; sleep 2; RESP=$(curl -s "localhost:3411/abs?value=foo"); FAIL=0; for k in message msg reason detail; do if echo "$RESP" | jq -e "has(\"$k\")" >/dev/null 2>&1; then echo "FAIL: error body 含 $k"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] 精度上下界 happy：`value=9007199254740990` → 200 + `{result:9007199254740990,operation:"abs"}`；`value=-9007199254740990` → 200 + `{result:9007199254740990,operation:"abs"}`（abs 保模 → 两端均 9007199254740990）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3405 node server.js & SPID=$!; sleep 2; R1=$(curl -fs "localhost:3405/abs?value=9007199254740990" | jq -e ".result == 9007199254740990 and .operation == \"abs\"" >/dev/null 2>&1 && echo OK); R2=$(curl -fs "localhost:3405/abs?value=-9007199254740990" | jq -e ".result == 9007199254740990 and .operation == \"abs\"" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R1" = "OK" ] && [ "$R2" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 精度上下界拒：`value=9007199254740991` → 400；`value=-9007199254740991` → 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3406 node server.js & SPID=$!; sleep 2; C1=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3406/abs?value=9007199254740991"); C2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3406/abs?value=-9007199254740991"); kill $SPID 2>/dev/null; [ "$C1" = "400" ] && [ "$C2" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] strict-schema 全部非法输入返 400：`value=1.5` / `value=1e2` / `value=abc` / `value=+5` / `value=` / 缺 value
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3407 node server.js & SPID=$!; sleep 2; FAIL=0; for q in "value=1.5" "value=1e2" "value=abc" "value=+5" "value=" ""; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3407/abs?$q"); if [ "$CODE" != "400" ]; then echo "FAIL: $q expect 400 got $CODE"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] PRD 完整 9 个禁用 query 名（`n`/`x`/`a`/`b`/`num`/`number`/`input`/`v`/`val`）一律返 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3412 node server.js & SPID=$!; sleep 2; FAIL=0; for q in "n=5" "x=5" "a=5" "b=5" "num=5" "number=5" "input=5" "v=5" "val=5"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3412/abs?$q"); if [ "$CODE" != "400" ]; then echo "FAIL: 禁用 query $q expect 400 got $CODE"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] 9 路由回归 happy 全通过（/health /sum /multiply /divide /power /modulo /increment /decrement /factorial）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3408 node server.js & SPID=$!; sleep 2; FAIL=0; [ "$(curl -s -o /dev/null -w "%{http_code}" "localhost:3408/health")" = "200" ] || FAIL=1; curl -fs "localhost:3408/sum?a=2&b=3" | jq -e ".sum == 5" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3408/multiply?a=7&b=5" | jq -e ".product == 35" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3408/divide?a=10&b=2" | jq -e ".quotient == 5" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3408/power?a=2&b=10" | jq -e ".power == 1024" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3408/modulo?a=10&b=3" | jq -e ".remainder == 1" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3408/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\"" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3408/decrement?value=5" | jq -e ".result == 4 and .operation == \"decrement\"" >/dev/null 2>&1 || FAIL=1; curl -fs "localhost:3408/factorial?n=5" | jq -e ".factorial == 120" >/dev/null 2>&1 || FAIL=1; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0
