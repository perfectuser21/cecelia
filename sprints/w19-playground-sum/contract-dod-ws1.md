---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /sum

**范围**：playground/server.js 加 `/sum` 路由 + playground/tests/server.test.js 加用例 + playground/README.md 更新端点段
**大小**：S（< 100 行）
**依赖**：无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `/sum` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/sum['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/health` 路由（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/health['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含至少一个引用 `/sum` 的测试用例
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes('/sum'))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 happy path（200）+ error path（400）双断言
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/toBe\(200\)/.test(c)&&/toBe\(400\)/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 已更新端点段，`/sum` 有记录
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/sum'))process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` 未新增运行时依赖（dependencies 仅 express）
  Test: manual:node -e "const p=require('./playground/package.json');const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，v7.4+ 格式）

- [ ] [BEHAVIOR] GET /sum?a=2&b=3 返 200 + {sum:5}，字段值 + 类型双重验证
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=30011 node server.js & SPID=$!; sleep 2; RESP=$(curl -sf "localhost:30011/sum?a=2&b=3"); R=$(echo "$RESP" | jq -e ".sum == 5 and (.sum | type) == \"number\"" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0（R=OK）

- [ ] [BEHAVIOR] GET /sum?a=2&b=3 response schema 完整性：keys 恰好等于 ["sum"]，不多不少
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=30012 node server.js & SPID=$!; sleep 2; RESP=$(curl -sf "localhost:30012/sum?a=2&b=3"); R=$(echo "$RESP" | jq -e "keys == [\"sum\"]" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 禁用字段反向检查：success 响应不含 total / result / answer 字段
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=30013 node server.js & SPID=$!; sleep 2; RESP=$(curl -sf "localhost:30013/sum?a=2&b=3"); R=$(echo "$RESP" | jq -e "(has(\"total\") | not) and (has(\"result\") | not) and (has(\"answer\") | not)" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] error path — 非数字参数返 HTTP 400 + body 含非空 error 字段 + body 不含 sum 字段
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=30014 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:30014/sum?a=abc&b=3"); EBODY=$(curl -s "localhost:30014/sum?a=abc&b=3"); kill $SPID; [ "$CODE" = "400" ] && echo "$EBODY" | jq -e ".error | type == \"string\" and length > 0" && echo "$EBODY" | jq -e "has(\"sum\") | not"'
  期望: exit 0

- [ ] [BEHAVIOR] error path — 缺少 b 参数时返 HTTP 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=30015 node server.js & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:30015/sum?a=2"); kill $SPID; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 负数合法：GET /sum?a=-1&b=1 返 200 + {sum:0}
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=30016 node server.js & SPID=$!; sleep 2; R=$(curl -sf "localhost:30016/sum?a=-1&b=1" | jq -e ".sum == 0" && echo OK); kill $SPID; [ "$R" = "OK" ]'
  期望: exit 0
