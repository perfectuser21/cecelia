---
skeleton: true
journey_type: autonomous
target_environment: playground
---
# Contract DoD — Sprint: playground GET /ping（smoke fire）

**范围**: 仅 `playground/server.js` 新增 `GET /ping` 路由 + `playground/tests/server.test.js` 新增 `describe('GET /ping')` + `playground/README.md` 新增 `/ping` 段；不动其他路由、零新依赖、不改 brain/engine/dashboard/apps。
**大小**: S

> 说明：本 sprint 为 playground 训练 sprint（`is_skeleton: true`，PRD target_environment=playground）。按 skill「playground sprint 例外」，BEHAVIOR 与 final-e2e 允许 `node playground/server.js`（不混用 Brain 5221，evaluator B33 检测）。

## ARTIFACT 条目

- [ ] [ARTIFACT] playground/server.js 注册 GET /ping 路由
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/ping['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] playground/server.js /ping 响应含字面 pong 字段（禁用 ok/status/alive/message）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/pong/.test(c))process.exit(1)"

- [ ] [ARTIFACT] playground/tests/server.test.js 新增 describe('GET /ping') 块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(\s*['\"]GET \/ping/.test(c))process.exit(1)"

- [ ] [ARTIFACT] playground/README.md 含 /ping 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/ping/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令 — autonomous / playground 例外）

- [ ] [BEHAVIOR] GET /ping → HTTP 200 + body `{"pong":true}`（schema 字段值；Golden Path Step 3）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!; for i in $(seq 1 30); do curl -sf localhost:3001/health -o /dev/null && break; sleep 0.5; done; RESP=$(curl -sf localhost:3001/ping); echo "$RESP" | jq -e ".pong == true" && echo "$RESP" | jq -e ".pong | type == \"boolean\""; RC=$?; kill $SPID 2>/dev/null; [ $RC -eq 0 ] || { echo "FAIL: pong != true (实得 $RESP)"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /ping → 顶层 keys 完全等于 `["pong"]`（schema 完整性；Golden Path Step 3）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!; for i in $(seq 1 30); do curl -sf localhost:3001/health -o /dev/null && break; sleep 0.5; done; RESP=$(curl -sf localhost:3001/ping); echo "$RESP" | jq -e "keys == [\"pong\"]"; RC=$?; kill $SPID 2>/dev/null; [ $RC -eq 0 ] || { echo "FAIL: schema 不止 pong (实得 $RESP)"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /ping → 禁用字段 ok/status/alive 均不存在（反向验证；防与 /health 混用）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!; for i in $(seq 1 30); do curl -sf localhost:3001/health -o /dev/null && break; sleep 0.5; done; RESP=$(curl -sf localhost:3001/ping); echo "$RESP" | jq -e "(has(\"ok\")|not) and (has(\"status\")|not) and (has(\"alive\")|not)"; RC=$?; kill $SPID 2>/dev/null; [ $RC -eq 0 ] || { echo "FAIL: 禁用字段漏网 (实得 $RESP)"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /ping?x=1&foo=bar → 仍 200 + `{"pong":true}`（边界：query 参数被忽略；Golden Path Step 4）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!; for i in $(seq 1 30); do curl -sf localhost:3001/health -o /dev/null && break; sleep 0.5; done; RESP=$(curl -sf "localhost:3001/ping?x=1&foo=bar"); echo "$RESP" | jq -e ".pong == true and (keys == [\"pong\"])"; RC=$?; kill $SPID 2>/dev/null; [ $RC -eq 0 ] || { echo "FAIL: 带 query 行为不一致 (实得 $RESP)"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /ping → 404（负向：仅 GET 注册，未误注册其他方法；对应 PRD 边界第 2 条）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!; for i in $(seq 1 30); do curl -sf localhost:3001/health -o /dev/null && break; sleep 0.5; done; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3001/ping); kill $SPID 2>/dev/null; [ "$CODE" = "404" ] || { echo "FAIL: POST /ping 期望 404 实得 $CODE"; exit 1; }; echo OK'
  期望: OK
