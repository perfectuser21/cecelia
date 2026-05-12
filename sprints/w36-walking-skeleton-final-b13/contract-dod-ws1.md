---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /decrement endpoint

**范围**: `playground/server.js` 新增 `GET /decrement`（query 名 `value`，strict-schema `^-?\d+$`，`|Number(value)| > 9007199254740990` 显式拒，`Number(value) - 1` 算术，返回 `{result, operation: "decrement"}`）+ `playground/tests/server.test.js` 新增 `describe('GET /decrement', ...)` 块 + `playground/README.md` 新增 `/decrement` 段。
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `app.get('/decrement'` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes(\"app.get('/decrement'\"))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` /decrement 段含 strict-schema 整数正则 `^-?\d+$`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/\\/\\^-\\?\\\\d\\+\\$\\//.test(c) && !c.includes('^-?\\\\d+$'))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` /decrement 含上界数字 9007199254740990
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes('9007199254740990'))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` /decrement 算术表达式字面含减号（不是 `+ 1`）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\\.get\\('\\/decrement'[\\s\\S]*?app\\.get\\(/);const body=m?m[0]:'';if(!/-\\s*1/.test(body)||/\\+\\s*1/.test(body))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` /decrement 响应含字面 `operation: 'decrement'` 字符串
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/operation:\\s*['\\\"]decrement['\\\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /decrement'` 块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes(\"describe('GET /decrement\"))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 含 `/decrement` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/decrement'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] `GET /decrement?value=5` 返 `{result:4, operation:"decrement"}` 严 schema（值复算 + operation 字面字符串严格相等）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3201 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3201/decrement?value=5"); R=$(echo "$RESP" | jq -e ".result == 4 and .operation == \"decrement\"" && echo OK); kill $SPID 2>/dev/null; [ "$R" = "true
OK" ] || [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] `GET /decrement?value=5` 顶层 keys 字面 sort 集合恰好等于 `["operation","result"]`（schema 完整性 oracle，多/少 1 字段都失败）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3202 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3202/decrement?value=5"); R=$(echo "$RESP" | jq -e "keys | sort == [\"operation\",\"result\"]" && echo OK); kill $SPID 2>/dev/null; [ "$R" = "true
OK" ] || [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] `GET /decrement?value=5` 响应不含任一禁用字段名（PR-G 死规则黑名单反向 has() 全 false）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3203 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3203/decrement?value=5"); FAIL=0; for K in decremented previous prev predecessor n_minus_one minus_one pred dec decr decrementation subtraction value input output data payload response answer out meta sum product quotient power remainder factorial negation; do echo "$RESP" | jq -e --arg k "$K" "has(\$k) | not" > /dev/null || FAIL=1; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
  期望: exit 0

- [ ] [BEHAVIOR] off-by-one 防盲抄 W26 increment：`value=0 → result=-1`、`value=1 → result=0`（generator 抄 W26 `+1` 即 FAIL）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3204 node server.js & SPID=$!; sleep 2; R0=$(curl -fs "localhost:3204/decrement?value=0" | jq -e ".result == -1" && echo OK); R1=$(curl -fs "localhost:3204/decrement?value=1" | jq -e ".result == 0" && echo OK); kill $SPID 2>/dev/null; echo "$R0" | grep -q OK && echo "$R1" | grep -q OK'
  期望: exit 0

- [ ] [BEHAVIOR] 精度上下界 happy：`value=9007199254740990 → result=9007199254740989`、`value=-9007199254740990 → result=-9007199254740991`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3205 node server.js & SPID=$!; sleep 2; RU=$(curl -fs "localhost:3205/decrement?value=9007199254740990" | jq -e ".result == 9007199254740989" && echo OK); RD=$(curl -fs "localhost:3205/decrement?value=-9007199254740990" | jq -e ".result == -9007199254740991" && echo OK); kill $SPID 2>/dev/null; echo "$RU" | grep -q OK && echo "$RD" | grep -q OK'
  期望: exit 0

- [ ] [BEHAVIOR] 上下界拒：`value=9007199254740991 → 400`、`value=-9007199254740991 → 400`、`value=99999999999999999999 → 400`，且错误体顶层 keys = `["error"]`，不含 result/operation
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3206 node server.js & SPID=$!; sleep 2; FAIL=0; for V in "9007199254740991" "-9007199254740991" "99999999999999999999"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" --get --data-urlencode "value=$V" "localhost:3206/decrement"); [ "$CODE" = "400" ] || FAIL=1; done; RESP=$(curl -s "localhost:3206/decrement?value=9007199254740991"); echo "$RESP" | jq -e "keys | sort == [\"error\"]" > /dev/null || FAIL=1; echo "$RESP" | jq -e "has(\"result\") | not" > /dev/null || FAIL=1; echo "$RESP" | jq -e "has(\"operation\") | not" > /dev/null || FAIL=1; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
  期望: exit 0

- [ ] [BEHAVIOR] strict-schema 拒：小数 / 前导 + / 双重负号 / 科学计数法 / 十六进制 / 千分位 / 空格 / 空串 / 字母 / Infinity / NaN / 仅负号 共 14 类输入全 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3207 node server.js & SPID=$!; sleep 2; FAIL=0; for V in "1.5" "1.0" "+5" "--5" "5-" "1e2" "0xff" "1,000" "1 000" "" "abc" "Infinity" "NaN" "-"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" --get --data-urlencode "value=$V" "localhost:3207/decrement"); [ "$CODE" = "400" ] || { echo "MISS: $V got $CODE"; FAIL=1; }; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 错 query 名 + 缺参：`/decrement`（无参） → 400，`/decrement?n=5` → 400，`/decrement?a=5` → 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3208 node server.js & SPID=$!; sleep 2; FAIL=0; for U in "/decrement" "/decrement?n=5" "/decrement?a=5" "/decrement?x=5" "/decrement?value=5&extra=1"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3208$U"); [ "$CODE" = "400" ] || { echo "MISS: $U got $CODE"; FAIL=1; }; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 前导 0 happy（十进制归一化，非八进制解析）：`value=01 → result=0`、`value=-01 → result=-2`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3209 node server.js & SPID=$!; sleep 2; R1=$(curl -fs "localhost:3209/decrement?value=01" | jq -e ".result == 0 and .operation == \"decrement\"" && echo OK); R2=$(curl -fs "localhost:3209/decrement?value=-01" | jq -e ".result == -2" && echo OK); kill $SPID 2>/dev/null; echo "$R1" | grep -q OK && echo "$R2" | grep -q OK'
  期望: exit 0

- [ ] [BEHAVIOR] 8 路由回归：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 各 1 条 happy 仍 200 且字段名不变
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3210 node server.js & SPID=$!; sleep 2; FAIL=0; curl -fs "localhost:3210/health" | jq -e ".ok == true" > /dev/null || FAIL=1; curl -fs "localhost:3210/sum?a=3&b=4" | jq -e ".sum == 7" > /dev/null || FAIL=1; curl -fs "localhost:3210/multiply?a=3&b=4" | jq -e ".product == 12" > /dev/null || FAIL=1; curl -fs "localhost:3210/divide?a=12&b=4" | jq -e ".quotient == 3" > /dev/null || FAIL=1; curl -fs "localhost:3210/power?a=2&b=10" | jq -e ".power == 1024" > /dev/null || FAIL=1; curl -fs "localhost:3210/modulo?a=10&b=3" | jq -e ".remainder == 1" > /dev/null || FAIL=1; curl -fs "localhost:3210/factorial?n=5" | jq -e ".factorial == 120" > /dev/null || FAIL=1; curl -fs "localhost:3210/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\"" > /dev/null || FAIL=1; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
  期望: exit 0
