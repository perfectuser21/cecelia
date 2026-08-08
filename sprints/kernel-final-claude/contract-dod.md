---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: playground GET /kernel-pong 返回 pong

**范围**: playground/server.js 新增 `GET /kernel-pong` 路由（返回 `{ "pong": true }`）+ playground/tests/kernel-pong.test.js 最小回归测试
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] playground/server.js 含 `GET /kernel-pong` 路由且返回 `{ pong: true }`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/kernel-pong['\"]/.test(c)||!/pong:\s*true/.test(c))process.exit(1)"

- [ ] [ARTIFACT] playground/tests/kernel-pong.test.js 存在且断言 200 + {pong:true}
  Test: node -e "const c=require('fs').readFileSync('playground/tests/kernel-pong.test.js','utf8');if(!c.includes('/kernel-pong')||!c.includes('pong'))process.exit(1)"

## Invariant 覆盖（Step 1.3 铁律逐条映射）

- INV-1 [playground-e2e-端口]：已覆盖（by construction）—— 全部 [BEHAVIOR] Test 与 E2E 脚本的验证目标均为 `localhost:$PLAYGROUND_PORT`（3130-3144 段），无一条命中 Brain 5221 端口；下方 B-01~B-05 与 contract-draft.md E2E 段可逐条核对
- INV-2 [台账不入库]：N/A —— 本 sprint PR 只含 playground/ 下产物，proposer 不产出 `.harness/progress.md`（controller 台账），不会带入 repo
- INV-3 [local验证真相形态]：已覆盖 —— contract-draft.md「验证真相形态预声明」段已声明 curl HTTP 200 + jq body + 进程 exit code

## BEHAVIOR 条目（playground 训练 sprint — 每条自启 node playground/server.js，位置词只用 localhost:$PORT）

- [ ] [BEHAVIOR] [L2] B-01: GET /kernel-pong 返回 200 且 body 恰为 {"pong": true}
  动作: 启动 playground（PLAYGROUND_PORT=3140 node playground/server.js），curl GET /kernel-pong
  预期观察: HTTP 200，响应体 JSON `.pong == true` 且顶层 keys 恰为 ["pong"]
  等待预算: 0s
  留证: curl 输出 $RESP（进 behavior_tests.log_tail 与 evidence）
  Test: manual:bash -c 'PLAYGROUND_PORT=3140 node playground/server.js & SP=$!; sleep 1; RESP=$(curl -sf localhost:3140/kernel-pong) || { kill $SP 2>/dev/null; echo "FAIL: /kernel-pong 未返回 2xx"; exit 1; }; kill $SP 2>/dev/null; echo "$RESP" | jq -e ".pong==true and (keys==[\"pong\"])"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-02: 响应 keys 完整性 == ["pong"]（不允许多余字段）
  动作: 启动 playground（PLAYGROUND_PORT=3141），curl GET /kernel-pong
  预期观察: 顶层 keys 集合严格等于 ["pong"]，无附加字段
  等待预算: 0s
  留证: curl 输出 $RESP
  Test: manual:bash -c 'PLAYGROUND_PORT=3141 node playground/server.js & SP=$!; sleep 1; RESP=$(curl -sf localhost:3141/kernel-pong) || { kill $SP 2>/dev/null; echo "FAIL: /kernel-pong 未返回 2xx"; exit 1; }; kill $SP 2>/dev/null; echo "$RESP" | jq -e "keys==[\"pong\"]"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-03: 禁用 key 反向 —— kernel/ok/result/message 均不存在
  动作: 启动 playground（PLAYGROUND_PORT=3142），curl GET /kernel-pong
  预期观察: 响应 body 不含 kernel/ok/result/message 任一禁用字段
  等待预算: 0s
  留证: curl 输出 $RESP
  Test: manual:bash -c 'PLAYGROUND_PORT=3142 node playground/server.js & SP=$!; sleep 1; RESP=$(curl -sf localhost:3142/kernel-pong) || { kill $SP 2>/dev/null; echo "FAIL: /kernel-pong 未返回 2xx"; exit 1; }; kill $SP 2>/dev/null; echo "$RESP" | jq -e "(has(\"kernel\") or has(\"ok\") or has(\"result\") or has(\"message\")) | not"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-04: 带任意 query 参数忽略，仍返回 200 + {"pong": true}
  动作: 启动 playground（PLAYGROUND_PORT=3143），curl GET '/kernel-pong?x=1&foo=bar'
  预期观察: HTTP 200，`.pong == true`（query 被忽略，端点无参数语义）
  等待预算: 0s
  留证: curl 输出 $RESP
  Test: manual:bash -c 'PLAYGROUND_PORT=3143 node playground/server.js & SP=$!; sleep 1; RESP=$(curl -sf "localhost:3143/kernel-pong?x=1&foo=bar") || { kill $SP 2>/dev/null; echo "FAIL: 带 query 未返回 2xx"; exit 1; }; kill $SP 2>/dev/null; echo "$RESP" | jq -e ".pong==true"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-05: error path —— POST /kernel-pong 返回 404（不注册非 GET 方法）
  动作: 启动 playground（PLAYGROUND_PORT=3144），curl -X POST /kernel-pong
  预期观察: HTTP 状态码 404（Express 默认，无 app.all/app.use 兜底假绿）
  等待预算: 0s
  留证: HTTP 状态码 $CODE
  Test: manual:bash -c 'PLAYGROUND_PORT=3144 node playground/server.js & SP=$!; sleep 1; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3144/kernel-pong); kill $SP 2>/dev/null; [ "$CODE" = "404" ]'
  期望: exit 0
