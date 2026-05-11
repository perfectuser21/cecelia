---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: playground GET /decrement 路由 + 单测 + README

**范围**: 在 `playground/server.js` 新增 `GET /decrement` 路由（含 strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上下界拒 + `Number(value) - 1` 算术 + 返回 `{result, operation: "decrement"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /decrement', ...)` 块；在 `playground/README.md` 加 `/decrement` 端点说明

**大小**: M

**依赖**: 无

**PR-H 死规则承诺**:
- 本文件 [BEHAVIOR] 条目总数 **≥ 4** 且 **4 类各 ≥ 1 条**（schema 字段值 / schema 完整性 / 禁用字段反向 / error path）
- 每条 [BEHAVIOR] 内嵌 `Test: manual:bash` 命令，evaluator 直接跑（**不索引 vitest**，不写"已搬迁到 vitest"借口）
- 字段名严格字面照搬 PRD（`result` / `operation` / `"decrement"` / `value` / `error`），禁用同义名只在反向 `has("X") | not` 出现

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/server.js` 内含 `/decrement` 路由注册
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!/app\.get\(['\"]\/decrement['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/decrement` 段含 strict-schema 整数正则 `^-?\d+$`（不含小数支持）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m||!/\^-\?\\d\+\$/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/decrement` 路由使用 query 名 `value`（不复用 `n`/`a`/`b`/`x`/`y` 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\b(req\.query\.value|\{\s*value\s*\})/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/decrement` 路由含绝对值上界判定 `9007199254740990`
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m||!/9007199254740990/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/decrement` 路由响应字面含 `operation: "decrement"` 字符串
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m||!/operation\s*:\s*['\"]decrement['\"]/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] `playground/server.js` 内 `/decrement` 路由响应字面含 `result` 字段（不漂到 `decremented`/`prev`/`predecessor`/`dec`/`pred`/`sub_one` 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m)process.exit(1);if(!/\bresult\s*:/.test(m[0]))process.exit(1);for(const k of ['decremented','prev','previous','predecessor','dec','decr','pred','sub_one','subtract_one','minus_one','n_minus_one','decrementation']){if(new RegExp('\\\\b'+k+'\\\\s*:').test(m[0])){console.error('forbidden key '+k);process.exit(1)}}"

- [ ] [ARTIFACT] `playground/server.js` 实现不含 `BigInt` 字面量（响应必为 JS Number 而非 BigInt 字符串）
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');const m=c.match(/app\.get\(['\"]\/decrement[\s\S]*?\}\);/);if(!m)process.exit(1);if(/BigInt|\\d+n\\b/.test(m[0])){console.error('BigInt forbidden');process.exit(1)}"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 新增 `describe('GET /decrement'` 块（独立 describe，与其他 endpoint 平级）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/server.test.js','utf8');if(!/describe\(['\"]GET \/decrement/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 端点列表含 `/decrement` 段
  Test: node -e "const c=require('fs').readFileSync('playground/README.md','utf8');if(!/\/decrement/.test(c))process.exit(1)"

## BEHAVIOR 条目（PR-H 死规则：≥ 4 条 + 4 类各 ≥ 1 条；每条内嵌 manual:bash，evaluator 直接跑）

### 类 1: schema 字段值 oracle（≥ 1 条，本块共 6 条覆盖 happy/off-by-one/精度上下界/负数）

- [ ] [BEHAVIOR] [类1-schema字段值] GET /decrement?value=5 → 200 + `{result:4, operation:"decrement"}`（值复算严格相等）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3801 NODE_ENV=production node server.js > /tmp/dod-b1.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3801/decrement?value=5"); R=$(echo "$RESP" | jq -e ".result == 4 and .operation == \"decrement\" and (.result | type == \"number\")" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类1-schema字段值] GET /decrement?value=0 → 200 + `{result:-1, operation:"decrement"}`（off-by-one 零侧防线）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3802 NODE_ENV=production node server.js > /tmp/dod-b2.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3802/decrement?value=0"); R=$(echo "$RESP" | jq -e ".result == -1 and .operation == \"decrement\"" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类1-schema字段值] GET /decrement?value=1 → 200 + `{result:0, operation:"decrement"}`（off-by-one 正一侧防线）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3803 NODE_ENV=production node server.js > /tmp/dod-b3.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3803/decrement?value=1"); R=$(echo "$RESP" | jq -e ".result == 0 and .operation == \"decrement\"" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类1-schema字段值] GET /decrement?value=-1 → 200 + `{result:-2, operation:"decrement"}`（off-by-one 负一侧防线）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3804 NODE_ENV=production node server.js > /tmp/dod-b4.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3804/decrement?value=-1"); R=$(echo "$RESP" | jq -e ".result == -2 and .operation == \"decrement\"" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类1-schema字段值] GET /decrement?value=-9007199254740990 → 200 + `{result:-9007199254740991, operation:"decrement"}`（精度下界 === -Number.MAX_SAFE_INTEGER）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3805 NODE_ENV=production node server.js > /tmp/dod-b5.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3805/decrement?value=-9007199254740990"); R=$(echo "$RESP" | jq -e ".result == -9007199254740991 and .operation == \"decrement\"" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类1-schema字段值] GET /decrement?value=9007199254740990 → 200 + `{result:9007199254740989, operation:"decrement"}`（精度上界 happy）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3806 NODE_ENV=production node server.js > /tmp/dod-b6.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3806/decrement?value=9007199254740990"); R=$(echo "$RESP" | jq -e ".result == 9007199254740989 and .operation == \"decrement\"" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

### 类 2: schema 完整性 oracle（≥ 1 条，本块共 3 条覆盖 keys 字面集合 / operation 字面严等 / result 类型）

- [ ] [BEHAVIOR] [类2-schema完整性] GET /decrement?value=5 顶层 keys 字面集合恰好 == `["operation","result"]`（不许多余字段，不许少字段）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3811 NODE_ENV=production node server.js > /tmp/dod-b7.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3811/decrement?value=5"); R=$(echo "$RESP" | jq -e "keys | sort == [\"operation\",\"result\"]" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类2-schema完整性] GET /decrement?value=5 `.operation` 字段字面字符串严格 === `"decrement"`（不许变体 dec/decr/decremented/prev/pred/sub_one 等）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3812 NODE_ENV=production node server.js > /tmp/dod-b8.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3812/decrement?value=5"); R=$(echo "$RESP" | jq -e ".operation == \"decrement\"" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类2-schema完整性] GET /decrement?value=5 `.result` 字段 type 严格 == `"number"`（不许 string / BigInt 序列化）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3813 NODE_ENV=production node server.js > /tmp/dod-b9.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3813/decrement?value=5"); R=$(echo "$RESP" | jq -e ".result | type == \"number\"" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

### 类 3: 禁用字段反向 oracle（≥ 1 条，本块共 3 条覆盖首要禁用 / generic 禁用 / 其他 endpoint 字段）

- [ ] [BEHAVIOR] [类3-禁用字段反向] GET /decrement?value=5 响应不含任一首要禁用字段（`decremented`/`prev`/`previous`/`predecessor`/`n_minus_one`/`minus_one`/`sub_one`/`subtract_one`/`pred`/`dec`/`decr`/`decrementation`/`subtraction`/`difference`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3821 NODE_ENV=production node server.js > /tmp/dod-b10.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3821/decrement?value=5"); OK=1; for k in decremented prev previous predecessor n_minus_one minus_one sub_one subtract_one pred dec decr decrementation subtraction difference; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || OK=0; done; kill $SPID 2>/dev/null; [ "$OK" = "1" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类3-禁用字段反向] GET /decrement?value=5 响应不含 generic 禁用字段（`value`/`input`/`output`/`data`/`payload`/`response`/`answer`/`out`/`meta`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3822 NODE_ENV=production node server.js > /tmp/dod-b11.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3822/decrement?value=5"); OK=1; for k in value input output data payload response answer out meta; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || OK=0; done; kill $SPID 2>/dev/null; [ "$OK" = "1" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类3-禁用字段反向] GET /decrement?value=5 响应不含其他 endpoint 字段名（`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`negation`/`incremented`）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3823 NODE_ENV=production node server.js > /tmp/dod-b12.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3823/decrement?value=5"); OK=1; for k in sum product quotient power remainder factorial negation incremented; do echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || OK=0; done; kill $SPID 2>/dev/null; [ "$OK" = "1" ]'
  期望: exit 0

### 类 4: error path oracle（≥ 1 条，本块共 6 条覆盖下界拒/上界拒/strict 拒/缺参/错 query 名/错误体 keys 完整性）

- [ ] [BEHAVIOR] [类4-error_path] GET /decrement?value=-9007199254740991 → 400 + `{error:<非空 string>}` + 错误体顶层 keys == `["error"]` + 不含 `result`/`operation`（下界 -1 拒）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3831 NODE_ENV=production node server.js > /tmp/dod-b13.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/dod-b13-body.json -w "%{http_code}" "http://localhost:3831/decrement?value=-9007199254740991"); R=1; [ "$CODE" = "400" ] || R=0; cat /tmp/dod-b13-body.json | jq -e ".error | type == \"string\" and length > 0" > /dev/null || R=0; cat /tmp/dod-b13-body.json | jq -e "has(\"result\") | not" > /dev/null || R=0; cat /tmp/dod-b13-body.json | jq -e "has(\"operation\") | not" > /dev/null || R=0; cat /tmp/dod-b13-body.json | jq -e "keys | sort == [\"error\"]" > /dev/null || R=0; kill $SPID 2>/dev/null; [ "$R" = "1" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类4-error_path] GET /decrement?value=9007199254740991 → 400（上界 +1 拒）+ 错误体不含 result/operation
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3832 NODE_ENV=production node server.js > /tmp/dod-b14.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /tmp/dod-b14-body.json -w "%{http_code}" "http://localhost:3832/decrement?value=9007199254740991"); R=1; [ "$CODE" = "400" ] || R=0; cat /tmp/dod-b14-body.json | jq -e "keys | sort == [\"error\"]" > /dev/null || R=0; cat /tmp/dod-b14-body.json | jq -e "has(\"result\") | not" > /dev/null || R=0; kill $SPID 2>/dev/null; [ "$R" = "1" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类4-error_path] GET /decrement?value=1.5 → 400（strict 拒小数；防 generator 复用 W19~W23 浮点 regex 假绿）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3833 NODE_ENV=production node server.js > /tmp/dod-b15.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3833/decrement?value=1.5"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类4-error_path] GET /decrement?value=abc / value=1e2 / value=0xff / value=NaN / value=Infinity / value=--5 / value=%2B5 / value= 全部 → 400（strict 拒 8 类非法输入）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3834 NODE_ENV=production node server.js > /tmp/dod-b16.log 2>&1 & SPID=$!; sleep 2; OK=1; for v in "abc" "1e2" "0xff" "NaN" "Infinity" "--5" "%2B5" ""; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3834/decrement?value=$v"); [ "$CODE" = "400" ] || OK=0; done; kill $SPID 2>/dev/null; [ "$OK" = "1" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类4-error_path] GET /decrement（缺 value 参数） → 400
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3835 NODE_ENV=production node server.js > /tmp/dod-b17.log 2>&1 & SPID=$!; sleep 2; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3835/decrement"); kill $SPID 2>/dev/null; [ "$CODE" = "400" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [类4-error_path] GET /decrement?n=5 / ?x=5 / ?a=5 / ?b=5 / ?val=5 / ?input=5 / ?v=5 全部 → 400（错 query 名一律违约）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3836 NODE_ENV=production node server.js > /tmp/dod-b18.log 2>&1 & SPID=$!; sleep 2; OK=1; for bn in n x a b val input v; do CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3836/decrement?$bn=5"); [ "$CODE" = "400" ] || OK=0; done; kill $SPID 2>/dev/null; [ "$OK" = "1" ]'
  期望: exit 0

### 附加 BEHAVIOR（防八进制误解析 + 负数 happy + 8 路由回归）

- [ ] [BEHAVIOR] GET /decrement?value=01 → 200 + `{result:0, operation:"decrement"}`（前导 0 happy，防 generator 用 parseInt 八进制错位）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3841 NODE_ENV=production node server.js > /tmp/dod-b19.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3841/decrement?value=01"); R=$(echo "$RESP" | jq -e ".result == 0 and .operation == \"decrement\"" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] GET /decrement?value=-5 → 200 + `{result:-6, operation:"decrement"}`（负数 happy，防 generator 复用 W24 `^\d+$` regex 拒错负数）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3842 NODE_ENV=production node server.js > /tmp/dod-b20.log 2>&1 & SPID=$!; sleep 2; RESP=$(curl -fs "http://localhost:3842/decrement?value=-5"); R=$(echo "$RESP" | jq -e ".result == -6 and .operation == \"decrement\"" > /dev/null && echo OK); kill $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 已有 8 路由 `/health` `/sum` `/multiply` `/divide` `/power` `/modulo` `/factorial` `/increment` happy 用例回归全通过（不被新 /decrement 路由破坏）
  Test: manual:bash -c 'cd playground && PLAYGROUND_PORT=3843 NODE_ENV=production node server.js > /tmp/dod-b21.log 2>&1 & SPID=$!; sleep 2; OK=1; curl -fs "http://localhost:3843/health" | jq -e ".ok == true" > /dev/null || OK=0; curl -fs "http://localhost:3843/sum?a=2&b=3" | jq -e ".sum == 5" > /dev/null || OK=0; curl -fs "http://localhost:3843/multiply?a=2&b=3" | jq -e ".product == 6" > /dev/null || OK=0; curl -fs "http://localhost:3843/divide?a=6&b=3" | jq -e ".quotient == 2" > /dev/null || OK=0; curl -fs "http://localhost:3843/power?a=2&b=3" | jq -e ".power == 8" > /dev/null || OK=0; curl -fs "http://localhost:3843/modulo?a=7&b=3" | jq -e ".remainder == 1" > /dev/null || OK=0; curl -fs "http://localhost:3843/factorial?n=5" | jq -e ".factorial == 120" > /dev/null || OK=0; curl -fs "http://localhost:3843/increment?value=5" | jq -e ".result == 6 and .operation == \"increment\"" > /dev/null || OK=0; kill $SPID 2>/dev/null; [ "$OK" = "1" ]'
  期望: exit 0
