contract_branch: cp-harness-propose-r5-59052fde
workstream_index: 1
sprint_dir: sprints

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: 修复 playground /echo schema

**范围**: `playground/server.js` GET /echo 响应字段 `echo` → `msg`；缺失 msg 参数返回 400
**大小**: S（< 20 行净改动，1 文件）
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 的 /echo handler 响应中不含 `echo` key
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');if(c.includes('echo: msg')||c.includes(\"{ echo:\"))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `playground/server.js` 的 /echo handler 响应中含字面量 `msg` key
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');if(!c.includes('{ msg:')&&!c.includes('{msg:')&&!c.includes('msg: '))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] GET /echo?msg=hello 返回 `{"msg":"hello"}` 严 schema 字段值
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3011 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3011/echo?msg=hello"); R=$(echo "$RESP" | jq -e ".msg == \"hello\"" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: OK (exit 0)

- [x] [BEHAVIOR] GET /echo?msg=hello response keys 完整性恰好为 ["msg"]
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3012 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3012/echo?msg=hello"); R=$(echo "$RESP" | jq -e "keys == [\"msg\"]" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: OK (exit 0)

- [x] [BEHAVIOR] 禁用字段 echo 反向 — response 中 has("echo") 必须为 false
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3013 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3013/echo?msg=hello"); R=$(echo "$RESP" | jq -e "has(\"echo\") | not" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: OK (exit 0)

- [x] [BEHAVIOR] 空字符串边界 GET /echo?msg= 返回 `{"msg":""}` 非 null
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3014 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3014/echo?msg="); R=$(echo "$RESP" | jq -e ".msg == \"\"" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: OK (exit 0)

- [x] [BEHAVIOR] error path — GET /echo（缺少 msg 参数）返回 HTTP 400
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3015 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3015/echo"); kill $SPID; [ "$CODE" = "400" ]'
  期望: exit 0
