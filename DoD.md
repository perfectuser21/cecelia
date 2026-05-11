contract_branch: cp-harness-propose-r2-6633ebbf
workstream_index: 1
sprint_dir: sprints/w28-playground-divide

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground `/divide` 响应形态统一为 `{result, operation: "divide"}`

**范围**: 改 `playground/server.js` `/divide` 路由成功响应一行 + `playground/tests/server.test.js` `GET /divide` describe 块断言 + `playground/README.md` `/divide` 段示例。其余 7 条端点（/health, /sum, /multiply, /power, /modulo, /factorial, /increment）一字不动。零新依赖。
**大小**: S
**依赖**: 无

> **PRD 字面引用**：response success keys 字面集合 = `["operation","result"]`；`operation` 字面字符串 = `"divide"`；error keys 字面集合 = `["error"]`；query param 名字面 = `a` 与 `b`；禁用 response 字段（首要 + generic + 跨端点 全集） = `quotient` / `division` / `divided` / `divisor_result` / `divide_result` / `div` / `ratio` / `share` / `value` / `input` / `output` / `data` / `payload` / `response` / `answer` / `out` / `meta` / `dividend` / `divisor` / `numerator` / `denominator` / `sum` / `product` / `power` / `remainder` / `factorial`；禁用 error 替代名 = `message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code` / `status` / `kind`；strict-schema 正则字面 = `^-?\d+(\.\d+)?$`。

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` `/divide` 成功响应字面含 `result:` 与 `operation:` 字段 + 字面字符串 `'divide'` 或 `"divide"`；且 `/divide` 路由代码块字面**不再含** `quotient`
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('playground/server.js','utf8');const idx=s.indexOf(\"app.get('/divide'\");if(idx<0)process.exit(1);const block=s.slice(idx,idx+1500);if(!/result\s*:/.test(block)||!/operation\s*:\s*['\"]divide['\"]/.test(block)||/quotient/.test(block))process.exit(1);"
  期望: exit 0

- [ ] [ARTIFACT] `playground/server.js` `/divide` 路由仍含 `Number(b) === 0` 显式除零判定（位置在 strict-schema 通过后、除法运算之前）
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('playground/server.js','utf8');const idx=s.indexOf(\"app.get('/divide'\");const end=s.indexOf(\"app.get('/power'\",idx);const block=s.slice(idx,end);if(!/Number\(b\)\s*===\s*0/.test(block))process.exit(1);"
  期望: exit 0

- [ ] [ARTIFACT] `playground/server.js` `/divide` 路由仍含 strict-schema 校验（`STRICT_NUMBER` 常量引用 **或** 字面正则 `^-?\d+(\.\d+)?$`）
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('playground/server.js','utf8');const idx=s.indexOf(\"app.get('/divide'\");const end=s.indexOf(\"app.get('/power'\",idx);const block=s.slice(idx,end);if(!(/STRICT_NUMBER\.test/.test(block)||/\^-\?\\d\+\(\\\.\\d\+\)\?\$/.test(block)))process.exit(1);"
  期望: exit 0

- [ ] [ARTIFACT] `playground/server.js` 仍含全部 7 条其他路由：`/health`、`/sum`、`/multiply`、`/power`、`/modulo`、`/factorial`、`/increment`（防误删 / 防本 PR 越界）
  Test: bash -c 'set -e; for R in /health /sum /multiply /power /modulo /factorial /increment; do grep -q "app.get(.${R}." playground/server.js || { echo "miss $R"; exit 1; }; done'
  期望: exit 0

- [ ] [ARTIFACT] `playground/tests/server.test.js` `GET /divide` describe 块字面**不再含** `res.body.quotient` 或 `{ quotient` 残留断言；改用 `res.body.result` + `res.body.operation`
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('playground/tests/server.test.js','utf8');const m=s.match(/describe\(['\"]GET \/divide[^]*?\n\}\);/);if(!m)process.exit(1);const blk=m[0];if(/res\.body\.quotient/.test(blk)||/\{\s*quotient\s*:/.test(blk))process.exit(1);if(!/res\.body\.result/.test(blk)||!/res\.body\.operation/.test(blk))process.exit(1);"
  期望: exit 0

- [ ] [ARTIFACT] `playground/README.md` `/divide` 段示例响应字面含 `"result"` 与 `"operation": "divide"`，且字面不再含 `"quotient"`
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('playground/README.md','utf8');const i=s.indexOf('GET /divide');const j=s.indexOf('GET /power',i);const blk=s.slice(i,j>0?j:s.length);if(!/\"result\"/.test(blk)||!/\"operation\"\s*:\s*\"divide\"/.test(blk)||/\"quotient\"/.test(blk))process.exit(1);"
  期望: exit 0

- [ ] [ARTIFACT] `playground/package.json` 仍零新依赖（dependencies 仅 `express`，devDependencies 仅 `supertest` + `vitest`）
  Test: node -e "const p=require('./playground/package.json');const okD=Object.keys(p.dependencies||{}).sort().join(',')==='express';const okDD=Object.keys(p.devDependencies||{}).sort().join(',')==='supertest,vitest';if(!okD||!okDD)process.exit(1);"
  期望: exit 0

---

## BEHAVIOR 条目（每条内嵌可独立执行 manual:bash 命令；evaluator 真起服务真校验）

- [ ] [BEHAVIOR] `GET /divide?a=6&b=2` → HTTP 200 + body 严 schema `{result: 3, operation: "divide"}`，顶层 keys 字面集合 = `["operation","result"]`，且禁用字段 `quotient` 不存在
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3201 NODE_ENV=production node server.js > /tmp/srv.log 2>&1 & SPID=$!; trap "kill $SPID 2>/dev/null" EXIT; sleep 2; RESP=$(curl -fs "localhost:3201/divide?a=6&b=2"); echo "$RESP" | jq -e ".result == 3 and .operation == \"divide\" and (keys | sort == [\"operation\",\"result\"]) and (has(\"quotient\") | not)"'
  期望: exit 0

- [ ] [BEHAVIOR] `GET /divide?a=1&b=3` 与 `GET /divide?a=10&b=3` → 不能整除浮点 oracle 复算严格相等（`.result === Number(a)/Number(b)`）且 `.operation == "divide"`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3202 NODE_ENV=production node server.js > /tmp/srv.log 2>&1 & SPID=$!; trap "kill $SPID 2>/dev/null" EXIT; sleep 2; E13=$(node -e "process.stdout.write(String(1/3))"); E103=$(node -e "process.stdout.write(String(10/3))"); curl -fs "localhost:3202/divide?a=1&b=3" | jq -e --argjson e "$E13" ".result == \$e and .operation == \"divide\"" && curl -fs "localhost:3202/divide?a=10&b=3" | jq -e --argjson e "$E103" ".result == \$e and .operation == \"divide\""'
  期望: exit 0

- [ ] [BEHAVIOR] `GET /divide` 成功响应顶层 keys 字面**严格集合相等** `["operation","result"]`（不允许 `quotient` / `dividend` / `divisor` / `value` 等任何附加字段共存）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3203 NODE_ENV=production node server.js > /tmp/srv.log 2>&1 & SPID=$!; trap "kill $SPID 2>/dev/null" EXIT; sleep 2; curl -fs "localhost:3203/divide?a=1.5&b=0.5" | jq -e "keys | sort == [\"operation\",\"result\"]"'
  期望: exit 0

- [ ] [BEHAVIOR] `GET /divide` 成功响应 `.operation` 字面字符串严格等于 `"divide"`（不许 `"div"` / `"division"` / `"divided"` / `"divisor_op"` / `"op"` 等变体）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3204 NODE_ENV=production node server.js > /tmp/srv.log 2>&1 & SPID=$!; trap "kill $SPID 2>/dev/null" EXIT; sleep 2; curl -fs "localhost:3204/divide?a=-6&b=-2" | jq -e ".operation == \"divide\""'
  期望: exit 0

- [ ] [BEHAVIOR] 禁用字段反向 — `GET /divide` 响应**不含** 历史 W21 字段名 `quotient` / `divisor_result` / `divide_result`，**不含** 同义漂移名 `division`/`divided`/`div`/`ratio`/`share`/`value`/`dividend`/`divisor`/`numerator`/`denominator`，**不含** generic 漂移名 `input`/`response`/`out`/`answer`/`data`/`payload`/`output`/`meta`，**不含** 跨端点复用名 `sum`/`product`/`power`/`remainder`/`factorial`
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3205 NODE_ENV=production node server.js > /tmp/srv.log 2>&1 & SPID=$!; trap "kill $SPID 2>/dev/null" EXIT; sleep 2; RESP=$(curl -fs "localhost:3205/divide?a=6&b=2"); for K in quotient division divided div ratio share value dividend divisor numerator denominator input response out divisor_result divide_result sum product power remainder factorial answer data payload output meta; do echo "$RESP" | jq -e --arg k "$K" "has(\$k) | not" || { echo "FAIL: $K"; exit 1; }; done'
  期望: exit 0

- [ ] [BEHAVIOR] error path — `GET /divide?a=5&b=0` / `?a=0&b=0` / `?a=6&b=0.0` / `?a=6&b=-0` 4 种 b=0 变体全返 HTTP 400 + `{error: <非空 string>}`，错误响应顶层 keys 字面集合 = `["error"]`，body 不含 `result` 不含 `operation`，**且不含 PRD 错误响应禁用替代名 `message`/`msg`/`reason`/`detail`/`details`/`description`/`info`/`code`/`status`/`kind`**
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3206 NODE_ENV=production node server.js > /tmp/srv.log 2>&1 & SPID=$!; trap "kill $SPID 2>/dev/null" EXIT; sleep 2; for Q in "a=5&b=0" "a=0&b=0" "a=6&b=0.0" "a=6&b=-0"; do CODE=$(curl -s -o /tmp/divz.json -w "%{http_code}" "localhost:3206/divide?$Q"); [ "$CODE" = "400" ] || { echo "FAIL $Q code=$CODE"; exit 1; }; jq -e ".error | type == \"string\" and length > 0" /tmp/divz.json || exit 1; jq -e "has(\"result\") | not" /tmp/divz.json || exit 1; jq -e "has(\"operation\") | not" /tmp/divz.json || exit 1; jq -e "keys | sort == [\"error\"]" /tmp/divz.json || exit 1; for K in message msg reason detail details description info code status kind; do jq -e --arg k "$K" "has(\$k) | not" /tmp/divz.json || { echo "FAIL $Q 禁用错误字段 $K 漏网"; exit 1; }; done; done'
  期望: exit 0

- [ ] [BEHAVIOR] error path — strict-schema 拒（科学计数法 `1e3` / `Infinity` / `NaN` / 前导 `+6` / `.5` / `6.` / `0xff` / 千分位 `1,000` / 空串 / 非数字 / 缺参）全返 HTTP 400 + `{error: <非空 string>}`，错误响应顶层 keys 字面集合 = `["error"]`，body 不含 `result` 不含 `operation`，**且不含 PRD 错误响应禁用替代名 `message`/`msg`/`reason`/`detail`/`details`/`description`/`info`/`code`/`status`/`kind`**，防 `Number()`/`parseFloat()` 假绿
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3207 NODE_ENV=production node server.js > /tmp/srv.log 2>&1 & SPID=$!; trap "kill $SPID 2>/dev/null" EXIT; sleep 2; for Q in "a=1e3&b=2" "a=Infinity&b=2" "a=6&b=NaN" "a=%2B6&b=2" "a=.5&b=2" "a=6.&b=2" "a=0xff&b=2" "a=1%2C000&b=2" "a=&b=3" "a=abc&b=3" "a=6" "b=2" ""; do CODE=$(curl -s -o /tmp/divs.json -w "%{http_code}" "localhost:3207/divide?$Q"); [ "$CODE" = "400" ] || { echo "FAIL $Q code=$CODE"; exit 1; }; jq -e ".error | type == \"string\" and length > 0" /tmp/divs.json || exit 1; jq -e "has(\"result\") | not" /tmp/divs.json || exit 1; jq -e "has(\"operation\") | not" /tmp/divs.json || exit 1; jq -e "keys | sort == [\"error\"]" /tmp/divs.json || exit 1; for K in message msg reason detail details description info code status kind; do jq -e --arg k "$K" "has(\$k) | not" /tmp/divs.json || { echo "FAIL $Q 禁用错误字段 $K 漏网"; exit 1; }; done; done'
  期望: exit 0

- [ ] [BEHAVIOR] 回归不破坏 — 7 条其他端点（/health, /sum, /multiply, /power, /modulo, /factorial, /increment）的 happy 响应字段名 / 值 / keys 集合一字不变
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3208 NODE_ENV=production node server.js > /tmp/srv.log 2>&1 & SPID=$!; trap "kill $SPID 2>/dev/null" EXIT; sleep 2; curl -fs "localhost:3208/health" | jq -e ".ok == true and (keys | sort == [\"ok\"])" || exit 1; curl -fs "localhost:3208/sum?a=2&b=3" | jq -e ".sum == 5 and (keys | sort == [\"sum\"])" || exit 1; curl -fs "localhost:3208/multiply?a=2&b=3" | jq -e ".product == 6 and (keys | sort == [\"product\"])" || exit 1; curl -fs "localhost:3208/power?a=2&b=3" | jq -e ".power == 8 and (keys | sort == [\"power\"])" || exit 1; curl -fs "localhost:3208/modulo?a=7&b=3" | jq -e ".remainder == 1 and (keys | sort == [\"remainder\"])" || exit 1; curl -fs "localhost:3208/factorial?n=5" | jq -e ".factorial == 120 and (keys | sort == [\"factorial\"])" || exit 1; curl -fs "localhost:3208/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\" and (keys | sort == [\"operation\",\"result\"])"'
  期望: exit 0

- [ ] [BEHAVIOR] vitest 单测全绿（`cd playground && npm test` exit 0）— 含本 PR 改造的 `GET /divide` describe 块 + W19~W26 + bootstrap 全部既有断言
  Test: manual:bash -c 'cd playground && npm test --silent'
  期望: exit 0

