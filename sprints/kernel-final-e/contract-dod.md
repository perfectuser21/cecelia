---
skeleton: true
journey_type: autonomous
target_environment: playground
---
# Contract DoD — Sprint: kernel 终验 E — playground GET /kernel-e 返回 ok-e

**范围**: 在 `playground/server.js` 新增 `GET /kernel-e` marker 端点，返回 200 + `{"result":"ok-e"}`；新增 `playground/tests/kernel-e.test.js` 行为回归测试。不改任何现有端点。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] playground/server.js 注册 GET /kernel-e 路由
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/kernel-e['\"]/.test(c))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] playground/tests/kernel-e.test.js 存在且含 result:"ok-e" 断言
  Test: node -e "const c=require('fs').readFileSync('playground/tests/kernel-e.test.js','utf8');if(!c.includes('ok-e')||!c.includes(\"get('/kernel-e')\"))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令 — playground is_skeleton 训练 sprint，允许 node playground/server.js）

- [x] [BEHAVIOR] [L2] B-01: GET /kernel-e 返回 200 + {result:"ok-e"}
  动作: 启动 playground（PLAYGROUND_PORT=3921 node playground/server.js），就绪后 curl GET /kernel-e（无参）
  预期观察: HTTP 200，响应体 JSON 顶层字段 .result 字面值为 "ok-e"
  等待预算: 0s（同步内存返回；就绪等待另计，含 10s 就绪轮询）
  留证: curl 响应体 + jq 断言输出（OK）
  Test: manual:bash -c 'P=3921; F=/tmp/ke-$P.json; PLAYGROUND_PORT=$P node playground/server.js >/dev/null 2>&1 & SP=$!; for i in $(seq 1 40); do curl -sf localhost:$P/health >/dev/null 2>&1 && break; sleep 0.25; done; CODE=$(curl -s -o "$F" -w "%{http_code}" localhost:$P/kernel-e); kill $SP 2>/dev/null; [ "$CODE" = "200" ] || { echo "FAIL: 期望 200 实得 $CODE（404=路由未注册）"; exit 1; }; jq -e ".result==\"ok-e\"" "$F" >/dev/null || { echo "FAIL: result 非 ok-e 实得 $(cat $F)"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] [L2] B-02: HTTP 状态码恰为 200（404=路由未注册=FAIL，禁 404-acceptable）
  动作: 启动 playground，curl -w %{http_code} GET /kernel-e，只取状态码
  预期观察: 状态码字面 "200"（若路由未注册则为 404，判 FAIL）
  等待预算: 0s
  留证: 状态码变量值
  Test: manual:bash -c 'P=3922; PLAYGROUND_PORT=$P node playground/server.js >/dev/null 2>&1 & SP=$!; for i in $(seq 1 40); do curl -sf localhost:$P/health >/dev/null 2>&1 && break; sleep 0.25; done; CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:$P/kernel-e); kill $SP 2>/dev/null; [ "$CODE" = "200" ] || { echo "FAIL: 期望 200 实得 $CODE"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] [L2] B-03: 顶层 keys 完整性恰为 ["result"] 且禁用字段全不存在
  动作: 启动 playground，curl GET /kernel-e，jq 断言 keys==["result"] 且 ok/pong/operation 均不存在
  预期观察: keys 集合字面等于 ["result"]，无任何禁用字段
  等待预算: 0s
  留证: jq keys 输出 + 禁用字段反向断言输出
  Test: manual:bash -c 'P=3923; F=/tmp/ke-$P.json; PLAYGROUND_PORT=$P node playground/server.js >/dev/null 2>&1 & SP=$!; for i in $(seq 1 40); do curl -sf localhost:$P/health >/dev/null 2>&1 && break; sleep 0.25; done; CODE=$(curl -s -o "$F" -w "%{http_code}" localhost:$P/kernel-e); kill $SP 2>/dev/null; [ "$CODE" = "200" ] || { echo "FAIL: 期望 200 实得 $CODE"; exit 1; }; jq -e "keys == [\"result\"]" "$F" >/dev/null || { echo "FAIL: keys 非 [result] 实得 $(cat $F)"; exit 1; }; jq -e "(has(\"ok\") or has(\"pong\") or has(\"operation\")) | not" "$F" >/dev/null || { echo "FAIL: 禁用字段漏网 $(cat $F)"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] [L2] B-04: 边界——携带任意多余 query 参数仍稳定返回 200 + {result:"ok-e"}
  动作: 启动 playground，curl GET /kernel-e?foo=bar&x=1&value=zzz（多余参数）
  预期观察: HTTP 200，响应体 .result 仍为 "ok-e"（marker 端点不做参数校验）
  等待预算: 0s
  留证: 带参 curl 响应体 + jq 断言输出
  Test: manual:bash -c 'P=3924; F=/tmp/ke-$P.json; PLAYGROUND_PORT=$P node playground/server.js >/dev/null 2>&1 & SP=$!; for i in $(seq 1 40); do curl -sf localhost:$P/health >/dev/null 2>&1 && break; sleep 0.25; done; CODE=$(curl -s -o "$F" -w "%{http_code}" "localhost:$P/kernel-e?foo=bar&x=1&value=zzz"); kill $SP 2>/dev/null; [ "$CODE" = "200" ] || { echo "FAIL: 带多余参数期望 200 实得 $CODE"; exit 1; }; jq -e ".result==\"ok-e\"" "$F" >/dev/null || { echo "FAIL: 带多余参数未稳定返回 ok-e 实得 $(cat $F)"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] [L2] B-05: 非 GET 方法 → 404（沿用 /ping 约定，且现有端点 /ping 未回归）
  动作: 启动 playground，curl -X POST /kernel-e 取状态码；再 curl GET /ping 抽查现有端点未回归
  预期观察: POST /kernel-e 状态码 "404"，且 GET /ping 仍返回 {pong:true}
  等待预算: 0s
  留证: POST 状态码 + /ping 响应体断言输出
  Test: manual:bash -c 'P=3925; F=/tmp/ke-$P.json; PLAYGROUND_PORT=$P node playground/server.js >/dev/null 2>&1 & SP=$!; for i in $(seq 1 40); do curl -sf localhost:$P/health >/dev/null 2>&1 && break; sleep 0.25; done; PCODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:$P/kernel-e); GCODE=$(curl -s -o "$F" -w "%{http_code}" localhost:$P/ping); kill $SP 2>/dev/null; [ "$PCODE" = "404" ] || { echo "FAIL: POST 期望 404 实得 $PCODE"; exit 1; }; [ "$GCODE" = "200" ] || { echo "FAIL: /ping 期望 200 实得 $GCODE（现有端点回归）"; exit 1; }; jq -e ".pong==true" "$F" >/dev/null || { echo "FAIL: /ping 回归 $(cat $F)"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] [L2] INV-1: 合同回归测试在 vitest include 范围内（playground/tests/）真跑转绿 exit 0
  动作: 将合同测试复制进 playground/tests/kernel-e.test.js，playground 内跑 npx vitest run，采集 exit code
  预期观察: 实现后 vitest exit 0、全部用例 passed（未实现时同命令 exit 1，符合 INV-1「实跑确认 exit code 语义」）
  等待预算: 0s
  留证: vitest 输出末尾 passed 行 + exit code
  Test: manual:bash -c 'cp sprints/kernel-final-e/tests/kernel-e.test.js playground/tests/kernel-e.test.js; ( cd playground && npx vitest run tests/kernel-e.test.js ); RC=$?; rm -f playground/tests/kernel-e.test.js; [ $RC -eq 0 ] || { echo "FAIL: vitest exit=$RC"; exit 1; }; echo OK'
  期望: OK
