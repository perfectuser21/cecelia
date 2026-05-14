---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground 加 GET /sum

**范围**: `playground/server.js` 加 `/sum` 路由 + `playground/tests/server.test.js` 加用例 + `playground/README.md` 更新端点段
**大小**: S（< 100 行净增，3 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 含 `/sum` 路由注册
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/sum['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 仍保留 `/health` 路由（防误删）
  Test: manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(\s*['\"]\/health['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含至少一个引用 `/sum` 的测试用例
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!c.includes('/sum'))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 同时含 200 happy path 断言 + 400 error path 断言
  Test: manual:node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!(/toBe\(200\)/.test(c)&&/toBe\(400\)/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 已更新端点段，含 `/sum` 字符串
  Test: manual:node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!c.includes('/sum'))process.exit(1)"

- [ ] [ARTIFACT] `playground/package.json` dependencies 仅 `express`（零新运行时依赖）
  Test: manual:node -e "const p=JSON.parse(require('fs').readFileSync('playground/package.json','utf8'));const d=Object.keys(p.dependencies||{});if(d.length!==1||d[0]!=='express')process.exit(1)"

## BEHAVIOR 条目（内嵌可独立执行 manual:bash 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] GET /sum?a=2&b=3 → 200 + `{sum:5}` schema 字段值严格匹配（number 类型）
  Test: manual:bash -c 'PORT=$(shuf -i 30000-40000 -n 1) && cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$! && trap "kill $SPID 2>/dev/null||true" EXIT && for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done && RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3") && echo "$RESP" | jq -e '"'"'.sum == 5'"'"' >/dev/null && echo "$RESP" | jq -e '"'"'.sum | type == "number"'"'"' >/dev/null && echo OK'
  期望: OK

- [ ] [BEHAVIOR] response keys 完整性 — 成功响应顶层 keys 恰好等于 `["sum"]`，不允许多余字段
  Test: manual:bash -c 'PORT=$(shuf -i 30000-40000 -n 1) && cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$! && trap "kill $SPID 2>/dev/null||true" EXIT && for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done && RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3") && echo "$RESP" | jq -e '"'"'keys == ["sum"]'"'"' >/dev/null && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 `error` 不出现在成功响应中（反向检查 — 防混合态 `{sum:5, error:null}`）
  Test: manual:bash -c 'PORT=$(shuf -i 30000-40000 -n 1) && cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$! && trap "kill $SPID 2>/dev/null||true" EXIT && for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done && RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3") && echo "$RESP" | jq -e '"'"'has("error") | not'"'"' >/dev/null && echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — `GET /sum?a=abc&b=3`（非数字）→ 400 + `.error` 字符串非空 + body 不含 `sum`
  Test: manual:bash -c 'PORT=$(shuf -i 30000-40000 -n 1) && cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$! && trap "kill $SPID 2>/dev/null||true" EXIT && for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done && H=$(curl -s -o /tmp/sum-nan-dod.json -w '"'"'%{http_code}'"'"' "http://127.0.0.1:$PORT/sum?a=abc&b=3") && [ "$H" = "400" ] && jq -e '"'"'.error | type == "string" and length > 0'"'"' /tmp/sum-nan-dod.json >/dev/null && jq -e '"'"'has("sum") | not'"'"' /tmp/sum-nan-dod.json >/dev/null && echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — `GET /sum?a=2`（缺 b）→ 400 + `.error` 非空字符串
  Test: manual:bash -c 'PORT=$(shuf -i 30000-40000 -n 1) && cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$! && trap "kill $SPID 2>/dev/null||true" EXIT && for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done && H=$(curl -s -o /tmp/sum-miss-dod.json -w '"'"'%{http_code}'"'"' "http://127.0.0.1:$PORT/sum?a=2") && [ "$H" = "400" ] && jq -e '"'"'.error | type == "string" and length > 0'"'"' /tmp/sum-miss-dod.json >/dev/null && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 边界数值合法 — `GET /sum?a=-1&b=1` → 200 + `{sum:0}`；小数 `a=1.5&b=2.5` → `{sum:4}`
  Test: manual:bash -c 'PORT=$(shuf -i 30000-40000 -n 1) && cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$! && trap "kill $SPID 2>/dev/null||true" EXIT && for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done && curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1" | jq -e '"'"'.sum == 0'"'"' >/dev/null && curl -fsS "http://127.0.0.1:$PORT/sum?a=1.5&b=2.5" | jq -e '"'"'.sum == 4'"'"' >/dev/null && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 回归 — `GET /health` 仍返回 200 + `{ok:true}`（不被新路由破坏）
  Test: manual:bash -c 'PORT=$(shuf -i 30000-40000 -n 1) && cd playground && PLAYGROUND_PORT=$PORT node server.js & SPID=$! && trap "kill $SPID 2>/dev/null||true" EXIT && for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done && curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '"'"'.ok == true'"'"' >/dev/null && echo OK'
  期望: OK
