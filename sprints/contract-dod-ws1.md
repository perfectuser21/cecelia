---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /subtract 路由 + 测试块

**范围**: 在 `playground/server.js` 新增 `GET /subtract` 路由（复用 `STRICT_NUMBER` regex `^-?\d+(\.\d+)?$`，校验 a/b 存在且合法，计算 `Number(a) - Number(b)`，返回 `{result: <number>, operation: "subtract"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /subtract', ...)` 测试块  
**大小**: M（server.js ~35 行 + tests ~80 行 = ~115 行）  
**依赖**: 无（唯一 workstream）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 内含 `/subtract` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/subtract['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 的 `/subtract` 路由使用 query 名 `a` 和 `b`（不使用禁用名 x/y/p/q/n/m/v1/v2）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/subtract[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\b(req\.query\.a|\{\s*a\s*[,}])/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 的 `/subtract` 路由响应含字面 `operation: "subtract"`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/subtract[\s\S]*?\}\);/);if(!m||!/operation\s*:\s*['\"]subtract['\"]/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 的 `/subtract` 路由响应含字面 `result` 字段（不漂移到 difference/diff/value/answer/data）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/subtract[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bresult\s*:/.test(m[0]))process.exit(1);for(const k of ['difference','diff','value','answer','data']){if(new RegExp('\\b'+k+'\\s*:').test(m[0])){console.error('forbidden key '+k);process.exit(1)}}"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 内含 `describe('GET /subtract'` 块
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/subtract/.test(c))process.exit(1)"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，playground target_environment）

> target_environment: playground — BEHAVIOR 命令使用 `node playground/server.js`（playground sprint 例外规则）

- [ ] [BEHAVIOR] GET /subtract?a=10&b=3 → HTTP 200 + `{result:7, operation:"subtract"}`（schema 字段值验证）
  Test: manual:bash -c 'PLAYGROUND_PORT=3401 NODE_ENV=production node playground/server.js > /tmp/dod-b1.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -sf "http://localhost:3401/subtract?a=10&b=3") || { kill $SPID; echo "FAIL: 端点未返回 200"; exit 1; }; echo "$RESP" | jq -e '"'"'.result == 7'"'"' || { kill $SPID; echo "FAIL: result != 7"; exit 1; }; echo "$RESP" | jq -e '"'"'.operation == "subtract"'"'"' || { kill $SPID; echo "FAIL: operation != subtract"; exit 1; }; kill $SPID; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /subtract?a=10&b=3 → 顶层 keys = `["operation","result"]`（keys 完整性，不多不少）
  Test: manual:bash -c 'PLAYGROUND_PORT=3402 NODE_ENV=production node playground/server.js > /tmp/dod-b2.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -sf "http://localhost:3402/subtract?a=10&b=3") || { kill $SPID; exit 1; }; echo "$RESP" | jq -e '"'"'keys | sort == ["operation","result"]'"'"' || { kill $SPID; echo "FAIL: keys 不合规"; exit 1; }; kill $SPID; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /subtract?a=10&b=3 → 响应不含任一禁用字段 difference/diff/value/answer/data（禁用字段反向验证）
  Test: manual:bash -c 'PLAYGROUND_PORT=3403 NODE_ENV=production node playground/server.js > /tmp/dod-b3.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -sf "http://localhost:3403/subtract?a=10&b=3") || { kill $SPID; exit 1; }; for k in difference diff value answer data; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { kill $SPID; echo "FAIL: 禁用字段 $k 出现"; exit 1; }; done; kill $SPID; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 缺参 a → HTTP 400 + error 字段类型为 string（error path — 缺参）
  Test: manual:bash -c 'PLAYGROUND_PORT=3404 NODE_ENV=production node playground/server.js > /tmp/dod-b4.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/dod-err.json -w "%{http_code}" "http://localhost:3404/subtract?b=3"); [ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 缺 a 应返 400，实际 $CODE"; exit 1; }; jq -e '"'"'.error | type == "string"'"'"' /tmp/dod-err.json || { kill $SPID; echo "FAIL: error 字段不存在"; exit 1; }; kill $SPID; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /subtract 4 种非法格式（1e5/Inf/%2B1/0xFF）→ 全部 HTTP 400（error path — 非法格式拒绝）
  Test: manual:bash -c 'PLAYGROUND_PORT=3405 NODE_ENV=production node playground/server.js > /tmp/dod-b5.log 2>&1 & SPID=$!; sleep 2; for bad in "a=1e5&b=3" "a=Inf&b=3" "a=%2B1&b=3" "a=0xFF&b=3"; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3405/subtract?$bad"); [ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: $bad 应返 400，实际 $CODE"; exit 1; }; done; kill $SPID; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /subtract?a=3&b=10 → HTTP 200 + result=-7（负数结果正常返回）
  Test: manual:bash -c 'PLAYGROUND_PORT=3406 NODE_ENV=production node playground/server.js > /tmp/dod-b6.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -sf "http://localhost:3406/subtract?a=3&b=10") || { kill $SPID; exit 1; }; echo "$RESP" | jq -e '"'"'.result == -7'"'"' || { kill $SPID; echo "FAIL: result 应为 -7"; exit 1; }; kill $SPID; echo OK'
  期望: OK

---

## Risks

### RISK-1: Bug 10 假绿回归风险（端口冲突导致 BEHAVIOR 命令 exit 0）

**描述**: 若 Generator 没有正确实现 `/subtract` 路由，但测试机器上已有进程占用 3401-3406 端口中某一端口（或上一次测试残留进程未 kill），`node playground/server.js` 在该端口静默启动失败，`curl -sf` 转而连到已存在进程的旧 handler，老路由返回 404 → `curl -sf` exit 1 → BEHAVIOR FAIL。但若旧进程碰巧返回 200（如同端口 Express 兼容响应），则 BEHAVIOR 假绿通过，Generator 不实现也能 PASS。

**缓解措施**:
1. 每条 BEHAVIOR 命令使用不同端口（3401-3406 分开），降低碰撞概率
2. 每条命令在 `kill $SPID` 后加 `sleep 1` 以确保端口释放
3. Evaluator 在跑 BEHAVIOR 前应先 `lsof -ti tcp:3401-3406 | xargs kill -9 2>/dev/null || true` 清空端口
4. Contract 验证命令用 `PLAYGROUND_PORT` 动态赋值，evaluator 可注入空闲端口

**残余风险**: 低。各 Step 端口已不同；假绿要求旧进程碰巧返回同格式 JSON，概率极低。

---

### RISK-2: STRICT_NUMBER regex 不存在风险

**描述**: PRD 写 `[ASSUMPTION: playground/server.js 已有 STRICT_NUMBER regex 可复用]`。若 Generator 查到 `playground/server.js` 里不存在此 regex，需自行定义。若 Generator 误判（如把 `/^\d+$/` 当 STRICT_NUMBER 使用），非法格式 `+1`/`-1`/`.5` 等可能漏网，B5 BEHAVIOR（四种格式 400）会 FAIL。

**缓解措施**: Generator 应先 grep `playground/server.js` 确认 STRICT_NUMBER 是否存在；若不存在则**自行定义** `const STRICT_NUMBER = /^-?\d+(\.\d+)?$/` 并注释 `// defined per PRD assumption`；B5 已扩展为循环验 4 种格式，任何一种漏判均能抓出。
