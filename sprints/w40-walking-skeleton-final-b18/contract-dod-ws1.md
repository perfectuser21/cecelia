---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /negate

**范围**: `playground/server.js` 新增 `GET /negate` 路由；`playground/tests/server.test.js` 新增 `describe('GET /negate')` 块；`playground/README.md` 补 `/negate` 段
**大小**: S（< 80 行净增）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 包含 `app.get('/negate'` 路由注册（字面字符串）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8'); if(!c.includes(\"app.get('/negate'\"))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] `playground/tests/server.test.js` 包含 `describe('GET /negate'` 测试块（字面字符串）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8'); if(!c.includes(\"describe('GET /negate'\"))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] `playground/README.md` 含 `/negate` 段（字面字符串 `GET /negate`）
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8'); if(!c.includes('GET /negate'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] `playground/tests/server.test.js` 自验 vitest 全绿（B18 self-verify 红线）
  Test: manual:bash -c 'cd playground && npm test --silent 2>&1 | tail -5 | grep -E "Tests.*passed|Test Files.*passed" > /dev/null'
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] GET /negate?value=5 返 200 + `{result:-5, operation:"negate"}` 字面严等
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3301 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3301/negate?value=5"); echo "$RESP" | jq -e ".result == -5 and .operation == \"negate\"" > /tmp/.dod.b1 2>&1; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] success 响应顶层 keys 完全等于 `["operation","result"]`（不多不少）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3302 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3302/negate?value=5"); echo "$RESP" | jq -e "(keys | sort) == [\"operation\",\"result\"]" > /tmp/.dod.b2 2>&1; RC=$?; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] success 响应反向不含 22 个 PRD 禁用响应字段名（negation/neg/negative/opposite/invert/inverted/minus/flipped/incremented/decremented/sum/product/quotient/power/remainder/factorial/value/input/output/data/payload/answer/meta）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3303 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3303/negate?value=5"); RC=0; for k in negation neg negative opposite invert inverted minus flipped incremented decremented sum product quotient power remainder factorial value input output data payload answer meta; do echo "$RESP" | jq -e --arg k "$k" "has(\$k) | not" > /dev/null || { echo "leaked: $k"; RC=1; break; }; done; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] success 响应 operation 字面 `"negate"`，PRD 禁用 8 变体（negation/neg/negative/opposite/invert/flip/minus/unary_minus）一律不等
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3304 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3304/negate?value=5"); echo "$RESP" | jq -e ".operation == \"negate\"" > /dev/null || { kill $SPID; exit 1; }; RC=0; for v in negation neg negative opposite invert flip minus unary_minus; do echo "$RESP" | jq -e --arg v "$v" ".operation != \$v" > /dev/null || { echo "op leaked: $v"; RC=1; break; }; done; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] -0 规范化：`value=0` 和 `value=-0` 都返 `result:0` 且 JSON 字面不含 `"result":-0`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3305 node server.js & SPID=$!; sleep 2; B1=$(curl -fs "localhost:3305/negate?value=0"); B2=$(curl -fs "localhost:3305/negate?value=-0"); RC=0; echo "$B1" | jq -e ".result == 0" > /dev/null || RC=1; echo "$B2" | jq -e ".result == 0" > /dev/null || RC=1; echo "$B1" | grep -q "\"result\":-0" && { echo "raw -0 leaked from 0"; RC=1; }; echo "$B2" | grep -q "\"result\":-0" && { echo "raw -0 leaked from -0"; RC=1; }; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] 精度上下界 happy：`value=9007199254740990 → result=-9007199254740990`，`value=-9007199254740990 → result=9007199254740990`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3306 node server.js & SPID=$!; sleep 2; RC=0; curl -fs "localhost:3306/negate?value=9007199254740990" | jq -e ".result == -9007199254740990" > /dev/null || RC=1; curl -fs "localhost:3306/negate?value=-9007199254740990" | jq -e ".result == 9007199254740990" > /dev/null || RC=1; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] 精度超界拒：`value=9007199254740991` 和 `value=-9007199254740991` 都返 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3307 node server.js & SPID=$!; sleep 2; C1=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3307/negate?value=9007199254740991"); C2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3307/negate?value=-9007199254740991"); kill $SPID 2>/dev/null; [ "$C1" = "400" ] && [ "$C2" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 11 个 PRD 禁用 query 名（n/x/a/b/num/number/input/v/val/neg/target）一律 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3308 node server.js & SPID=$!; sleep 2; RC=0; for q in n x a b num number input v val neg target; do C=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3308/negate?$q=5"); [ "$C" = "400" ] || { echo "forbidden-query $q got $C"; RC=1; break; }; done; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] strict-schema 非法字面（`1.5`/`1e2`/`abc`/`+5`/空串/`0x10`/`Infinity`/`NaN`）一律 400 + 缺 query 也 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3309 node server.js & SPID=$!; sleep 2; RC=0; for v in "1.5" "1e2" "abc" "+5" "" "0x10" "Infinity" "NaN"; do C=$(curl -s -o /dev/null -w "%{http_code}" --data-urlencode "value=$v" -G "localhost:3309/negate"); [ "$C" = "400" ] || { echo "bad $v got $C"; RC=1; break; }; done; CM=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3309/negate"); [ "$CM" = "400" ] || { echo "missing got $CM"; RC=1; }; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0

- [ ] [BEHAVIOR] error path：`value=foo` → 400 + body keys 严等 `["error"]` + error 是非空 string + 反向不含 result/operation/message/msg/reason/detail
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3310 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3310/negate?value=foo"); [ "$CODE" = "400" ] || { kill $SPID; echo "code=$CODE"; exit 1; }; BODY=$(curl -s "localhost:3310/negate?value=foo"); RC=0; echo "$BODY" | jq -e "(keys | sort) == [\"error\"]" > /dev/null || { echo "keys not [error]"; RC=1; }; echo "$BODY" | jq -e ".error | type == \"string\" and length > 0" > /dev/null || { echo "error type/empty"; RC=1; }; for k in result operation message msg reason detail; do echo "$BODY" | jq -e --arg k "$k" "has(\$k) | not" > /dev/null || { echo "err leaked $k"; RC=1; break; }; done; kill $SPID 2>/dev/null; exit $RC'
  期望: exit 0
