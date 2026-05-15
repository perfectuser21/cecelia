---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 修复 playground/tests/echo.test.js 验证正确 schema

**范围**: `playground/tests/echo.test.js` 将 `{echo:"hello"}` 期望改为 `{msg:"hello"}`；keys assertion 改为 `["msg"]`；移除 msg 出禁用列表
**大小**: S（< 50 行改动，1 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/tests/echo.test.js` 不含字面量 `{ echo: 'hello' }` 或 `{ echo: "hello" }` 作为 response 期望
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/tests/echo.test.js','utf8');if(/toEqual\(\s*\{\s*echo:/.test(c))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `playground/tests/echo.test.js` 含 `{ msg: 'hello' }` 或 `{ msg: "hello" }` 作为 response 期望
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/tests/echo.test.js','utf8');if(!/toEqual\(\s*\{\s*msg:/.test(c))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，evaluator 直接执行）

- [ ] [BEHAVIOR] GET /echo?msg=hello 返回 {msg:"hello"} 严 schema 字段值（PRD 指定 msg key）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3011 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3011/echo?msg=hello"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e ".msg == \"hello\""'
  期望: exit 0

- [ ] [BEHAVIOR] response 严 schema 完整性 keys 恰好等于 ["msg"]（不允许多 key 不允许少 key）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3012 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3012/echo?msg=hello"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e "keys == [\"msg\"]"'
  期望: exit 0

- [ ] [BEHAVIOR] 禁用字段 echo 反向 — response 中 has("echo") 必须为 false
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3013 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3013/echo?msg=hello"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e "has(\"echo\") | not"'
  期望: exit 0

- [ ] [BEHAVIOR] 空字符串边界 GET /echo?msg= 返回 {msg:""} 非 null 非 undefined
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3014 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3014/echo?msg="); kill $SPID 2>/dev/null; echo "$RESP" | jq -e ".msg == \"\""'
  期望: exit 0

- [ ] [BEHAVIOR] error path — GET /echo（缺少 msg 参数）返回 HTTP 400 + error 字段类型为 string
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3015 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3015/echo"); RESP=$(curl -s "localhost:3015/echo"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ] && echo "$RESP" | jq -e ".error | type == \"string\""'
  期望: exit 0
