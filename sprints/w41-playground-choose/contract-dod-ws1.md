---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground/server.js 新增 GET /choose 路由

**范围**: 在 `/factorial` 之后、`app.listen` 之前新增 `GET /choose` 路由（strict-schema ^\d+$ + n>20 拒 + k>n 拒 + 迭代计算 C(n,k)）
**大小**: S(<100行)
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `app.get('/choose'` 路由定义
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');if(!c.includes(\"app.get('/choose'\"))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 使用 `^\d+$` 正则校验 n 和 k（与 /factorial 同款非负整数 strict-schema）
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');if(!c.includes('\\\\d+'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] GET /choose?n=5&k=2 返 200 + {"choose": 10}，字段值严格等于 PRD 规定的 `choose`
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3011 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3011/choose?n=5&k=2"); R=$(echo "$RESP" | jq -e ".choose == 10" && echo OK); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] response 严 schema 完整性：keys 恰好等于 ["choose"]，不允许多余字段
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3012 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3012/choose?n=5&k=2"); R=$(echo "$RESP" | jq -e "keys == [\"choose\"]" && echo OK); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 禁用字段 result/answer/c/cnk/combination/binomial 反向不存在（generator 不许漂移到禁用字段名）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3013 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3013/choose?n=5&k=2"); R=$(echo "$RESP" | jq -e "has(\"result\") | not" && echo "$RESP" | jq -e "has(\"answer\") | not" && echo "$RESP" | jq -e "has(\"c\") | not" && echo "$RESP" | jq -e "has(\"cnk\") | not" && echo OK); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] error path：缺参数 n → HTTP 400 + error body keys 精确等于 ["error"]
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3014 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3014/choose?k=2"); ERESP=$(curl -s "localhost:3014/choose?k=2"); R1=$([ "$CODE" = "400" ] && echo OK); R2=$(echo "$ERESP" | jq -e "keys == [\"error\"]" && echo OK); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$R1" = "OK" ] && [ "$R2" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] error path：n>20（n=21）→ HTTP 400（hard cap 上界校验）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3015 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3015/choose?n=21&k=0"); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0
