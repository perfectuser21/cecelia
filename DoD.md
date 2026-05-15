contract_branch: cp-harness-propose-r3-84249dfd
workstream_index: 1
sprint_dir: sprints

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: GET /echo 端点实现

**范围**: `playground/server.js` 新增 GET /echo 路由，读取 `msg` query 参数原样回显；`playground/tests/echo.test.js` vitest 单元测试
**大小**: S（< 100 行净增，≤ 2 文件）
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `playground/server.js` 内含 `/echo` 路由注册
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/echo['\"]/.test(c))process.exit(1)"

- [x] [ARTIFACT] `playground/server.js` `/echo` 路由使用 query 名 `msg`（不使用禁用名 text/input/message/q/str/value/content/m）
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/echo[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/req\.query\.msg/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] `playground/tests/echo.test.js` 文件存在
  Test: node -e "require('fs').accessSync('/workspace/playground/tests/echo.test.js')"

- [x] [ARTIFACT] TDD Red 阶段验证 — Generator commit 1（仅测试文件，无实现）时 vitest 必须 exit≠0（防止 Generator 写空实现绕过 Red 阶段）
  Test: bash -c 'cat /tmp/ws1-red.log 2>/dev/null | grep -qE "FAIL|failed|✗" || { echo "FAIL: 缺少 Red 证据日志，Generator 未执行 TDD Red 阶段"; exit 1; }'
  说明: Generator 在 commit 1 后必须运行 `PD="${GITHUB_WORKSPACE:-/workspace}/playground"; cd "$PD" && npm install --silent 2>/dev/null;  && npm install && npx vitest run tests/echo.test.js 2>&1 | tee /tmp/ws1-red.log`，exit code 非 0；Evaluator 核查此日志确认测试真红

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接执行）

- [x] [BEHAVIOR] GET /echo?msg=hello → 200 + {echo: "hello"} 字段值严格匹配
  Test: manual:bash -c 'pkill -f "PLAYGROUND_PORT=3191" 2>/dev/null || true; sleep 1; PD="${GITHUB_WORKSPACE:-/workspace}/playground"; cd "$PD" && npm install --silent 2>/dev/null;  && PLAYGROUND_PORT=3191 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3191/echo?msg=hello"); R=$(echo "$RESP" | jq -e ".echo == \"hello\"" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [x] [BEHAVIOR] response 顶层 keys 严格等于 ["echo"]（schema 完整性，不允许多余字段）
  Test: manual:bash -c 'pkill -f "PLAYGROUND_PORT=3192" 2>/dev/null || true; sleep 1; PD="${GITHUB_WORKSPACE:-/workspace}/playground"; cd "$PD" && npm install --silent 2>/dev/null;  && PLAYGROUND_PORT=3192 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3192/echo?msg=test"); R=$(echo "$RESP" | jq -e "keys == [\"echo\"]" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [x] [BEHAVIOR] 禁用 key 反向不存在（message/result/response/data/output/text/reply/body/msg 均不得出现）
  Test: manual:bash -c 'pkill -f "PLAYGROUND_PORT=3193" 2>/dev/null || true; sleep 1; PD="${GITHUB_WORKSPACE:-/workspace}/playground"; cd "$PD" && npm install --silent 2>/dev/null;  && PLAYGROUND_PORT=3193 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3193/echo?msg=x"); FAIL=0; for k in message result response data output text reply body msg; do if echo "$RESP" | jq -e "has(\"$k\")" >/dev/null 2>&1; then echo "FAIL: 禁用字段 $k 存在"; FAIL=1; fi; done; kill $SPID 2>/dev/null; [ $FAIL -eq 0 ]'
  期望: exit 0

- [x] [BEHAVIOR] 空字符串边界 GET /echo?msg= → 200 + {echo: ""} （非 null 非 undefined）
  Test: manual:bash -c 'pkill -f "PLAYGROUND_PORT=3194" 2>/dev/null || true; sleep 1; PD="${GITHUB_WORKSPACE:-/workspace}/playground"; cd "$PD" && npm install --silent 2>/dev/null;  && PLAYGROUND_PORT=3194 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3194/echo?msg="); R=$(echo "$RESP" | jq -e ".echo == \"\"" >/dev/null 2>&1 && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0
