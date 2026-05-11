---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /decrement 路由 + 单测 + README

**范围**: 在 `playground/server.js` 新增 `GET /decrement` 路由（query 唯一性 + strict-schema `^-?\d+$` + `|Number(value)| ≤ 9007199254740990` + `Number(value)-1` 算术 + 返回 `{result, operation:"decrement"}`）；在 `playground/tests/server.test.js` 新增 `GET /decrement` describe 块单测；在 `playground/README.md` 端点列表加 `/decrement` 段。零依赖、不动已有 8 路由。

**大小**: M

**依赖**: 无

**Round 2 SSOT 引用**: 禁用字段清单单源在 `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh`（详见 contract-draft.md `## Stable IDs` 段）。本 DoD 文件 BEHAVIOR-11 与 BEHAVIOR-12 严格 source SSOT 文件并通过 `${BANNED_RESPONSE_KEYS[@]}` / `${BANNED_ERROR_KEYS[@]}` 引用，不再 inline 粘贴 34/10 字段名清单。

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `app.get('/decrement'` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8'); if(!/app\.get\(['\"]\/decrement['\"]/.test(c)) process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 路由含 strict-schema 整数正则 `^-?\d+$`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8'); const idx=c.indexOf('/decrement'); const body=c.slice(idx, idx+1500); if(!/\\^-\\?\\\\d\\+\\\$/.test(body)) process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 路由 query 名为 `value`（字面照搬 PRD，禁 n/a/b/x/prev/pred）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8'); const idx=c.indexOf('/decrement'); const body=c.slice(idx, idx+1500); if(!/req\.query\.value/.test(body)) process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 含精度上界判定数字 `9007199254740990`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8'); const idx=c.indexOf('/decrement'); const body=c.slice(idx, idx+1500); if(!/9007199254740990/.test(body)) process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 响应含字面 `operation: 'decrement'` 与字面 `result` 字段
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8'); const idx=c.indexOf('/decrement'); const body=c.slice(idx, idx+1500); if(!/operation:\s*['\"]decrement['\"]/.test(body) || !/result:/.test(body)) process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` `/decrement` 含 query 唯一性约束（`Object.keys(req.query).length === 1`）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8'); const idx=c.indexOf('/decrement'); const body=c.slice(idx, idx+1500); if(!/Object\.keys\(req\.query\)\.length\s*===\s*1/.test(body)) process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /decrement` 独立 describe 块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8'); if(!/describe\(['\"]GET \/decrement/.test(c)) process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 端点列表含 `/decrement` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8'); if(!/\/decrement/.test(c)) process.exit(1)"

- [ ] [ARTIFACT] SSOT 单源文件 `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh` 存在且可 source；BANNED_RESPONSE_KEYS 长度 34（按 PRD L103-L105 字面对齐 15+10+9），BANNED_ERROR_KEYS 长度 10
  Test: bash -c 'source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh && [ "${#BANNED_RESPONSE_KEYS[@]}" = "34" ] && [ "${#BANNED_ERROR_KEYS[@]}" = "10" ]'

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] GET /decrement?value=5 → 200 + {result:4, operation:"decrement"} + 顶层 keys 字面 ["operation","result"]（schema 完整性 + 字段名字面相等 oracle）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3301 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3301/decrement?value=5"); R1=$(echo "$RESP" | jq -e ".result == 4" >/dev/null && echo OK); R2=$(echo "$RESP" | jq -e ".operation == \"decrement\"" >/dev/null && echo OK); R3=$(echo "$RESP" | jq -e "keys | sort == [\"operation\",\"result\"]" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R1" = OK ] && [ "$R2" = OK ] && [ "$R3" = OK ]'
  期望: exit 0（三条 jq -e 全过：result==4、operation=="decrement"、keys==["operation","result"]）

- [ ] [BEHAVIOR] GET /decrement?value=0 → 200 + {result:-1, operation:"decrement"}（off-by-one 零边界，防 generator 漂成 result=0）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3302 node server.js & SPID=$!; sleep 2; R=$(curl -fs "localhost:3302/decrement?value=0" | jq -e ".result == -1 and .operation == \"decrement\"" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = OK ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=1 → 200 + {result:0, operation:"decrement"}（off-by-one 1 边界，防 generator 漂成 result=1）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3303 node server.js & SPID=$!; sleep 2; R=$(curl -fs "localhost:3303/decrement?value=1" | jq -e ".result == 0 and .operation == \"decrement\"" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = OK ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=-9007199254740990 → 200 + {result:-9007199254740991, operation:"decrement"}（精度下界 happy，===Number.MIN_SAFE_INTEGER）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3304 node server.js & SPID=$!; sleep 2; R=$(curl -fs "localhost:3304/decrement?value=-9007199254740990" | jq -e ".result == -9007199254740991 and .operation == \"decrement\"" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = OK ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=9007199254740990 → 200 + {result:9007199254740989, operation:"decrement"}（精度上界 happy）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3305 node server.js & SPID=$!; sleep 2; R=$(curl -fs "localhost:3305/decrement?value=9007199254740990" | jq -e ".result == 9007199254740989 and .operation == \"decrement\"" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = OK ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=9007199254740991 → 400（上界 +1 拒）；body 不含 result 也不含 operation；含 error 字段非空字符串
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3306 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3306/decrement?value=9007199254740991"); ERR=$(curl -s "localhost:3306/decrement?value=9007199254740991"); R1=$(echo "$ERR" | jq -e "has(\"result\") | not" >/dev/null && echo OK); R2=$(echo "$ERR" | jq -e "has(\"operation\") | not" >/dev/null && echo OK); R3=$(echo "$ERR" | jq -e ".error | type == \"string\" and length > 0" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && [ "$R1" = OK ] && [ "$R2" = OK ] && [ "$R3" = OK ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=-9007199254740991 → 400（下界 -1 拒）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3307 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3307/decrement?value=-9007199254740991"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] strict-schema 拒非法输入（1.5 / 1e2 / 0xff / abc / 空串 / +5 / --5 / Infinity / NaN）全返 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3308 node server.js & SPID=$!; sleep 2; FAIL=0; for INPUT in "1.5" "1e2" "0xff" "abc" "" "%2B5" "--5" "Infinity" "NaN"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3308/decrement?value=${INPUT}"); [ "$CODE" = "400" ] || { echo "value=${INPUT} 应 400 实际 ${CODE}"; FAIL=1; }; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
  期望: exit 0

- [ ] [BEHAVIOR] query 唯一性约束：缺 value / 错 query 名 n / 多余 query extra 全返 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3309 node server.js & SPID=$!; sleep 2; FAIL=0; for Q in "" "?n=5" "?a=5" "?value=5&extra=1"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3309/decrement${Q}"); [ "$CODE" = "400" ] || { echo "/decrement${Q} 应 400 实际 ${CODE}"; FAIL=1; }; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=01 → 200 + {result:0, operation:"decrement"}（前导 0 happy；禁 generator 错用 parseInt(value, 8) 八进制）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3310 node server.js & SPID=$!; sleep 2; R=$(curl -fs "localhost:3310/decrement?value=01" | jq -e ".result == 0 and .operation == \"decrement\"" >/dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = OK ]'
  期望: exit 0

- [ ] [BEHAVIOR] 禁用响应字段反向：response 不含 SSOT BANNED_RESPONSE_KEYS 任一（PR-G 死规则继承；引用 sprints/w30-walking-skeleton-p1-v2/banned-keys.sh 单源，不 inline 粘贴 34 字段名清单）
  Test: manual:bash -c 'source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh; cd playground && PLAYGROUND_PORT=3311 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3311/decrement?value=5"); FAIL=0; for BANNED in "${BANNED_RESPONSE_KEYS[@]}"; do echo "$RESP" | jq -e "has(\"${BANNED}\") | not" >/dev/null || { echo "禁用字段 ${BANNED} 出现"; FAIL=1; }; done; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
  期望: exit 0（SSOT 中 34 个禁用字段名 has() 反向断言全过；SSOT 字段数变化时自动同步）

- [ ] [BEHAVIOR] 错误体 schema 完整性：keys 字面 ["error"]，不含 SSOT BANNED_ERROR_KEYS 任一（引用 sprints/w30-walking-skeleton-p1-v2/banned-keys.sh 单源，不 inline 粘贴 10 字段名清单）
  Test: manual:bash -c 'source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh; cd playground && PLAYGROUND_PORT=3312 node server.js & SPID=$!; sleep 2; ERR=$(curl -s "localhost:3312/decrement?value=abc"); R1=$(echo "$ERR" | jq -e "keys | sort == [\"error\"]" >/dev/null && echo OK); R2=$(echo "$ERR" | jq -e ".error | type == \"string\" and length > 0" >/dev/null && echo OK); FAIL=0; for BANNED in "${BANNED_ERROR_KEYS[@]}"; do echo "$ERR" | jq -e "has(\"${BANNED}\") | not" >/dev/null || { echo "错误体含禁用字段 ${BANNED}"; FAIL=1; }; done; kill $SPID 2>/dev/null; [ "$R1" = OK ] && [ "$R2" = OK ] && [ "$FAIL" = "0" ]'
  期望: exit 0（SSOT 中 10 个错误响应禁用字段名 has() 反向断言全过）

- [ ] [BEHAVIOR] 8 路由回归 happy：/health /sum /multiply /divide /power /modulo /factorial /increment 全过
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3313 node server.js & SPID=$!; sleep 2; FAIL=0; curl -fs "localhost:3313/health" | jq -e ".ok == true" >/dev/null || { echo health; FAIL=1; }; curl -fs "localhost:3313/sum?a=2&b=3" | jq -e ".sum == 5" >/dev/null || { echo sum; FAIL=1; }; curl -fs "localhost:3313/multiply?a=7&b=5" | jq -e ".product == 35" >/dev/null || { echo multiply; FAIL=1; }; curl -fs "localhost:3313/divide?a=10&b=2" | jq -e ".quotient == 5" >/dev/null || { echo divide; FAIL=1; }; curl -fs "localhost:3313/power?a=2&b=3" | jq -e ".power == 8" >/dev/null || { echo power; FAIL=1; }; curl -fs "localhost:3313/modulo?a=10&b=3" | jq -e ".remainder == 1" >/dev/null || { echo modulo; FAIL=1; }; curl -fs "localhost:3313/factorial?n=5" | jq -e ".factorial == 120" >/dev/null || { echo factorial; FAIL=1; }; curl -fs "localhost:3313/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\"" >/dev/null || { echo increment; FAIL=1; }; kill $SPID 2>/dev/null; [ "$FAIL" = "0" ]'
  期望: exit 0
