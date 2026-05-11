contract_branch: cp-harness-propose-r1-960e97e7
workstream_index: 1
sprint_dir: sprints/w31-walking-skeleton-p1-v3

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /decrement 路由 + 单测 + README

**范围**: 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /decrement` 路由（含 `keys.length===1 && keys[0]==='value'` 校验 + strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上下界拒 + `Number(value) - 1` 算术 + 返回 `{result, operation: "decrement"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /decrement', ...)` 块；在 `playground/README.md` 加 `/decrement` 端点说明

**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 内含 `/decrement` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/decrement['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 路由块含 strict-schema 整数正则 `^-?\d+$`（不含小数支持，与 STRICT_NUMBER 浮点 regex 不同）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m||!/\^-\?\\d\+\$/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 路由使用 query 名 `value`（不复用 `n`/`a`/`b`）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\b(req\.query\.value|\{\s*value\s*\})/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 路由含双侧精度上界判定常量 `9007199254740990`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m||!/9007199254740990/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 路由响应字面含 `operation: "decrement"` 字符串（非变体）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m||!/operation\s*:\s*['\"]decrement['\"]/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 路由响应字面含 `result` 字段，且 W26 模板 `operation: "increment"` 字面**不再出现在 /decrement 块内**（防漏改）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bresult\s*:/.test(m[0]))process.exit(1);if(/operation\s*:\s*['\"]increment['\"]/.test(m[0])){console.error('FAIL: /decrement 块内仍出现 operation:\"increment\" — W26 模板漏改');process.exit(1)}for(const k of ['decremented','prev','previous','predecessor','pred','n_minus_one','minus_one','sub_one','subtracted','decrementation','incremented','n_plus_one','successor']){if(new RegExp('\\b'+k+'\\s*:').test(m[0])){console.error('forbidden key '+k);process.exit(1)}}"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 新增 `describe('GET /decrement'` 块（独立 describe，与其他 endpoint 平级）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/decrement/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 端点列表含 `/decrement` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/decrement/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令；evaluator v1.1 直接跑）

- [ ] [BEHAVIOR] GET /decrement?value=5 → 200 + 严 schema `{result:4, operation:"decrement"}` + 顶层 keys 完整性 `["operation","result"]`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3801 NODE_ENV=production node server.js > /tmp/dec-b1.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3801/decrement?value=5"); R1=$(echo "$RESP" | jq -e ".result == 4"); R2=$(echo "$RESP" | jq -e ".operation == \"decrement\""); R3=$(echo "$RESP" | jq -e "keys | sort == [\"operation\",\"result\"]"); kill $SPID; [ -n "$R1" ] && [ -n "$R2" ] && [ -n "$R3" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=5 响应 `.operation != "increment"`（防 W26 模板漏改 — W31 独有最易踩坑）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3802 NODE_ENV=production node server.js > /tmp/dec-b2.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3802/decrement?value=5"); R=$(echo "$RESP" | jq -e ".operation != \"increment\""); kill $SPID; [ -n "$R" ]'
  期望: exit 0（operation 字面不能是 "increment"）

- [ ] [BEHAVIOR] GET /decrement?value=5 响应不含任一禁用字段（30 个禁用名反向 has() | not）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3803 NODE_ENV=production node server.js > /tmp/dec-b3.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3803/decrement?value=5"); FAIL=0; for k in decremented prev previous predecessor pred n_minus_one minus_one sub_one subtracted sub dec decr decrementation incremented n_plus_one successor value input output data payload response answer out meta sum product quotient power remainder factorial negation; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { echo "FAIL: $k"; FAIL=1; break; }; done; kill $SPID; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=0 → 200 + result==-1（off-by-one 零侧）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3804 NODE_ENV=production node server.js > /tmp/dec-b4.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3804/decrement?value=0"); R=$(echo "$RESP" | jq -e ".result == -1 and .operation == \"decrement\""); kill $SPID; [ -n "$R" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=1 → 200 + result==0（off-by-one 严格 0 数字字面，非 null/undefined/false）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3805 NODE_ENV=production node server.js > /tmp/dec-b5.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3805/decrement?value=1"); R1=$(echo "$RESP" | jq -e ".result == 0"); R2=$(echo "$RESP" | jq -e ".result | type == \"number\""); kill $SPID; [ -n "$R1" ] && [ -n "$R2" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=-1 → 200 + result==-2（off-by-one 负侧）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3806 NODE_ENV=production node server.js > /tmp/dec-b6.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3806/decrement?value=-1"); R=$(echo "$RESP" | jq -e ".result == -2 and .operation == \"decrement\""); kill $SPID; [ -n "$R" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=9007199254740990 → 200 + result==9007199254740989（精度上界 happy）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3807 NODE_ENV=production node server.js > /tmp/dec-b7.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3807/decrement?value=9007199254740990"); R=$(echo "$RESP" | jq -e ".result == 9007199254740989 and .operation == \"decrement\""); kill $SPID; [ -n "$R" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=-9007199254740990 → 200 + result==-9007199254740991 (===Number.MIN_SAFE_INTEGER)（精度下界 happy）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3808 NODE_ENV=production node server.js > /tmp/dec-b8.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3808/decrement?value=-9007199254740990"); R=$(echo "$RESP" | jq -e ".result == -9007199254740991 and .operation == \"decrement\""); MIN=$(node -e "console.log(Number.MIN_SAFE_INTEGER)"); kill $SPID; [ -n "$R" ] && [ "$MIN" = "-9007199254740991" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=9007199254740991 → 400 + 错误体 keys==["error"] + 不含 result/operation（上界 +1 拒）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3809 NODE_ENV=production node server.js > /tmp/dec-b9.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/dec-b9-body.json -w "%{http_code}" "http://localhost:3809/decrement?value=9007199254740991"); R1=$(cat /tmp/dec-b9-body.json | jq -e "keys | sort == [\"error\"]"); R2=$(cat /tmp/dec-b9-body.json | jq -e "has(\"result\") | not"); R3=$(cat /tmp/dec-b9-body.json | jq -e "has(\"operation\") | not"); R4=$(cat /tmp/dec-b9-body.json | jq -e ".error | type == \"string\" and length > 0"); kill $SPID; [ "$CODE" = "400" ] && [ -n "$R1" ] && [ -n "$R2" ] && [ -n "$R3" ] && [ -n "$R4" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=-9007199254740991 → 400 + 错误体 keys==["error"]（下界 -1 拒）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3810 NODE_ENV=production node server.js > /tmp/dec-b10.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/dec-b10-body.json -w "%{http_code}" "http://localhost:3810/decrement?value=-9007199254740991"); R1=$(cat /tmp/dec-b10-body.json | jq -e "keys | sort == [\"error\"]"); R2=$(cat /tmp/dec-b10-body.json | jq -e "has(\"result\") | not"); kill $SPID; [ "$CODE" = "400" ] && [ -n "$R1" ] && [ -n "$R2" ]'
  期望: exit 0

- [ ] [BEHAVIOR] strict-schema 拒（1.5 / 1.0 / 1e2 / 0xff / abc / Infinity / NaN / 空串 / 仅负号 / 双重负号 / 前导+ / 千分位 / 尾部负号 共 13 类 → 全 400）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3811 NODE_ENV=production node server.js > /tmp/dec-b11.log 2>&1 & SPID=$!; sleep 2; FAIL=0; for v in "1.5" "1.0" "1e2" "0xff" "abc" "Infinity" "NaN" "" "-" "--5" "%2B5" "1%2C000" "5-"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3811/decrement?value=$v"); [ "$CODE" = "400" ] || { echo "FAIL: v=$v code=$CODE"; FAIL=1; break; }; done; kill $SPID; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement（缺 value 参数） → 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3812 NODE_ENV=production node server.js > /tmp/dec-b12.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3812/decrement"); kill $SPID; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 错 query 名（n/x/y/m/val/input/v/count/a/b 等 ≥ 10 个）一律 → 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3813 NODE_ENV=production node server.js > /tmp/dec-b13.log 2>&1 & SPID=$!; sleep 2; FAIL=0; for bn in n x y m k val num input v a b count size target; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3813/decrement?$bn=5"); [ "$CODE" = "400" ] || { echo "FAIL: query=$bn code=$CODE"; FAIL=1; break; }; done; kill $SPID; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=5&extra=x（多余 query）→ 400 + 错误体不含 result/operation
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3814 NODE_ENV=production node server.js > /tmp/dec-b14.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/dec-b14-body.json -w "%{http_code}" "http://localhost:3814/decrement?value=5&extra=x"); R1=$(cat /tmp/dec-b14-body.json | jq -e "has(\"result\") | not"); R2=$(cat /tmp/dec-b14-body.json | jq -e "has(\"operation\") | not"); kill $SPID; [ "$CODE" = "400" ] && [ -n "$R1" ] && [ -n "$R2" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=01 → 200 + result==0（前导 0 happy，非八进制错位）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3815 NODE_ENV=production node server.js > /tmp/dec-b15.log 2>&1 & SPID=$!; sleep 2; R1=$(curl -fs "http://localhost:3815/decrement?value=01" | jq -e ".result == 0 and .operation == \"decrement\""); R2=$(curl -fs "http://localhost:3815/decrement?value=-01" | jq -e ".result == -2 and .operation == \"decrement\""); kill $SPID; [ -n "$R1" ] && [ -n "$R2" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 已有 8 路由 (/health /sum /multiply /divide /power /modulo /factorial /increment) happy 用例回归全通过
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3816 NODE_ENV=production node server.js > /tmp/dec-b16.log 2>&1 & SPID=$!; sleep 2; FAIL=0; curl -fs "http://localhost:3816/health" | jq -e ".ok == true" > /dev/null || FAIL=1; curl -fs "http://localhost:3816/sum?a=2&b=3" | jq -e ".sum == 5" > /dev/null || FAIL=1; curl -fs "http://localhost:3816/multiply?a=2&b=3" | jq -e ".product == 6" > /dev/null || FAIL=1; curl -fs "http://localhost:3816/divide?a=6&b=3" | jq -e ".quotient == 2" > /dev/null || FAIL=1; curl -fs "http://localhost:3816/power?a=2&b=3" | jq -e ".power == 8" > /dev/null || FAIL=1; curl -fs "http://localhost:3816/modulo?a=7&b=3" | jq -e ".remainder == 1" > /dev/null || FAIL=1; curl -fs "http://localhost:3816/factorial?n=5" | jq -e ".factorial == 120" > /dev/null || FAIL=1; curl -fs "http://localhost:3816/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\"" > /dev/null || FAIL=1; kill $SPID; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] 上界拒错误体 schema 完整性 + 不含 result/operation 双联（独立断言巩固 Risk 8 错误体污染防御）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3817 NODE_ENV=production node server.js > /tmp/dec-b17.log 2>&1 & SPID=$!; sleep 2; FAIL=0; for badv in "9007199254740991" "-9007199254740991" "99999999999999999999"; do CODE=$(curl -s -o /tmp/dec-b17-body.json -w "%{http_code}" "http://localhost:3817/decrement?value=$badv"); [ "$CODE" = "400" ] || { echo "FAIL: $badv code=$CODE"; FAIL=1; break; }; cat /tmp/dec-b17-body.json | jq -e "keys | sort == [\"error\"]" > /dev/null || { echo "FAIL: $badv keys drift"; FAIL=1; break; }; cat /tmp/dec-b17-body.json | jq -e "has(\"result\") | not" > /dev/null || { echo "FAIL: $badv 含 result"; FAIL=1; break; }; cat /tmp/dec-b17-body.json | jq -e "has(\"operation\") | not" > /dev/null || { echo "FAIL: $badv 含 operation"; FAIL=1; break; }; done; kill $SPID; [ $FAIL -eq 0 ]'
  期望: exit 0
