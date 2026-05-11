---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /increment 路由 + 单测 + README

**范围**: 在 `playground/server.js` 新增 `GET /increment` 路由（含 strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上界拒 + `Number(value) + 1` 算术 + 返回 `{result, operation: "increment"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /increment', ...)` 块；在 `playground/README.md` 加 `/increment` 端点说明
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 内含 `/increment` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/increment['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内含 strict-schema 整数正则 `^-?\d+$`（不含小数支持）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m||!/\^-\?\\\\d\+\$/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/increment` 路由使用 query 名 `value`（不复用 `n`/`a`/`b`）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\b(req\.query\.value|\{\s*value\s*\})/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/increment` 路由含上界判定 `9007199254740990`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m||!/9007199254740990/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/increment` 路由响应字面含 `operation: "increment"` 字符串
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m||!/operation\s*:\s*['\"]increment['\"]/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/increment` 路由响应字面含 `result` 字段（不漂到 `incremented`/`next`/`successor` 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/increment[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bresult\s*:/.test(m[0]))process.exit(1);for(const k of ['incremented','successor','n_plus_one','plus_one','succ','incr','incrementation']){if(new RegExp('\\\\b'+k+'\\\\s*:').test(m[0])){console.error('forbidden key '+k);process.exit(1)}}"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 新增 `describe('GET /increment'` 块（独立 describe，与其他 endpoint 平级）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/increment/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 端点列表含 `/increment` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/increment/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 真起服务真校验；严禁只索引 vitest）

- [ ] [BEHAVIOR] GET /increment?value=5 返 HTTP 200 + `{result:6, operation:"increment"}`（值复算正确）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3701 NODE_ENV=production node server.js > /tmp/dod-b1.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3701/increment?value=5"); R1=$(echo "$RESP" | jq -e ".result == 6" 2>/dev/null && echo OK); R2=$(echo "$RESP" | jq -e ".operation == \"increment\"" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ -n "$R1" ] && [ -n "$R2" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=5 顶层 keys 字面集合 = `["operation","result"]`（schema 完整性 — 不许多 key 不许少 key）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3702 NODE_ENV=production node server.js > /tmp/dod-b2.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3702/increment?value=5"); R=$(echo "$RESP" | jq -e "keys | sort == [\"operation\",\"result\"]" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ -n "$R" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=5 response 不含禁用字段 incremented / next / successor / n_plus_one / plus_one / succ / inc / incr / incrementation
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3703 NODE_ENV=production node server.js > /tmp/dod-b3.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3703/increment?value=5"); FAIL=0; for k in incremented next successor n_plus_one plus_one succ inc incr incrementation; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=5 response 不含 generic 禁用字段 value / input / output / data / payload / answer / meta
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3704 NODE_ENV=production node server.js > /tmp/dod-b4.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3704/increment?value=5"); FAIL=0; for k in value input output data payload answer meta; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=5 response 不含其他 endpoint 字段名 sum / product / quotient / power / remainder / factorial / negation
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3705 NODE_ENV=production node server.js > /tmp/dod-b5.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3705/increment?value=5"); FAIL=0; for k in sum product quotient power remainder factorial negation; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null 2>&1 || FAIL=1; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=0 返 `{result:1, operation:"increment"}`（off-by-one 正侧边界）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3706 NODE_ENV=production node server.js > /tmp/dod-b6.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3706/increment?value=0"); R=$(echo "$RESP" | jq -e ".result == 1 and .operation == \"increment\"" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ -n "$R" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=-1 返 `{result:0, operation:"increment"}`（off-by-one 负侧边界）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3707 NODE_ENV=production node server.js > /tmp/dod-b7.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3707/increment?value=-1"); R=$(echo "$RESP" | jq -e ".result == 0 and .operation == \"increment\"" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ -n "$R" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=9007199254740990 返 `{result:9007199254740991, operation:"increment"}`（精度上界 happy）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3708 NODE_ENV=production node server.js > /tmp/dod-b8.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3708/increment?value=9007199254740990"); R=$(echo "$RESP" | jq -e ".result == 9007199254740991 and .operation == \"increment\"" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ -n "$R" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=-9007199254740990 返 `{result:-9007199254740989, operation:"increment"}`（精度下界 happy）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3709 NODE_ENV=production node server.js > /tmp/dod-b9.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3709/increment?value=-9007199254740990"); R=$(echo "$RESP" | jq -e ".result == -9007199254740989 and .operation == \"increment\"" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ -n "$R" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=9007199254740991 返 HTTP 400（上界 +1 拒）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3710 NODE_ENV=production node server.js > /tmp/dod-b10.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3710/increment?value=9007199254740991"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=-9007199254740991 返 HTTP 400（下界 -1 拒）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3711 NODE_ENV=production node server.js > /tmp/dod-b11.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3711/increment?value=-9007199254740991"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 上界拒错误体顶层 keys = `["error"]` 且不含 `result` / `operation`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3712 NODE_ENV=production node server.js > /tmp/dod-b12.log 2>&1 & SPID=$!; sleep 2; BODY=$(curl -s "http://localhost:3712/increment?value=9007199254740991"); R1=$(echo "$BODY" | jq -e "keys | sort == [\"error\"]" 2>/dev/null && echo OK); R2=$(echo "$BODY" | jq -e "has(\"result\") | not" 2>/dev/null && echo OK); R3=$(echo "$BODY" | jq -e "has(\"operation\") | not" 2>/dev/null && echo OK); R4=$(echo "$BODY" | jq -e ".error | type == \"string\" and length > 0" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ -n "$R1" ] && [ -n "$R2" ] && [ -n "$R3" ] && [ -n "$R4" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=1.5 返 HTTP 400（strict 拒小数）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3713 NODE_ENV=production node server.js > /tmp/dod-b13.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3713/increment?value=1.5"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=1.0 返 HTTP 400（strict 拒带小数点的"整数"）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3714 NODE_ENV=production node server.js > /tmp/dod-b14.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3714/increment?value=1.0"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=1e2 返 HTTP 400（strict 拒科学计数法）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3715 NODE_ENV=production node server.js > /tmp/dod-b15.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3715/increment?value=1e2"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=abc 返 HTTP 400（strict 拒字母）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3716 NODE_ENV=production node server.js > /tmp/dod-b16.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3716/increment?value=abc"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=Infinity 返 HTTP 400（strict 拒 Infinity 字面）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3717 NODE_ENV=production node server.js > /tmp/dod-b17.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3717/increment?value=Infinity"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment（缺 value）返 HTTP 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3718 NODE_ENV=production node server.js > /tmp/dod-b18.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3718/increment"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?n=5（错 query 名）返 HTTP 400（W26 强约束：只接受 value）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3719 NODE_ENV=production node server.js > /tmp/dod-b19.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3719/increment?n=5"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /increment?value=01 返 `{result:2, operation:"increment"}`（前导 0 happy，不许错用八进制）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3720 NODE_ENV=production node server.js > /tmp/dod-b20.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3720/increment?value=01"); R=$(echo "$RESP" | jq -e ".result == 2 and .operation == \"increment\"" 2>/dev/null && echo OK); kill $SPID 2>/dev/null; [ -n "$R" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 已有 7 路由 (/health /sum /multiply /divide /power /modulo /factorial) 回归 happy 用例全通过
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3721 NODE_ENV=production node server.js > /tmp/dod-b21.log 2>&1 & SPID=$!; sleep 2; FAIL=0; curl -fs "http://localhost:3721/health" | jq -e ".ok == true" > /dev/null 2>&1 || FAIL=1; curl -fs "http://localhost:3721/sum?a=2&b=3" | jq -e ".sum == 5" > /dev/null 2>&1 || FAIL=1; curl -fs "http://localhost:3721/multiply?a=2&b=3" | jq -e ".product == 6" > /dev/null 2>&1 || FAIL=1; curl -fs "http://localhost:3721/divide?a=6&b=3" | jq -e ".quotient == 2" > /dev/null 2>&1 || FAIL=1; curl -fs "http://localhost:3721/power?a=2&b=3" | jq -e ".power == 8" > /dev/null 2>&1 || FAIL=1; curl -fs "http://localhost:3721/modulo?a=7&b=3" | jq -e ".remainder == 1" > /dev/null 2>&1 || FAIL=1; curl -fs "http://localhost:3721/factorial?n=5" | jq -e ".factorial == 120" > /dev/null 2>&1 || FAIL=1; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0
