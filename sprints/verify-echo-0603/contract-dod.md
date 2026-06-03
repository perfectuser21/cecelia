---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: GET /api/brain/harness/echo 路由实现

**范围**: 新建 `packages/brain/src/routes/harness.routes.js`，注册 `GET /echo` 子路由；在 `server.js` 中挂载；响应 `{ok:true, echo:<msg>}`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.routes.js` 文件存在且注册了 GET /echo 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.routes.js','utf8');if(!c.includes('/echo')&&!c.includes('echo'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/server.js` 中导入并挂载 harness.routes.js
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('harness.routes'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] `GET /api/brain/harness/echo?msg=hello` 返回 `ok=true`
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/echo?msg=hello") || { echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e ".ok == true" || { echo "FAIL: ok不为true"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `GET /api/brain/harness/echo?msg=hello` 返回 `echo="hello"`（等于msg参数原值）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/echo?msg=hello") || { echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e ".echo == \"hello\"" || { echo "FAIL: echo字段不等于hello"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Response schema keys 完整性 — 顶层 keys 精确等于 `["echo", "ok"]`，无多余字段
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/echo?msg=hello") || { echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e "keys == [\"echo\", \"ok\"]" || { echo "FAIL: schema keys不匹配，generator可能添加了多余字段或用了替代字段名"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 边界情况 — `msg` 未传时返回 HTTP 200，`ok=true`（不报错）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/echo") || { echo "FAIL: 空msg时端点未返回200"; exit 1; }; echo "$RESP" | jq -e ".ok == true" || { echo "FAIL: 空msg时ok不为true"; exit 1; }; ECHO_VAL=$(echo "$RESP" | jq -r ".echo"); [ "$ECHO_VAL" = "" ] || [ "$ECHO_VAL" = "null" ] || { echo "FAIL: 空msg时echo值异常: $ECHO_VAL"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 边界情况 — `msg` 含中文时 URL decode 后原样返回
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/echo?msg=%E6%B5%8B%E8%AF%95") || { echo "FAIL: 中文msg时端点未返回200"; exit 1; }; echo "$RESP" | jq -e '"'"'.echo == "测试"'"'"' || { echo "FAIL: 中文msg未正确decode返回"; exit 1; }; echo OK'
  期望: OK
  来源: [FROM_PRD] — PRD 边界情况段明确定义（"`msg` 含特殊字符（空格/中文）：URL decode 后原样返回"）
