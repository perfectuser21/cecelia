---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /negate（路由 + 测试 + README）

**范围**: `playground/server.js` 加 GET /negate 路由；`playground/tests/server.test.js` 加 describe('GET /negate')；`playground/README.md` 加 /negate 段
**大小**: S（三文件净增 ~90 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `app.get('/negate'` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes(\"app.get('/negate'\"))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /negate'` 块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes(\"describe('GET /negate'\"))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 含 `/negate` 端点文档段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/negate'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /negate?value=5 → 200 + result=-5 且 operation="negate"（schema 字段值）
  Test: manual:bash -c 'cd /workspace && PLAYGROUND_PORT=3021 node playground/server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3021/negate?value=5"); R1=$(echo "$RESP" | jq -e ".result == -5" && echo OK); R2=$(echo "$RESP" | jq -e ".operation == \"negate\"" && echo OK); kill $SPID; [ "$R1" = "OK" ] && [ "$R2" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] response keys 完整性 — 顶层 keys 恰好等于 ["operation","result"]
  Test: manual:bash -c 'cd /workspace && PLAYGROUND_PORT=3022 node playground/server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3022/negate?value=5"); R=$(echo "$RESP" | jq -e "keys == [\"operation\",\"result\"]" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 禁用字段 negated/negative/inverted 反向不存在（generator 漂移检测）
  Test: manual:bash -c 'cd /workspace && PLAYGROUND_PORT=3023 node playground/server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3023/negate?value=5"); R1=$(echo "$RESP" | jq -e "has(\"negated\") | not" && echo OK); R2=$(echo "$RESP" | jq -e "has(\"negative\") | not" && echo OK); R3=$(echo "$RESP" | jq -e "has(\"inverted\") | not" && echo OK); kill $SPID; [ "$R1" = "OK" ] && [ "$R2" = "OK" ] && [ "$R3" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] error path — value=abc 返 400 + {error: <非空 string>}（非整数输入）
  Test: manual:bash -c 'cd /workspace && PLAYGROUND_PORT=3024 node playground/server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3024/negate?value=abc"); ERRRESP=$(curl -s "localhost:3024/negate?value=abc"); R=$(echo "$ERRRESP" | jq -e ".error | type == \"string\" and length > 0" && echo OK); kill $SPID; [ "$CODE" = "400" ] && [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] error path — 禁用 query 名 n=5 返 400（仅允许 query 名 value）
  Test: manual:bash -c 'cd /workspace && PLAYGROUND_PORT=3025 node playground/server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3025/negate?n=5"); kill $SPID; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 负数取反 — value=-5 → 200 + result=5（负负得正）
  Test: manual:bash -c 'cd /workspace && PLAYGROUND_PORT=3026 node playground/server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3026/negate?value=-5"); R=$(echo "$RESP" | jq -e ".result == 5" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0
