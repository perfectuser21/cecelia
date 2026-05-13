---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: GET /negate 路由 + 测试 + README

**范围**: playground/server.js 新增 /negate 路由；tests/server.test.js 新增测试块；README.md 补充说明
**大小**: S（净增 ≤ 35 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] playground/server.js 包含 /negate 路由处理代码
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes('/negate'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] playground/tests/server.test.js 包含 describe('GET /negate') 测试块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes(\"describe('GET /negate'\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] playground/README.md 包含 /negate 端点说明
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('negate'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /negate?value=5 返回 {result:-5, operation:"negate"} 严 schema 字段值
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3101 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3101/negate?value=5"); R=$(echo "$RESP" | jq -e ".result == -5 and .operation == \"negate\"" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] response keys 完整性恰好等于 ["operation","result"]，禁止多余字段
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3102 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3102/negate?value=5"); R=$(echo "$RESP" | jq -e "keys == [\"operation\",\"result\"]" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 禁用字段 negated/negative/value/answer 反向不存在于 success response
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3103 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3103/negate?value=5"); R=$(echo "$RESP" | jq -e "(has(\"negated\") or has(\"negative\") or has(\"value\") or has(\"answer\")) | not" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] error path: GET /negate?value=foo 返回 HTTP 400 + error 字段合规
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3104 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3104/negate?value=foo"); ERR=$(curl -s "localhost:3104/negate?value=foo"); kill $SPID; [ "$CODE" = "400" ] && echo "$ERR" | jq -e ".error | type == \"string\" and length > 0" && echo "$ERR" | jq -e "keys == [\"error\"]"'
  期望: exit 0

- [ ] [BEHAVIOR] value=0 → result=0（正零，tostring 为 "0" 而非 "-0"）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3105 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3105/negate?value=0"); R=$(echo "$RESP" | jq -e ".result == 0 and (.result | tostring) == \"0\"" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] value=-7（负数取反）→ result=7
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3106 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3106/negate?value=-7"); R=$(echo "$RESP" | jq -e ".result == 7" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] value 缺失 → HTTP 400（参数必填校验）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3107 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3107/negate"); kill $SPID; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] value=1.5（小数）→ HTTP 400（strict ^-?\d+$ 校验）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3108 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3108/negate?value=1.5"); kill $SPID; [ "$CODE" = "400" ]'
  期望: exit 0
