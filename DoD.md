contract_branch: cp-harness-propose-r2-ed20a544
workstream_index: 1
sprint_dir: sprints/w33-walking-skeleton-happy

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /ping 路由 + 单测 + README

**范围**: 在 `playground/server.js` 新增 `GET /ping` 路由（**单行 handler** `(req, res) => res.json({ pong: true })`；**不读 query**、**不加输入校验**、**不加 error 分支**、**不加 method 守卫**——本 endpoint 在定义层面不存在拒绝路径）；在 `playground/tests/server.test.js` 新增 `describe('GET /ping', ...)` 块；在 `playground/README.md` 加 `/ping` 端点说明（至少 1 个 happy 示例）
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 内含 `/ping` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/ping['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/ping` 路由响应字面含 `pong` 字段（不漂到 `ping`/`status`/`ok`/`result`/`message` 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/ping['\"][\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bpong\s*:/.test(m[0]))process.exit(1);for(const k of ['status','alive','healthy','pong_value','is_alive','is_ok','message','data','payload','answer']){if(new RegExp('\\b'+k+'\\s*:').test(m[0])){console.error('forbidden key '+k);process.exit(1)}}"

- [ ] [ARTIFACT] `playground/server.js` 内 `/ping` 路由响应字面含布尔字面量 `true`（不漂到字符串 `"true"`/数字 `1`/字符串 `"ok"`/字符串 `"pong"` 等）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/ping['\"][\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bpong\s*:\s*true\b/.test(m[0])){console.error('pong must be literal boolean true');process.exit(1)}"

- [ ] [ARTIFACT] `playground/server.js` 内 `/ping` 路由不含 query 校验（trivial spec 反画蛇添足）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/ping['\"][\s\S]*?\}\);/);if(!m)process.exit(1);if(/req\.query/.test(m[0])){console.error('/ping must not read req.query (trivial spec)');process.exit(1)};if(/status\(40[0-9]\)/.test(m[0])){console.error('/ping must not return 4xx (trivial spec)');process.exit(1)}"

- [ ] [ARTIFACT] `playground/server.js` 末尾保留 `export default app`（tests/ws1/ping.test.js 依赖此 default export 做 supertest，generator 修改 server.js 时不许误删此行）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/^export\s+default\s+app\s*;?\s*$/m.test(c)){console.error('missing: export default app');process.exit(1)}"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 新增 `describe('GET /ping'` 块（独立 describe，与其他 endpoint 平级）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/ping/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 端点列表含 `/ping` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/ping/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] GET /ping → HTTP 200 + body `.pong == true`（字面布尔 true）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3611 node server.js > /tmp/ws1-b1.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3611/ping"); RESP=$(curl -fs "http://localhost:3611/ping"); kill $SPID 2>/dev/null; [ "$CODE" = "200" ] || { echo "FAIL: status=$CODE"; exit 1; }; echo "$RESP" | jq -e ".pong == true" >/dev/null || { echo "FAIL: .pong != true (body=$RESP)"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /ping 响应 `.pong` 类型必须是 boolean（不是 string/number/object/array）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3612 node server.js > /tmp/ws1-b2.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3612/ping"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e ".pong | type == \"boolean\"" >/dev/null || { echo "FAIL: .pong type != boolean (body=$RESP)"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /ping 响应顶层 keys 字面集合等于 ["pong"] 且 length == 1（schema 完整性）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3613 node server.js > /tmp/ws1-b3.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3613/ping"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e "keys | sort == [\"pong\"]" >/dev/null || { echo "FAIL: keys != [pong] (body=$RESP)"; exit 1; }; echo "$RESP" | jq -e "length == 1" >/dev/null || { echo "FAIL: length != 1 (body=$RESP)"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /ping 响应不含任一禁用字段名 (ping/status/ok/alive/healthy/result/message/data/payload/value/sum/product/operation 等)
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3614 node server.js > /tmp/ws1-b4.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3614/ping"); kill $SPID 2>/dev/null; for k in ping status ok alive healthy response result message pong_value is_alive is_ok data payload body output answer value meta info sum product quotient power remainder factorial negation operation; do echo "$RESP" | jq -e "has(\"$k\") | not" >/dev/null || { echo "FAIL: 禁用字段 $k 出现 (body=$RESP)"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /ping?x=1 与 GET /ping?pong=false 仍返 200 + 同 body（query 静默忽略，反画蛇添足）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3615 node server.js > /tmp/ws1-b5.log 2>&1 & SPID=$!; sleep 2; CODE1=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3615/ping?x=1"); CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3615/ping?pong=false"); RESP1=$(curl -fs "http://localhost:3615/ping?x=1"); RESP2=$(curl -fs "http://localhost:3615/ping?pong=false"); kill $SPID 2>/dev/null; [ "$CODE1" = "200" ] || { echo "FAIL: /ping?x=1 status=$CODE1"; exit 1; }; [ "$CODE2" = "200" ] || { echo "FAIL: /ping?pong=false status=$CODE2"; exit 1; }; echo "$RESP1" | jq -e ".pong == true" >/dev/null || { echo "FAIL: ?x=1 .pong!=true"; exit 1; }; echo "$RESP2" | jq -e ".pong == true" >/dev/null || { echo "FAIL: ?pong=false .pong!=true"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 连续 3 次 GET /ping 返同一 raw body（确定性，无 timestamp/uptime/request_id 时变字段）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3616 node server.js > /tmp/ws1-b6.log 2>&1 & SPID=$!; sleep 2; R1=$(curl -fs "http://localhost:3616/ping"); R2=$(curl -fs "http://localhost:3616/ping"); R3=$(curl -fs "http://localhost:3616/ping"); kill $SPID 2>/dev/null; [ "$R1" = "$R2" ] || { echo "FAIL: R1 != R2 (R1=$R1 R2=$R2)"; exit 1; }; [ "$R2" = "$R3" ] || { echo "FAIL: R2 != R3"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 既有 8 路由 (/health /sum /multiply /divide /power /modulo /factorial /increment) happy 用例回归全通过
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3617 node server.js > /tmp/ws1-b7.log 2>&1 & SPID=$!; sleep 2; FAIL=""; curl -fs "http://localhost:3617/health" | jq -e ".ok == true" >/dev/null || FAIL="$FAIL /health"; curl -fs "http://localhost:3617/sum?a=2&b=3" | jq -e ".sum == 5" >/dev/null || FAIL="$FAIL /sum"; curl -fs "http://localhost:3617/multiply?a=7&b=5" | jq -e ".product == 35" >/dev/null || FAIL="$FAIL /multiply"; curl -fs "http://localhost:3617/divide?a=10&b=2" | jq -e ".quotient == 5" >/dev/null || FAIL="$FAIL /divide"; curl -fs "http://localhost:3617/power?a=2&b=10" | jq -e ".power == 1024" >/dev/null || FAIL="$FAIL /power"; curl -fs "http://localhost:3617/modulo?a=10&b=3" | jq -e ".remainder == 1" >/dev/null || FAIL="$FAIL /modulo"; curl -fs "http://localhost:3617/factorial?n=5" | jq -e ".factorial == 120" >/dev/null || FAIL="$FAIL /factorial"; curl -fs "http://localhost:3617/increment?value=5" | jq -e ".result == 6" >/dev/null || FAIL="$FAIL /increment"; kill $SPID 2>/dev/null; [ -z "$FAIL" ] || { echo "FAIL: regression$FAIL"; exit 1; }; echo OK'
  期望: OK
