# Sprint Contract Draft (Round 1) — W35 playground GET /subtract（P1 final happy path 验，no restart）

> **P1 final 收官承诺**：本合同字段名 / query 名 / operation 字面量严格字面照搬 PRD `## Response Schema` 段：
> - response success keys = `result` + `operation`（字面，**不许漂到 `difference`/`diff`/`subtraction`/`minus`/`delta`/`sub_result`/`minus_result` 等任一禁用名**）
> - operation 字面值 = `"subtract"`（**禁用变体 `sub`/`subtraction`/`minus`/`diff`/`difference`/`subtr`/`op`/`method`/`action` 等**）
> - query param 字面名 = `minuend` + `subtrahend`（禁用 `a`/`b`/`x`/`y`/`p`/`q`/`m`/`n`/`lhs`/`rhs`/`left`/`right`/`op1`/`op2`/`arg1`/`arg2`/`input1`/`input2`/`v1`/`v2`/`first`/`second`/`from`/`to`/`start`/`end`/`value1`/`value2`/`num1`/`num2` 等）
> - response error key = `error`（禁用 `message`/`msg`/`reason`/`detail`/`details`/`description`/`info`/`code`/`errors`）
> - schema 完整性：成功响应 keys 字面集合 = `["operation","result"]`；错误响应 keys 字面集合 = `["error"]`
>
> Proposer 自查 checklist（v7.5 死规则 + v7.6 BEHAVIOR ≥ 4 阈值）：
> 1. PRD `## Response Schema` 段 success keys = {`result`,`operation`} ✓ contract jq -e 用 keys = {`result`,`operation`} ✓
> 2. PRD operation 字面 = `"subtract"` ✓ contract jq -e 写 `.operation == "subtract"` ✓
> 3. PRD 禁用清单（首要 `difference`/`diff`/`subtraction`/`subtraction_result`/`sub_result`/`minus_result`/`minus`/`delta` + generic `value`/`input`/`output`/`data`/`payload`/`response`/`answer`/`out`/`meta` + 其他 endpoint `sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`negation`）→ contract 仅在反向 `has("X") | not` 出现，**不出现在正向断言**
> 4. PRD success schema 完整性 keys 集合 = `["operation","result"]` ✓ contract jq -e `keys | sort == ["operation","result"]`
> 5. `grep -c '^- \[ \] \[BEHAVIOR\]' contract-dod-ws1.md` ≥ 4 ✓（实际 22+ 条，覆盖 schema 字段 / keys 完整性 / 禁用字段反向 / error path / 边界 happy / strict 拒）

---

## Golden Path

[HTTP 客户端发 `GET /subtract?minuend=<十进制浮点字符串>&subtrahend=<十进制浮点字符串>`]
→ [playground server 收到请求，对 minuend / subtrahend 做 strict-schema `^-?\d+(\.\d+)?$` 校验]
→ [strict-schema 通过后计算 `result = Number(minuend) - Number(subtrahend)`]
→ [对 result 做 `Number.isFinite(result)` 兜底；非有限数则返 400]
→ [返回 HTTP 200 `{result: <Number(minuend) - Number(subtrahend)>, operation: "subtract"}`，顶层 keys 字面 = `["operation","result"]`]

---

### Step 1: 客户端发 `GET /subtract?minuend=10&subtrahend=3` 合法请求

**可观测行为**: server 返 HTTP 200，body `{result: 7, operation: "subtract"}`，顶层 keys 字面集合 = `["operation","result"]`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3601 NODE_ENV=production node server.js > /tmp/w35-step1.log 2>&1 &
SPID=$!
sleep 2

# 1. 值复算严格相等
RESP=$(curl -fs "http://localhost:3601/subtract?minuend=10&subtrahend=3")
echo "$RESP" | jq -e '.result == 7' || { kill $SPID; echo "FAIL: result != 7"; exit 1; }

# 2. operation 字面字符串相等
echo "$RESP" | jq -e '.operation == "subtract"' || { kill $SPID; echo "FAIL: operation != \"subtract\""; exit 1; }

# 3. result 类型为 number
echo "$RESP" | jq -e '.result | type == "number"' || { kill $SPID; echo "FAIL: result not number"; exit 1; }

# 4. schema 完整性 — 顶层 keys 字面集合相等
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; echo "FAIL: keys != [operation,result]"; exit 1; }

# 5. 禁用响应字段名反向不存在
for k in difference diff subtraction subtraction_result sub_result minus_result minus delta value input output data payload response answer out meta sum product quotient power remainder factorial negation; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { kill $SPID; echo "FAIL: 禁用字段 $k 出现在 response"; exit 1; }
done

kill $SPID
echo "✅ Step 1 通过"
```

**硬阈值**: HTTP 200，`result === 7`，`operation === "subtract"`，顶层 keys = `["operation","result"]`，所有禁用字段反向不存在

---

### Step 2: 客户端发 `GET /subtract?minuend=0&subtrahend=0`（零边界 happy）

**可观测行为**: server 返 HTTP 200，body `{result: 0, operation: "subtract"}`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3602 NODE_ENV=production node server.js > /tmp/w35-step2.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3602/subtract?minuend=0&subtrahend=0")
echo "$RESP" | jq -e '.result == 0' || { kill $SPID; echo "FAIL: 0-0 → result != 0"; exit 1; }
echo "$RESP" | jq -e '.operation == "subtract"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 2 通过"
```

**硬阈值**: `result === 0`，验证零边界

---

### Step 3: 客户端发 `GET /subtract?minuend=5&subtrahend=5`（minuend===subtrahend 反 off-by-one）

**可观测行为**: server 返 HTTP 200，body `{result: 0, operation: "subtract"}`（任意非零等值减必为 0）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3603 NODE_ENV=production node server.js > /tmp/w35-step3.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3603/subtract?minuend=5&subtrahend=5")
echo "$RESP" | jq -e '.result == 0' || { kill $SPID; echo "FAIL: 5-5 → result != 0（off-by-one 信号）"; exit 1; }
echo "$RESP" | jq -e '.operation == "subtract"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; exit 1; }

# 第二个等值减验证（防 generator 偶发 hardcode 0-0=0）
RESP2=$(curl -fs "http://localhost:3603/subtract?minuend=100&subtrahend=100")
echo "$RESP2" | jq -e '.result == 0' || { kill $SPID; echo "FAIL: 100-100 → result != 0"; exit 1; }

kill $SPID
echo "✅ Step 3 通过（反 off-by-one）"
```

**硬阈值**: `result === 0`（不是 1 / -1 / 等参数本身）

---

### Step 4: 负结果 `GET /subtract?minuend=5&subtrahend=10`（minuend < subtrahend）

**可观测行为**: server 返 HTTP 200，body `{result: -5, operation: "subtract"}`（减法允许负结果，区分 `/factorial` 仅非负输入）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3604 NODE_ENV=production node server.js > /tmp/w35-step4.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3604/subtract?minuend=5&subtrahend=10")
echo "$RESP" | jq -e '.result == -5' || { kill $SPID; echo "FAIL: 5-10 → result != -5"; exit 1; }
echo "$RESP" | jq -e '.operation == "subtract"' || { kill $SPID; exit 1; }

# minuend=0 subtrahend=1（最小负结果边界）
RESP2=$(curl -fs "http://localhost:3604/subtract?minuend=0&subtrahend=1")
echo "$RESP2" | jq -e '.result == -1' || { kill $SPID; echo "FAIL: 0-1 → result != -1"; exit 1; }

kill $SPID
echo "✅ Step 4 通过（负结果）"
```

**硬阈值**: `result === -5` 且 `result === -1`（两条独立断言）

---

### Step 5: 双负 `GET /subtract?minuend=-5&subtrahend=-3`（双负输入 happy）

**可观测行为**: server 返 HTTP 200，body `{result: -2, operation: "subtract"}`（`-5 - (-3) = -2`）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3605 NODE_ENV=production node server.js > /tmp/w35-step5.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3605/subtract?minuend=-5&subtrahend=-3")
echo "$RESP" | jq -e '.result == -2' || { kill $SPID; echo "FAIL: -5-(-3) → result != -2"; exit 1; }
echo "$RESP" | jq -e '.operation == "subtract"' || { kill $SPID; exit 1; }

# 负 minuend + 正 subtrahend
RESP2=$(curl -fs "http://localhost:3605/subtract?minuend=-5&subtrahend=3")
echo "$RESP2" | jq -e '.result == -8' || { kill $SPID; echo "FAIL: -5-3 → result != -8"; exit 1; }

kill $SPID
echo "✅ Step 5 通过（双负 / 混合符号）"
```

**硬阈值**: `result === -2` 且 `result === -8`

---

### Step 6: 浮点 `GET /subtract?minuend=1.5&subtrahend=0.5`（浮点合法）

**可观测行为**: server 返 HTTP 200，body `{result: 1, operation: "subtract"}`（`1.5 - 0.5 === 1` 在 IEEE 754 下精确）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3606 NODE_ENV=production node server.js > /tmp/w35-step6.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3606/subtract?minuend=1.5&subtrahend=0.5")
echo "$RESP" | jq -e '.result == 1' || { kill $SPID; echo "FAIL: 1.5-0.5 → result != 1"; exit 1; }
echo "$RESP" | jq -e '.operation == "subtract"' || { kill $SPID; exit 1; }

# 第二个浮点（独立复算 oracle，不硬编码十进制理想值）
RESP2=$(curl -fs "http://localhost:3606/subtract?minuend=3.14&subtrahend=1.14")
EXPECTED=$(node -e "console.log(Number('3.14') - Number('1.14'))")
echo "$RESP2" | jq -e ".result == $EXPECTED" || { kill $SPID; echo "FAIL: 3.14-1.14 → result != $EXPECTED"; exit 1; }

kill $SPID
echo "✅ Step 6 通过（浮点）"
```

**硬阈值**: `result === 1`（`1.5-0.5` IEEE 754 精确），`result === Number('3.14') - Number('1.14')`（独立复算 oracle）

---

### Step 7: strict-schema 拒（10 类非法输入）

**可观测行为**: 各类非法字符串均返 HTTP 400，错误体顶层 keys = `["error"]`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3607 NODE_ENV=production node server.js > /tmp/w35-step7.log 2>&1 &
SPID=$!
sleep 2

# 1. 科学计数法
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=1e2&subtrahend=1")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 1e2 非 400 (got $CODE)"; exit 1; }

# 2. 前导 +（需 URL 编码）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=%2B5&subtrahend=3")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: +5 非 400 (got $CODE)"; exit 1; }

# 3. 双重负号
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=--5&subtrahend=3")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: --5 非 400 (got $CODE)"; exit 1; }

# 4. 十六进制
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=0xff&subtrahend=1")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 0xff 非 400 (got $CODE)"; exit 1; }

# 5. 千分位
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=1%2C000&subtrahend=1")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 1,000 非 400 (got $CODE)"; exit 1; }

# 6. 含空格
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=1%200&subtrahend=1")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: '1 0' 非 400 (got $CODE)"; exit 1; }

# 7. 空串
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=&subtrahend=3")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 空串 非 400 (got $CODE)"; exit 1; }

# 8. 字母
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=abc&subtrahend=3")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: abc 非 400 (got $CODE)"; exit 1; }

# 9. Infinity 字面
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=Infinity&subtrahend=1")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: Infinity 非 400 (got $CODE)"; exit 1; }

# 10. NaN 字面
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=NaN&subtrahend=1")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: NaN 非 400 (got $CODE)"; exit 1; }

# 11. subtrahend 端同样校验（1.5 浮点合法，1e2 / abc 非法）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=10&subtrahend=abc")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: subtrahend=abc 非 400"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3607/subtract?minuend=10&subtrahend=1e2")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: subtrahend=1e2 非 400"; exit 1; }

# 12. 错误体 schema 完整性（取一个错误样本验）
CODE=$(curl -s -o /tmp/w35-step7-err.json -w "%{http_code}" "http://localhost:3607/subtract?minuend=abc&subtrahend=3")
[ "$CODE" = "400" ] || { kill $SPID; exit 1; }
cat /tmp/w35-step7-err.json | jq -e '.error | type == "string" and length > 0' || { kill $SPID; echo "FAIL: error 非非空 string"; exit 1; }
cat /tmp/w35-step7-err.json | jq -e 'keys | sort == ["error"]' || { kill $SPID; echo "FAIL: 错误体含多余字段"; exit 1; }
cat /tmp/w35-step7-err.json | jq -e 'has("result") | not' || { kill $SPID; echo "FAIL: 错误体含 result"; exit 1; }
cat /tmp/w35-step7-err.json | jq -e 'has("operation") | not' || { kill $SPID; echo "FAIL: 错误体含 operation"; exit 1; }

kill $SPID
echo "✅ Step 7 通过（strict 拒 12 类 + 错误体 schema 完整）"
```

**硬阈值**: 12 类非法输入全 400 + 错误体 keys = `["error"]` + 不含 result/operation

---

### Step 8: 缺参拒（minuend / subtrahend / 两者皆缺）

**可观测行为**: 任一缺失参数均返 HTTP 400

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3608 NODE_ENV=production node server.js > /tmp/w35-step8.log 2>&1 &
SPID=$!
sleep 2

# 缺 subtrahend
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3608/subtract?minuend=10")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 缺 subtrahend 非 400 (got $CODE)"; exit 1; }

# 缺 minuend
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3608/subtract?subtrahend=3")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 缺 minuend 非 400 (got $CODE)"; exit 1; }

# 两者皆缺
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3608/subtract")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 双缺 非 400 (got $CODE)"; exit 1; }

kill $SPID
echo "✅ Step 8 通过（缺参）"
```

**硬阈值**: 三类缺参一律 400

---

### Step 9: 错 query 名拒（W22 强约束 — 字面只接受 `minuend` / `subtrahend`）

**可观测行为**: 用错 query 名（`a` / `b` / `x` / `y` / `lhs` / `rhs` 等）一律返 HTTP 400

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3609 NODE_ENV=production node server.js > /tmp/w35-step9.log 2>&1 &
SPID=$!
sleep 2

# 错 query 名清单（必须 ≥ 8 个，覆盖 PRD 禁用清单的典型代表）
for badpair in "a=10&b=3" "x=10&y=3" "p=10&q=3" "m=10&n=3" "lhs=10&rhs=3" "left=10&right=3" "op1=10&op2=3" "arg1=10&arg2=3" "input1=10&input2=3" "first=10&second=3" "from=10&to=3" "value1=10&value2=3"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/subtract?$badpair")
  [ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 错 query 名 [$badpair] 非 400 (got $CODE)"; exit 1; }
done

# 半正半错（一个对一个错）也得拒
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/subtract?minuend=10&b=3")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: minuend+b 混合 非 400"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/subtract?a=10&subtrahend=3")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: a+subtrahend 混合 非 400"; exit 1; }

kill $SPID
echo "✅ Step 9 通过（错 query 名 12+ 类全 400）"
```

**硬阈值**: 所有禁用 query 名一律 400（不允许 generator 偷懒复用 `a`/`b` 等）

---

### Step 10: 回归 — `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/increment`、`/factorial` 不被破坏

**可观测行为**: 八条已有路由各 1 条 happy 用例仍通过

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3610 NODE_ENV=production node server.js > /tmp/w35-step10.log 2>&1 &
SPID=$!
sleep 2

curl -fs "http://localhost:3610/health" | jq -e '.ok == true' || { kill $SPID; echo "FAIL: /health 回归"; exit 1; }
curl -fs "http://localhost:3610/sum?a=2&b=3" | jq -e '.sum == 5' || { kill $SPID; echo "FAIL: /sum 回归"; exit 1; }
curl -fs "http://localhost:3610/multiply?a=2&b=3" | jq -e '.product == 6' || { kill $SPID; echo "FAIL: /multiply 回归"; exit 1; }
curl -fs "http://localhost:3610/divide?a=6&b=3" | jq -e '.quotient == 2' || { kill $SPID; echo "FAIL: /divide 回归"; exit 1; }
curl -fs "http://localhost:3610/power?a=2&b=3" | jq -e '.power == 8' || { kill $SPID; echo "FAIL: /power 回归"; exit 1; }
curl -fs "http://localhost:3610/modulo?a=7&b=3" | jq -e '.remainder == 1' || { kill $SPID; echo "FAIL: /modulo 回归"; exit 1; }
curl -fs "http://localhost:3610/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { kill $SPID; echo "FAIL: /increment 回归"; exit 1; }
curl -fs "http://localhost:3610/factorial?n=5" | jq -e '.factorial == 120' || { kill $SPID; echo "FAIL: /factorial 回归"; exit 1; }

kill $SPID
echo "✅ Step 10 通过（8 路由回归）"
```

**硬阈值**: 八条已有路由全 happy

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd playground

# 0. 启 server（统一端口 3700 做 E2E）
PLAYGROUND_PORT=3700 NODE_ENV=production node server.js > /tmp/w35-e2e.log 2>&1 &
SPID=$!
trap "kill $SPID 2>/dev/null" EXIT
sleep 2

# 1. happy 多用例（含零边界、minuend===subtrahend、负结果、双负、浮点、独立复算）
for triple in "10:3:7" "0:0:0" "5:5:0" "100:100:0" "5:10:-5" "0:1:-1" "-5:-3:-2" "-5:3:-8" "1.5:0.5:1" "100:99:1"; do
  M="$(echo $triple | cut -d: -f1)"
  S="$(echo $triple | cut -d: -f2)"
  EXPECT="$(echo $triple | cut -d: -f3)"
  RESP=$(curl -fs "http://localhost:3700/subtract?minuend=$M&subtrahend=$S")
  echo "$RESP" | jq -e ".result == $EXPECT" || { echo "FAIL: $M-$S → result != $EXPECT"; exit 1; }
  echo "$RESP" | jq -e '.operation == "subtract"' || { echo "FAIL: $M-$S → operation != \"subtract\""; exit 1; }
  echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { echo "FAIL: $M-$S → schema drift"; exit 1; }
done

# 1b. 浮点独立复算（不硬编码十进制理想值）
RESP=$(curl -fs "http://localhost:3700/subtract?minuend=3.14&subtrahend=1.14")
EXPECTED_FP=$(node -e "console.log(Number('3.14') - Number('1.14'))")
echo "$RESP" | jq -e ".result == $EXPECTED_FP" || { echo "FAIL: 3.14-1.14 浮点独立复算 mismatch"; exit 1; }

# 2. 禁用字段反向断言（W35 P1 final 字段名死规则核心）
RESP=$(curl -fs "http://localhost:3700/subtract?minuend=10&subtrahend=3")
for badkey in difference diff subtraction subtraction_result sub_result minus_result minus delta value input output data payload response answer out meta sum product quotient power remainder factorial negation; do
  echo "$RESP" | jq -e "has(\"$badkey\") | not" > /dev/null || { echo "FAIL: 响应含禁用字段 $badkey"; exit 1; }
done

# 3. operation 字面值严格相等（不许变体 sub/subtraction/minus/diff 等）
echo "$RESP" | jq -e '.operation == "subtract"' || { echo "FAIL: operation 变体污染"; exit 1; }

# 4. strict-schema 拒（minuend 端）
for badv_url in "1e2" "%2B5" "--5" "0xff" "1%2C000" "1%200" "" "abc" "Infinity" "NaN"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/subtract?minuend=$badv_url&subtrahend=3")
  [ "$CODE" = "400" ] || { echo "FAIL: minuend='$badv_url' 非 400 (got $CODE)"; exit 1; }
done

# 5. strict-schema 拒（subtrahend 端，对称）
for badv_url in "1e2" "%2B5" "--5" "0xff" "abc" "Infinity" "NaN" ""; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/subtract?minuend=10&subtrahend=$badv_url")
  [ "$CODE" = "400" ] || { echo "FAIL: subtrahend='$badv_url' 非 400 (got $CODE)"; exit 1; }
done

# 6. 缺参拒
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/subtract?minuend=10")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 subtrahend 非 400"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/subtract?subtrahend=3")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 minuend 非 400"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/subtract")
[ "$CODE" = "400" ] || { echo "FAIL: 双缺 非 400"; exit 1; }

# 7. 错 query 名拒
for badpair in "a=10&b=3" "x=10&y=3" "p=10&q=3" "lhs=10&rhs=3" "left=10&right=3" "first=10&second=3"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/subtract?$badpair")
  [ "$CODE" = "400" ] || { echo "FAIL: 错 query 名 [$badpair] 非 400"; exit 1; }
done

# 8. 错误体 schema 完整性
CODE=$(curl -s -o /tmp/w35-e2e-err.json -w "%{http_code}" "http://localhost:3700/subtract?minuend=abc&subtrahend=3")
[ "$CODE" = "400" ] || { echo "FAIL: abc 非 400"; exit 1; }
cat /tmp/w35-e2e-err.json | jq -e 'keys | sort == ["error"]' || { echo "FAIL: 错误体 schema drift"; exit 1; }
cat /tmp/w35-e2e-err.json | jq -e '.error | type == "string" and length > 0' || { echo "FAIL: error 非非空 string"; exit 1; }
cat /tmp/w35-e2e-err.json | jq -e 'has("result") | not' || { echo "FAIL: 错误体含 result"; exit 1; }
cat /tmp/w35-e2e-err.json | jq -e 'has("operation") | not' || { echo "FAIL: 错误体含 operation"; exit 1; }

# 9. 已有 8 路由回归
curl -fs "http://localhost:3700/health" | jq -e '.ok == true' || { echo "FAIL: /health 回归"; exit 1; }
curl -fs "http://localhost:3700/sum?a=2&b=3" | jq -e '.sum == 5' || { echo "FAIL: /sum 回归"; exit 1; }
curl -fs "http://localhost:3700/multiply?a=2&b=3" | jq -e '.product == 6' || { echo "FAIL: /multiply 回归"; exit 1; }
curl -fs "http://localhost:3700/divide?a=6&b=3" | jq -e '.quotient == 2' || { echo "FAIL: /divide 回归"; exit 1; }
curl -fs "http://localhost:3700/power?a=2&b=3" | jq -e '.power == 8' || { echo "FAIL: /power 回归"; exit 1; }
curl -fs "http://localhost:3700/modulo?a=7&b=3" | jq -e '.remainder == 1' || { echo "FAIL: /modulo 回归"; exit 1; }
curl -fs "http://localhost:3700/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { echo "FAIL: /increment 回归"; exit 1; }
curl -fs "http://localhost:3700/factorial?n=5" | jq -e '.factorial == 120' || { echo "FAIL: /factorial 回归"; exit 1; }

# 10. vitest 全量回归
cd /workspace/playground
npx vitest run --reporter=verbose

echo "✅ Golden Path E2E 通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: playground GET /subtract 路由 + 单测 + README

**范围**: 仅动 `playground/server.js`（新增 `/subtract` 路由，≈ 10-12 行）、`playground/tests/server.test.js`（新增 `describe('GET /subtract', ...)` 块）、`playground/README.md`（端点列表加 `/subtract` 段）三个文件，绝不动其他文件。

**大小**: M（≈ 200-300 行测试 + 10-12 行实现 + 30 行 README）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/subtract.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/subtract.test.js` | minuend=10&subtrahend=3 → 200 + result=7 + operation="subtract", 零边界 0-0, minuend===subtrahend 反 off-by-one, 负结果 5-10, 双负 -5-(-3), 浮点 1.5-0.5, 顶层 keys 严格等于, 禁用字段反向, strict 拒 10+ 类, 缺参 3 类, 错 query 名 12+ 类, 错误体 keys=["error"] | 现 playground/server.js 无 `/subtract` 路由 → 所有相关 supertest 断言 fail（路由未注册 Express 默认 404） |

> 后缀说明：playground 子项目零依赖 + 纯 JS（无 tsconfig、无 TS 编译），故 vitest 测试用 `.test.js`。与 SKILL 模板 `.test.ts` 不一致是被动适配 playground 子项目栈，不是合同违规。

---

## Risks（P1 final 重点防范）

> Generator 实施时最易踩的坑 + 已布防对应 DoD oracle。Risks 不是"假设性问题"，是 W19~W26 实证过的真实漂移类型。

### Risk 1: 字段名漂移到 `difference`/`diff`（W25 字段名死规则最早实证场景）
- **失败模式**：proposer 字面照搬 PRD 但 generator 仍漂到 `{difference: 7}` / `{diff: 7}` / `{result: 7, operation: "diff"}`（语义化优化诱惑）
- **触发输入**：任一 happy GET
- **布防 DoD**：[BEHAVIOR] 1 条 keys 完整集合 `keys|sort==["operation","result"]` + 1 条 24 个禁用字段反向 `has("X") | not`（含首要 `difference`/`diff`/`subtraction`/`minus_result`/`minus`/`delta` 等）+ 1 条 `operation == "subtract"` 字面严等（拒 `"sub"`/`"subtraction"`/`"minus"`/`"diff"` 变体）

### Risk 2: query 名漂移（W22 强约束最早实证场景）
- **失败模式**：generator 偷懒复用 W19~W23 的 `req.query.a` / `req.query.b` → `minuend=10&subtrahend=3` 拿不到参数返 undefined → 接 `Number(undefined)=NaN` → strict 拒（错走错误分支但 CODE=400 假绿）；或更糟 — generator 把 query 名注册成 `a`/`b` → DoD `minuend=10&subtrahend=3` 全 404
- **触发输入**：`minuend=10&subtrahend=3`（必 happy 200）+ `a=10&b=3`（必 400）+ `x=10&y=3`（必 400）+ 半混 `minuend=10&b=3`（必 400）
- **布防 DoD**：[BEHAVIOR] 1 条 minuend=10&subtrahend=3 → result=7（正向）+ 12+ 条错 query 名一律 400（反向）+ 半混 2 条

### Risk 3: off-by-one（不会显式触发但仍布防）
- **失败模式**：generator 误写 `Number(minuend) - Number(subtrahend) - 1` / `Number(subtrahend) - Number(minuend)`（参数颠倒）/ `Number(minuend) + Number(subtrahend)`（错算加法）
- **触发输入**：`5-10=-5`（颠倒会返 +5 → 一眼看出）、`10-3=7`（错算加法会返 13）、`5-5=0`（off-by-one 会返 ±1）
- **布防 DoD**：minuend===subtrahend → 0（独立两条 `5=5` + `100=100`）+ `5-10=-5`（颠倒参数会返 +5 即被抓）+ `10-3=7`（错算加法会返 13）

### Risk 4: strict-schema 复用 W24 整数 regex（漏拒浮点 / 错拒负数）
- **失败模式**：generator 复用 `/factorial` 的 `^\d+$`（仅非负整数）→ `subtrahend=1.5` 错拒（应通过）/ `minuend=-5` 错拒（应通过）；或复用 W26 `^-?\d+$`（仅整数）→ `subtrahend=0.5` 错拒
- **触发输入**：`minuend=1.5&subtrahend=0.5`（浮点必通过）、`minuend=-5&subtrahend=-3`（负数必通过）
- **布防 DoD**：[BEHAVIOR] 浮点 happy 至少 2 条 + 负数 happy 至少 3 条 + 浮点拒（科学计数法 / 前导 + / 双重负号 / 十六进制 / 千分位 / 空格 / 字母 / Infinity / NaN / 空串）至少 10 条

### Risk 5: 缺参分支返 200 而非 400
- **失败模式**：generator 用 `Number(req.query.minuend)` 不判 undefined → `Number(undefined) = NaN` → 后续 `NaN - 3 = NaN` → JSON 序列化为 `null` → 返 `{result: null, operation: "subtract"}` 200
- **触发输入**：缺 minuend / 缺 subtrahend / 双缺
- **布防 DoD**：[BEHAVIOR] 三类缺参一律 400

### Risk 6: 错误响应混合污染
- **失败模式**：generator 错误分支返 `{error:"bad", result:null, operation:"subtract"}` → 错误体含禁用字段
- **触发输入**：任一非法输入（strict 拒 / 缺参 / 错 query 名）
- **布防 DoD**：[BEHAVIOR] 错误响应 `keys|sort==["error"]` + `has("result")|not` + `has("operation")|not` + `.error|type=="string" and length>0` 四联断言

### Risk 7: `Number.isFinite` 兜底漏写
- **失败模式**：generator 觉得"减法 strict-schema 已限定输入，不会上溢"于是省略 `Number.isFinite` 兜底。理论上 strict regex `^-?\d+(\.\d+)?$` 已限制不能用 `Number.MAX_VALUE` 字面（含 `e`），故构造不出合法触发；但 PRD 要求实现里这行必须存在（与 W22 `/power` 同款 defensive 设计）
- **触发输入**：无（构造不出，PRD 显式说明 proposer 可选不专门测此分支）
- **布防 DoD**：[ARTIFACT] grep server.js 中 `/subtract` 路由块含 `Number.isFinite` 字面（仅静态 artifact 校验，无 manual:bash 行为校验）

### Risk 8: 多余字段污染（成功响应加 echo 字段）
- **失败模式**：generator 觉得"返回值带上输入更友好"于是返 `{result:7, operation:"subtract", minuend:"10", subtrahend:"3"}`
- **触发输入**：任一 happy GET
- **布防 DoD**：[BEHAVIOR] `keys|sort==["operation","result"]` 字面完整集合断言（不允许多余 key）+ 24 个禁用字段反向（含 `value`/`input`/`output`/`data`/`payload` 等 generic 占位名）

### Risk 9: operation 字面值变体污染
- **失败模式**：generator 写 `operation: "sub"` / `"subtraction"` / `"minus"` / `"diff"` / `"difference"`
- **触发输入**：任一 happy GET
- **布防 DoD**：[BEHAVIOR] `operation == "subtract"` 严等（字符串字面相等，不是 contains/startsWith）+ E2E 24 个禁用字段反向涵盖 `subtraction` / `minus`

---
