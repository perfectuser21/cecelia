contract_branch: cp-harness-propose-r2-fc59c8bc
workstream_index: 1
sprint_dir: sprints/w34-walking-skeleton-happy-v2

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 `GET /subtract` 路由

**范围**: 在 `playground/server.js` 加 `GET /subtract` 路由 + `playground/tests/server.test.js` 加 describe 块 + `playground/README.md` 加端点条目
**大小**: S（≈ 10-12 行 server.js + ≈ 30-40 个新 test + 1 行 README）
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `app.get('/subtract'` 路由声明
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes(\"app.get('/subtract'\"))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] `playground/server.js` 含字面字符串 `operation: 'subtract'` 或 `operation: \"subtract\"`（response body 字面）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/operation\s*:\s*['\"]subtract['\"]/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /subtract'` 测试块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/subtract/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] `playground/README.md` 端点列表含 `/subtract`
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/subtract'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] `playground/server.js` 未引入新依赖（与 main 对比 package.json 的 dependencies 段一字不动）
  Test: node -e "const p=JSON.parse(require('fs').readFileSync('playground/package.json','utf8'));const d=p.dependencies||{};const keys=Object.keys(d).sort().join(',');if(keys!=='express')process.exit(1)"
  期望: exit 0

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令；evaluator 直接跑，不读 vitest）

- [ ] [BEHAVIOR] GET /subtract?a=5&b=3 返 `{result:2, operation:"subtract"}` 严 schema（字段值 + 类型 + operation 字面字符串）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3201 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "http://127.0.0.1:3201/subtract?a=5&b=3"); R=$(echo "$RESP" | jq -e ".result == 2 and .operation == \"subtract\" and (.result | type) == \"number\"" 2>/dev/null); kill $SPID 2>/dev/null; [ "$R" = "true" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /subtract 成功响应顶层 keys 完整性恰好等于 ["operation","result"]（不允许多余字段，不允许少字段）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3202 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "http://127.0.0.1:3202/subtract?a=7&b=4"); R=$(echo "$RESP" | jq -e "(keys | sort) == [\"operation\",\"result\"]" 2>/dev/null); kill $SPID 2>/dev/null; [ "$R" = "true" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /subtract 成功响应严禁出现 PRD 禁用字段名（difference/diff/minus/subtraction/sub/subtracted/delta/gap/value/input/output/data/payload/response/answer/out/meta/sum/product/quotient/power/remainder/factorial/negation/incremented/next/successor/a/b）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3203 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "http://127.0.0.1:3203/subtract?a=9&b=2"); FAIL=0; for KEY in difference diff minus subtraction sub subtracted delta gap value input output data payload response answer out meta sum product quotient power remainder factorial negation incremented next successor a b; do R=$(echo "$RESP" | jq -e --arg k "$KEY" "has(\$k) | not" 2>/dev/null); [ "$R" = "true" ] || FAIL=1; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /subtract?a=0.3&b=0.1 返 result === Number("0.3")-Number("0.1") === 0.19999999999999998（浮点严等，禁容差比较）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3204 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "http://127.0.0.1:3204/subtract?a=0.3&b=0.1"); EXPECTED=$(node -e "console.log(Number(\"0.3\") - Number(\"0.1\"))"); R=$(echo "$RESP" | jq -e --argjson e "$EXPECTED" ".result == \$e" 2>/dev/null); kill $SPID 2>/dev/null; [ "$R" = "true" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /subtract 算术边界值复算严等（a=10,b=10 → 0；a=-5,b=3 → -8；a=5,b=-3 → 8；a=-5,b=-3 → -2；a=0,b=0 → 0）evaluator 独立验，不依赖 E2E 段
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3209 node server.js & SPID=$!; sleep 2; FAIL=0; declare -a CASES=("10 10 0" "-5 3 -8" "5 -3 8" "-5 -3 -2" "0 0 0"); for C in "${CASES[@]}"; do read -r A B EXP <<< "$C"; RESP=$(curl -fs "http://127.0.0.1:3209/subtract?a=$A&b=$B"); R=$(echo "$RESP" | jq -e --argjson e "$EXP" ".result == \$e and .operation == \"subtract\"" 2>/dev/null); [ "$R" = "true" ] || { echo "BAD a=$A b=$B exp=$EXP got=$RESP"; FAIL=1; }; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /subtract 缺参（无 query / 缺 a / 缺 b）全部返 400 + 顶层 keys 严格 ["error"]，body 不含 result/operation
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3205 node server.js & SPID=$!; sleep 2; FAIL=0; for QS in "" "a=5" "b=3"; do CODE=$(curl -s -o /tmp/sub-dod-err.json -w "%{http_code}" "http://127.0.0.1:3205/subtract?$QS"); [ "$CODE" = "400" ] || FAIL=1; jq -e "(keys | sort) == [\"error\"]" /tmp/sub-dod-err.json >/dev/null 2>&1 || FAIL=1; jq -e ".error | type == \"string\" and length > 0" /tmp/sub-dod-err.json >/dev/null 2>&1 || FAIL=1; jq -e "has(\"result\") | not" /tmp/sub-dod-err.json >/dev/null 2>&1 || FAIL=1; jq -e "has(\"operation\") | not" /tmp/sub-dod-err.json >/dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /subtract strict-schema 拒 10 类非法输入（科学计数法 / Infinity / NaN / 前导 + / 缺整数部分 / 缺小数部分 / 十六进制 / 千分位 / 字母串 / 双重负号）全返 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3206 node server.js & SPID=$!; sleep 2; FAIL=0; for QS in "a=1e3&b=2" "a=Infinity&b=2" "a=2&b=NaN" "a=%2B5&b=3" "a=.5&b=2" "a=5.&b=3" "a=0xff&b=2" "a=1%2C000&b=2" "a=abc&b=3" "a=--5&b=3"; do CODE=$(curl -s -o /tmp/sub-dod-strict.json -w "%{http_code}" "http://127.0.0.1:3206/subtract?$QS"); [ "$CODE" = "400" ] || { echo "BAD $QS=$CODE"; FAIL=1; }; jq -e "(keys | sort) == [\"error\"]" /tmp/sub-dod-strict.json >/dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /subtract?x=5&y=3（错 query 名）返 400（按缺 a/b 分支拒）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3207 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/sub-dod-q.json -w "%{http_code}" "http://127.0.0.1:3207/subtract?x=5&y=3"); R1=$([ "$CODE" = "400" ] && echo OK); R2=$(jq -e "(keys | sort) == [\"error\"]" /tmp/sub-dod-q.json >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R1" = "OK" ] && [ "$R2" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 8 路由回归 — /health、/sum、/multiply、/divide、/power、/modulo、/factorial、/increment 全部 happy 用例仍通过
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3208 node server.js & SPID=$!; sleep 2; FAIL=0; curl -fs "http://127.0.0.1:3208/health" | jq -e ".ok == true" >/dev/null 2>&1 || FAIL=1; curl -fs "http://127.0.0.1:3208/sum?a=2&b=3" | jq -e ".sum == 5" >/dev/null 2>&1 || FAIL=1; curl -fs "http://127.0.0.1:3208/multiply?a=2&b=3" | jq -e ".product == 6" >/dev/null 2>&1 || FAIL=1; curl -fs "http://127.0.0.1:3208/divide?a=6&b=2" | jq -e ".quotient == 3" >/dev/null 2>&1 || FAIL=1; curl -fs "http://127.0.0.1:3208/power?a=2&b=3" | jq -e ".power == 8" >/dev/null 2>&1 || FAIL=1; curl -fs "http://127.0.0.1:3208/modulo?a=10&b=3" | jq -e ".remainder == 1" >/dev/null 2>&1 || FAIL=1; curl -fs "http://127.0.0.1:3208/factorial?n=5" | jq -e ".factorial == 120" >/dev/null 2>&1 || FAIL=1; curl -fs "http://127.0.0.1:3208/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\"" >/dev/null 2>&1 || FAIL=1; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0
