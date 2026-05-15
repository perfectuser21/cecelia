contract_branch: cp-harness-propose-r3-d6ea1ffe
workstream_index: 1
sprint_dir: sprints

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: playground/server.js 新增 GET /abs 端点

**范围**: `playground/server.js` 新增 `/abs` 路由；query 参数名 `n`（严格数字）；成功返回 `{"result": Math.abs(n), "operation": "abs"}`；非法输入返 400 + `{"error":"..."}`
**大小**: S（< 50 行净增，1 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `/abs` 路由处理器
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');if(!c.includes('/abs'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `playground/server.js` 的 /abs handler 使用 `req.query.n` 读取参数（字面量 `n`）
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');if(!c.includes('req.query.n'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `playground/server.js` 的 /abs handler 响应含字面量 `operation: 'abs'` 或 `operation: "abs"`
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');if(!c.includes(\"'abs'\")&&!c.includes('\"abs\"'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] B42 warn+fallback 逻辑存在于 harness-gan.graph.js（propose_branch mismatch 改 warn 不 abort，#2972 修复点）
  Test: grep -rqE "(WARN|warn).*propose_branch|propose_branch.*(WARN|warn)|mismatch.*(warn|WARN)" /workspace/packages/brain/src/workflows/harness-gan.graph.js

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] GET /abs?n=-5 返回 `{"result":5,"operation":"abs"}` — result 字段值严格校验
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3091 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3091/abs?n=-5"); R=$(echo "$RESP" | jq -e ".result == 5" && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] GET /abs?n=-5 operation 字段字面量 "abs" — 禁用 absolute/absoluteValue/abs_value
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3092 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3092/abs?n=-5"); R=$(echo "$RESP" | jq -e ".operation == \"abs\"" && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] GET /abs?n=-5 schema 完整性 — keys 恰好等于 ["operation","result"]，不允许多余字段
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3093 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3093/abs?n=-5"); R=$(echo "$RESP" | jq -e "keys == [\"operation\",\"result\"]" && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] 禁用字段 value/answer/data 反向检查 — response 中均不存在
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3094 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3094/abs?n=-5"); R=$(echo "$RESP" | jq -e "has(\"value\") | not" && echo "$RESP" | jq -e "has(\"answer\") | not" && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: OK (exit 0)

- [ ] [BEHAVIOR] error path — GET /abs?n=foo（非数字）返回 HTTP 400 且 body 含 `error` 字段、禁用 `message`/`msg`/`reason`
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3095 node server.js & SPID=$!; sleep 2; curl -s -o /tmp/err_body_foo.json -w "%{http_code}" "localhost:3095/abs?n=foo" > /tmp/err_code_foo.txt; CODE=$(cat /tmp/err_code_foo.txt); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && jq -e "has(\"error\")" /tmp/err_body_foo.json && jq -e "has(\"message\") | not" /tmp/err_body_foo.json'
  期望: exit 0

- [ ] [BEHAVIOR] error path — GET /abs（缺少 n 参数）返回 HTTP 400 且 body 含 `error` 字段、禁用 `message`/`msg`/`reason`
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3096 node server.js & SPID=$!; sleep 2; curl -s -o /tmp/err_body_no_n.json -w "%{http_code}" "localhost:3096/abs" > /tmp/err_code_no_n.txt; CODE=$(cat /tmp/err_code_no_n.txt); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && jq -e "has(\"error\")" /tmp/err_body_no_n.json && jq -e "has(\"message\") | not" /tmp/err_body_no_n.json'
  期望: exit 0
