---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: GET /api/brain/harness/ping 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /ping` 路由，返回 `{"ok":true,"ts":"<ISO>"}` 
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/ping` 路由 handler
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/ping'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 测试文件存在于 `packages/brain/src/routes/__tests__/harness.ping.test.js`
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/__tests__/harness.ping.test.js');console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /api/brain/harness/ping 返回 HTTP 200
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/harness/ping); [ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应体 ok 字段为布尔 true
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) || { echo "FAIL: curl 失败"; exit 1; }; echo "$RESP" | jq -e ".ok == true" || { echo "FAIL: ok 不为 true"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应体 ts 字段为 string 类型（ISO 8601）
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) || exit 1; echo "$RESP" | jq -e ".ts | type == \"string\"" || { echo "FAIL: ts 不是 string"; exit 1; }; TS=$(echo "$RESP" | jq -r ".ts"); [[ "$TS" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] || { echo "FAIL: ts 不符合 ISO 8601 $TS"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应体 keys 完整性 — 严格等于 ["ok","ts"]
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) || exit 1; echo "$RESP" | jq -e "keys == [\"ok\",\"ts\"]" || { echo "FAIL: keys 不等于 [ok,ts]"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 status/alive/pong/timestamp 均不存在
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) || exit 1; echo "$RESP" | jq -e "has(\"status\") | not" || { echo "FAIL: 禁用字段 status"; exit 1; }; echo "$RESP" | jq -e "has(\"alive\") | not" || { echo "FAIL: 禁用字段 alive"; exit 1; }; echo "$RESP" | jq -e "has(\"pong\") | not" || { echo "FAIL: 禁用字段 pong"; exit 1; }; echo "$RESP" | jq -e "has(\"timestamp\") | not" || { echo "FAIL: 禁用字段 timestamp"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 未实现时 curl -sf 返回非零退出码（防 Brain 通用 404 假绿）
  Test: manual:bash -c 'RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) || { echo "FAIL: 端点不存在（路由未注册）"; exit 1; }; echo OK'
  期望: OK（此条在 generator 实现后才 PASS，实现前 FAIL 即 Red 证据）

## Risks

| 风险 | Mitigation |
|---|---|
| E2E 时 Brain 未启动，`connection refused` 与路由未注册的 404 失败表现不同但难以区分 | final-e2e 首先探 `/api/brain/context` 存活；BEHAVIOR 命令若返回 connection refused，说明 Brain 未启动而非路由未实现 |
