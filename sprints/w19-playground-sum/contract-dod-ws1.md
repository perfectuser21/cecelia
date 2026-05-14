---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /sum

**范围**：playground/server.js 加 `/sum` 路由 + playground/tests/server.test.js 加用例 + playground/README.md 更新端点段
**大小**：S（< 100 行）
**依赖**：无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `/sum` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/sum['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/health` 路由（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/health['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含引用 `/sum` 的测试用例（happy path + error）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes('/sum')||!/toBe\(200\)/.test(c)||!/toBe\(400\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 含 `/sum` 且不含"不在 bootstrap 范围"字样
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/sum')||/不在 bootstrap 范围/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` dependencies 仅 express，devDependencies 仅 supertest + vitest
  Test: manual:node -e "const p=require('./playground/package.json');const dep=Object.keys(p.dependencies||{});const dev=Object.keys(p.devDependencies||{}).sort().join(',');if(dep.length!==1||dep[0]!=='express'||dev!=='supertest,vitest')process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] GET /sum?a=2&b=3 → 200 + body `{sum:5}`（字段值严格正确）
  Test: manual:bash -c 'PORT=$(shuf -i 31000-31999 -n 1); cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$!; sleep 1; RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e ".sum == 5"'
  期望: exit 0（jq 输出 true）

- [ ] [BEHAVIOR] response schema 完整性：顶层 keys 恰好 `["sum"]`，无多余字段
  Test: manual:bash -c 'PORT=$(shuf -i 32000-32999 -n 1); cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$!; sleep 1; RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e "keys == [\"sum\"]"'
  期望: exit 0（jq 输出 true）

- [ ] [BEHAVIOR] 禁用字段 result 不存在（反向检查，防 generator 漂移到 {result:5}）
  Test: manual:bash -c 'PORT=$(shuf -i 33000-33999 -n 1); cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$!; sleep 1; RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e "has(\"result\") | not"'
  期望: exit 0（jq 输出 true，即 result 字段不存在）

- [ ] [BEHAVIOR] error path GET /sum?a=abc&b=3 → HTTP 400 + `.error` 是非空字符串 + body 不含 sum
  Test: manual:bash -c 'PORT=$(shuf -i 34000-34999 -n 1); cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$!; sleep 1; H=$(curl -s -o /tmp/dod-nan.json -w "%{http_code}" "http://127.0.0.1:$PORT/sum?a=abc&b=3"); kill $SPID 2>/dev/null; [ "$H" = "400" ] && jq -e ".error | type == \"string\" and length > 0" /tmp/dod-nan.json && jq -e "has(\"sum\") | not" /tmp/dod-nan.json'
  期望: exit 0（HTTP 400 + error 非空 + 无 sum 字段）

- [ ] [BEHAVIOR] 缺参 GET /sum?a=2（b 缺失）→ HTTP 400 + `.error` 非空字符串
  Test: manual:bash -c 'PORT=$(shuf -i 35000-35999 -n 1); cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$!; sleep 1; H=$(curl -s -o /tmp/dod-miss.json -w "%{http_code}" "http://127.0.0.1:$PORT/sum?a=2"); kill $SPID 2>/dev/null; [ "$H" = "400" ] && jq -e ".error | type == \"string\" and length > 0" /tmp/dod-miss.json'
  期望: exit 0（HTTP 400 + error 非空）

- [ ] [BEHAVIOR] 负数合法：GET /sum?a=-1&b=1 → 200 + `{sum:0}`
  Test: manual:bash -c 'PORT=$(shuf -i 36000-36999 -n 1); cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$!; sleep 1; RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e ".sum == 0"'
  期望: exit 0

- [ ] [BEHAVIOR] 回归：GET /health 仍 200 + `{ok:true}`
  Test: manual:bash -c 'PORT=$(shuf -i 37000-37999 -n 1); cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$!; sleep 1; RESP=$(curl -fsS "http://127.0.0.1:$PORT/health"); kill $SPID 2>/dev/null; echo "$RESP" | jq -e ".ok == true"'
  期望: exit 0
