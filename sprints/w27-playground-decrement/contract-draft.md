# Sprint Contract Draft (Round 1) — W27 playground GET /decrement (PR-H 验收)

> **PR-H 验收承诺**：本合同必须 **≥ 4 条 [BEHAVIOR]** 且 **4 类各 ≥ 1 条**：
> - 类 1（schema 字段值 oracle）：≥ 1 条断言 `result` 字段值与独立复算严格相等 + `operation == "decrement"` 字面 + `result` type == number
> - 类 2（schema 完整性 oracle）：≥ 1 条断言成功响应顶层 keys 字面集合 `keys|sort == ["operation","result"]`
> - 类 3（禁用字段反向 oracle）：≥ 1 条断言响应不含禁用同义名（`decremented`/`prev`/`previous`/`predecessor`/`dec`/`decr`/`sub_one`/`subtract_one`/`pred`/`n_minus_one`/`minus_one`/`decrementation`/`subtraction`/`difference` 等）
> - 类 4（error path oracle）：≥ 1 条断言错误响应 HTTP 400 + `{error:<非空 string>}` + body 不含 `result`/`operation`
>
> **PR-G 字段名死规则不退化**：字段名严格字面照搬 PRD `## Response Schema`：
> - response success keys = `result` + `operation`（字面，**不许漂到 `decremented`/`prev`/`predecessor`/`dec`/`pred`/`sub_one`/`minus_one` 等任一禁用名**）
> - operation 字面值 = `"decrement"`（**禁用变体 `dec`/`decr`/`decremented`/`prev`/`predecessor`/`pred`/`minus_one`/`sub_one`/`subtract_one`**）
> - query param 字面名 = `value`（禁用 `n`/`x`/`y`/`m`/`val`/`num`/`input`/`v` 等 28 个）
> - response error key = `error`（禁用 `message`/`msg`/`reason`/`detail`）
> - schema 完整性：成功响应 keys 字面集合 = `["operation","result"]`，错误响应 keys 字面集合 = `["error"]`
>
> Proposer 自查 checklist（v7.5 + v7.6 死规则）：
> 1. PRD `## Response Schema` 段 success keys = {`result`,`operation`} ✓ contract jq -e 用 keys = {`result`,`operation`} ✓
> 2. PRD operation 字面 = `"decrement"` ✓ contract jq -e 写 `.operation == "decrement"` ✓
> 3. PRD 禁用清单 → contract 仅在反向 `has("X") | not` 出现，**不出现在正向断言**
> 4. PRD success schema 完整性 keys 集合 = `["operation","result"]` ✓ contract jq -e `keys | sort == ["operation","result"]`
> 5. **PR-H 死规则**：`grep -c '^- \[ \] \[BEHAVIOR' contract-dod-ws1.md` ≥ 4，且 4 类各 ≥ 1 条；**禁止 "已搬迁到 vitest" / "DoD 纯度规则" / "v5.0 严禁" / "路由简单" 等任一借口**

---

## Golden Path

[HTTP 客户端发 `GET /decrement?value=<十进制整数字符串，含可选前导负号>`]
→ [playground server 收到请求，对 value 做 strict-schema `^-?\d+$` 校验]
→ [strict-schema 通过后判定 `Math.abs(Number(value)) > 9007199254740990`，超界则返 400]
→ [合法则计算 `result = Number(value) - 1`]
→ [返回 HTTP 200 `{result: <Number(value)-1>, operation: "decrement"}`，顶层 keys 字面 = `["operation","result"]`]

---

### Step 1: 客户端发 `GET /decrement?value=5` 合法请求

**可观测行为**: server 返 HTTP 200，body `{result: 4, operation: "decrement"}`，顶层 keys 字面集合 = `["operation","result"]`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3701 NODE_ENV=production node server.js > /tmp/ws1-step1.log 2>&1 &
SPID=$!
sleep 2

# 1. 值复算严格相等
RESP=$(curl -fs "http://localhost:3701/decrement?value=5")
echo "$RESP" | jq -e '.result == 4' || { kill $SPID; echo "FAIL: result != 4"; exit 1; }

# 2. operation 字面字符串相等
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; echo "FAIL: operation != \"decrement\""; exit 1; }

# 3. result 类型为 number
echo "$RESP" | jq -e '.result | type == "number"' || { kill $SPID; echo "FAIL: result not number"; exit 1; }

# 4. schema 完整性 — 顶层 keys 字面集合相等
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; echo "FAIL: keys != [operation,result]"; exit 1; }

# 5. 禁用响应字段名反向不存在
for k in decremented prev previous predecessor n_minus_one minus_one sub_one subtract_one pred dec decr decrementation subtraction difference value input output data payload response answer out meta sum product quotient power remainder factorial negation incremented; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { kill $SPID; echo "FAIL: 禁用字段 $k 出现在 response"; exit 1; }
done

kill $SPID
echo "✅ Step 1 通过"
```

**硬阈值**: HTTP 200，`result === 4`，`operation === "decrement"`，顶层 keys = `["operation","result"]`，所有禁用字段反向不存在

---

### Step 2: 客户端发 `GET /decrement?value=1`（off-by-one 边界 happy 正侧）

**可观测行为**: server 返 HTTP 200，body `{result: 0, operation: "decrement"}`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3702 NODE_ENV=production node server.js > /tmp/ws1-step2.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3702/decrement?value=1")
echo "$RESP" | jq -e '.result == 0' || { kill $SPID; echo "FAIL: 1 → result != 0"; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 2 通过"
```

**硬阈值**: `result === 0`，验证 off-by-one 防线（正一侧）

---

### Step 3: 客户端发 `GET /decrement?value=0`（off-by-one 边界 happy 零）

**可观测行为**: server 返 HTTP 200，body `{result: -1, operation: "decrement"}`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3703 NODE_ENV=production node server.js > /tmp/ws1-step3.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3703/decrement?value=0")
echo "$RESP" | jq -e '.result == -1' || { kill $SPID; echo "FAIL: 0 → result != -1"; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 3 通过"
```

**硬阈值**: `result === -1`（防 generator 把 `0` 当 falsy 误返 0）

---

### Step 4: 精度下界 `value=-9007199254740990` 合法

**可观测行为**: 返 HTTP 200，`result === -9007199254740991`（即 `-Number.MAX_SAFE_INTEGER`，精确无浮点损失）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3704 NODE_ENV=production node server.js > /tmp/ws1-step4.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3704/decrement?value=-9007199254740990")
echo "$RESP" | jq -e '.result == -9007199254740991' || { kill $SPID; echo "FAIL: 下界精度不准"; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 4 通过（精度下界，===-MAX_SAFE_INTEGER）"
```

**硬阈值**: `result === -9007199254740991`（即 `-Number.MAX_SAFE_INTEGER`）

---

### Step 5: 精度上界 `value=9007199254740990` 合法

**可观测行为**: 返 HTTP 200，`result === 9007199254740989`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3705 NODE_ENV=production node server.js > /tmp/ws1-step5.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3705/decrement?value=9007199254740990")
echo "$RESP" | jq -e '.result == 9007199254740989' || { kill $SPID; echo "FAIL: 上界精度不准"; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 5 通过（精度上界）"
```

**硬阈值**: `result === 9007199254740989`

---

### Step 6: 下界拒 `value=-9007199254740991`

**可观测行为**: 返 HTTP 400，`{error: "<非空 string>"}`，body 不含 `result` 也不含 `operation`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3706 NODE_ENV=production node server.js > /tmp/ws1-step6.log 2>&1 &
SPID=$!
sleep 2

CODE=$(curl -s -o /tmp/ws1-step6-body.json -w "%{http_code}" "http://localhost:3706/decrement?value=-9007199254740991")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 下界 -1 非 400 (got $CODE)"; exit 1; }
cat /tmp/ws1-step6-body.json | jq -e '.error | type == "string" and length > 0' || { kill $SPID; exit 1; }
cat /tmp/ws1-step6-body.json | jq -e 'has("result") | not' || { kill $SPID; echo "FAIL: 错误体含 result"; exit 1; }
cat /tmp/ws1-step6-body.json | jq -e 'has("operation") | not' || { kill $SPID; echo "FAIL: 错误体含 operation"; exit 1; }
cat /tmp/ws1-step6-body.json | jq -e 'keys | sort == ["error"]' || { kill $SPID; echo "FAIL: 错误体含多余字段"; exit 1; }

kill $SPID
echo "✅ Step 6 通过（下界拒）"
```

**硬阈值**: HTTP 400，error 非空 string，错误体顶层 keys = `["error"]`

---

### Step 7: 上界拒 `value=9007199254740991`

**可观测行为**: 返 HTTP 400，错误体顶层 keys = `["error"]`，body 不含 `result`/`operation`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3707 NODE_ENV=production node server.js > /tmp/ws1-step7.log 2>&1 &
SPID=$!
sleep 2

CODE=$(curl -s -o /tmp/ws1-step7-body.json -w "%{http_code}" "http://localhost:3707/decrement?value=9007199254740991")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 上界 +1 非 400 (got $CODE)"; exit 1; }
cat /tmp/ws1-step7-body.json | jq -e 'keys | sort == ["error"]' || { kill $SPID; exit 1; }
cat /tmp/ws1-step7-body.json | jq -e 'has("result") | not' || { kill $SPID; exit 1; }
cat /tmp/ws1-step7-body.json | jq -e 'has("operation") | not' || { kill $SPID; exit 1; }

# 远超上界
CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3707/decrement?value=99999999999999999999")
[ "$CODE2" = "400" ] || { kill $SPID; echo "FAIL: 远超上界非 400"; exit 1; }

kill $SPID
echo "✅ Step 7 通过（上界拒）"
```

**硬阈值**: HTTP 400，错误体不含 result/operation

---

### Step 8: strict-schema 拒（12 类非法输入）

**可观测行为**: 小数 / 前导 + / 双重负号 / 尾部负号 / 科学计数法 / 十六进制 / 千分位 / 空格 / 空串 / 字母 / Infinity / NaN / 仅负号 均返 HTTP 400

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3708 NODE_ENV=production node server.js > /tmp/ws1-step8.log 2>&1 &
SPID=$!
sleep 2

# 小数 1.5 拒
CODE=$(curl -s -o /tmp/ws1-step8-body.json -w "%{http_code}" "http://localhost:3708/decrement?value=1.5")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 1.5 非 400 (got $CODE)"; exit 1; }
cat /tmp/ws1-step8-body.json | jq -e 'has("result") | not' || { kill $SPID; exit 1; }

# 1.0 也拒（小数点本身就拒）
CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=1.0")
[ "$CODE2" = "400" ] || { kill $SPID; echo "FAIL: 1.0 非 400 (got $CODE2)"; exit 1; }

# 科学计数法 1e2 拒
CODE3=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=1e2")
[ "$CODE3" = "400" ] || { kill $SPID; echo "FAIL: 1e2 非 400"; exit 1; }

# 十六进制 0xff 拒
CODE4=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=0xff")
[ "$CODE4" = "400" ] || { kill $SPID; echo "FAIL: 0xff 非 400"; exit 1; }

# 千分位 1,000 拒
CODE5=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=1%2C000")
[ "$CODE5" = "400" ] || { kill $SPID; echo "FAIL: 1,000 非 400"; exit 1; }

# 前导 +5 拒
CODE6=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=%2B5")
[ "$CODE6" = "400" ] || { kill $SPID; echo "FAIL: +5 非 400"; exit 1; }

# 双重负号 --5 拒
CODE7=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=--5")
[ "$CODE7" = "400" ] || { kill $SPID; echo "FAIL: --5 非 400"; exit 1; }

# 尾部负号 5- 拒
CODE_TAIL=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=5-")
[ "$CODE_TAIL" = "400" ] || { kill $SPID; echo "FAIL: 5- 非 400"; exit 1; }

# Infinity 拒
CODE8=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=Infinity")
[ "$CODE8" = "400" ] || { kill $SPID; echo "FAIL: Infinity 非 400"; exit 1; }

# NaN 拒
CODE9=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=NaN")
[ "$CODE9" = "400" ] || { kill $SPID; echo "FAIL: NaN 非 400"; exit 1; }

# 字母拒
CODE10=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=abc")
[ "$CODE10" = "400" ] || { kill $SPID; echo "FAIL: abc 非 400"; exit 1; }

# 仅负号 - 拒
CODE11=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=-")
[ "$CODE11" = "400" ] || { kill $SPID; echo "FAIL: 仅 - 非 400"; exit 1; }

# 空串拒
CODE12=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3708/decrement?value=")
[ "$CODE12" = "400" ] || { kill $SPID; echo "FAIL: 空串非 400"; exit 1; }

kill $SPID
echo "✅ Step 8 通过（strict 拒 12+ 类）"
```

**硬阈值**: 全部非法输入返 400

---

### Step 9: 缺参 / 错 query 名拒

**可观测行为**: 缺 `value` 参数 → HTTP 400；用错 query 名（`n`/`x`/`a` 等）→ HTTP 400

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3709 NODE_ENV=production node server.js > /tmp/ws1-step9.log 2>&1 &
SPID=$!
sleep 2

# 缺 value
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3709/decrement")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 缺参非 400 (got $CODE)"; exit 1; }

# 错 query 名一律 400
for badname in n x y m k val num number int integer input arg count size v a b target; do
  CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3709/decrement?$badname=5")
  [ "$CODE2" = "400" ] || { kill $SPID; echo "FAIL: query 名 $badname 非 400 (got $CODE2)"; exit 1; }
done

kill $SPID
echo "✅ Step 9 通过（缺参/错 query 名拒）"
```

**硬阈值**: 缺参与所有禁用 query 名一律 400

---

### Step 10: 前导 0（`value=01`、`value=-01`）合法 happy（防八进制误解析）

**可观测行为**: `value=01` → `{result: 0, operation: "decrement"}`；`value=-01` → `{result: -2, operation: "decrement"}`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3710 NODE_ENV=production node server.js > /tmp/ws1-step10.log 2>&1 &
SPID=$!
sleep 2

RESP1=$(curl -fs "http://localhost:3710/decrement?value=01")
echo "$RESP1" | jq -e '.result == 0' || { kill $SPID; echo "FAIL: 01 → result != 0（可能 generator 错用八进制 parseInt）"; exit 1; }
echo "$RESP1" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }

RESP2=$(curl -fs "http://localhost:3710/decrement?value=-01")
echo "$RESP2" | jq -e '.result == -2' || { kill $SPID; echo "FAIL: -01 → result != -2"; exit 1; }

kill $SPID
echo "✅ Step 10 通过（前导 0 happy，不许 parseInt 八进制）"
```

**硬阈值**: `result === 0`（不是八进制 8 或拒绝）

---

### Step 11: 负数 happy（`value=-5`、`value=-100`）合法

**可观测行为**: 负数合法返 `result === Number(value) - 1`（区分 W24 `^\d+$` 拒负数）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3711 NODE_ENV=production node server.js > /tmp/ws1-step11.log 2>&1 &
SPID=$!
sleep 2

RESP_NEG5=$(curl -fs "http://localhost:3711/decrement?value=-5")
echo "$RESP_NEG5" | jq -e '.result == -6' || { kill $SPID; echo "FAIL: -5 → result != -6"; exit 1; }
echo "$RESP_NEG5" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }

RESP_NEG100=$(curl -fs "http://localhost:3711/decrement?value=-100")
echo "$RESP_NEG100" | jq -e '.result == -101' || { kill $SPID; echo "FAIL: -100 → result != -101"; exit 1; }

RESP_NEG1=$(curl -fs "http://localhost:3711/decrement?value=-1")
echo "$RESP_NEG1" | jq -e '.result == -2' || { kill $SPID; echo "FAIL: -1 → result != -2"; exit 1; }

kill $SPID
echo "✅ Step 11 通过（负数 happy）"
```

**硬阈值**: 所有负数 happy 返正确 `Number(value)-1`

---

### Step 12: 回归 — 已有 8 路由不被破坏

**可观测行为**: `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 各 1 条 happy 用例仍通过

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3712 NODE_ENV=production node server.js > /tmp/ws1-step12.log 2>&1 &
SPID=$!
sleep 2

curl -fs "http://localhost:3712/health" | jq -e '.ok == true' || { kill $SPID; echo "FAIL: /health 回归"; exit 1; }
curl -fs "http://localhost:3712/sum?a=2&b=3" | jq -e '.sum == 5' || { kill $SPID; echo "FAIL: /sum 回归"; exit 1; }
curl -fs "http://localhost:3712/multiply?a=2&b=3" | jq -e '.product == 6' || { kill $SPID; echo "FAIL: /multiply 回归"; exit 1; }
curl -fs "http://localhost:3712/divide?a=6&b=3" | jq -e '.quotient == 2' || { kill $SPID; echo "FAIL: /divide 回归"; exit 1; }
curl -fs "http://localhost:3712/power?a=2&b=3" | jq -e '.power == 8' || { kill $SPID; echo "FAIL: /power 回归"; exit 1; }
curl -fs "http://localhost:3712/modulo?a=7&b=3" | jq -e '.remainder == 1' || { kill $SPID; echo "FAIL: /modulo 回归"; exit 1; }
curl -fs "http://localhost:3712/factorial?n=5" | jq -e '.factorial == 120' || { kill $SPID; echo "FAIL: /factorial 回归"; exit 1; }
curl -fs "http://localhost:3712/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { kill $SPID; echo "FAIL: /increment 回归"; exit 1; }

kill $SPID
echo "✅ Step 12 通过（8 路由回归）"
```

**硬阈值**: 8 路由全 happy

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd playground

# 0. 启 server（统一端口 3700 做 E2E）
PLAYGROUND_PORT=3700 NODE_ENV=production node server.js > /tmp/w27-e2e.log 2>&1 &
SPID=$!
trap "kill $SPID 2>/dev/null" EXIT
sleep 2

# 1. happy 多用例（含 off-by-one 0/1/-1、精度上下界、负数）
for pair in "5:4" "0:-1" "1:0" "-1:-2" "-5:-6" "100:99" "-100:-101" "9007199254740990:9007199254740989" "-9007199254740990:-9007199254740991"; do
  V="${pair%:*}"; EXPECT="${pair#*:}"
  RESP=$(curl -fs "http://localhost:3700/decrement?value=$V")
  echo "$RESP" | jq -e ".result == $EXPECT" || { echo "FAIL: value=$V → result != $EXPECT"; exit 1; }
  echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: value=$V → operation != \"decrement\""; exit 1; }
  echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { echo "FAIL: value=$V → schema drift"; exit 1; }
done

# 2. 禁用字段反向断言（PR-G 字段名死规则不退化 + PR-H 禁用清单覆盖）
RESP=$(curl -fs "http://localhost:3700/decrement?value=5")
for badkey in decremented prev previous predecessor n_minus_one minus_one sub_one subtract_one pred dec decr decrementation subtraction difference value input output data payload response answer out meta sum product quotient power remainder factorial negation incremented; do
  echo "$RESP" | jq -e "has(\"$badkey\") | not" > /dev/null || { echo "FAIL: 响应含禁用字段 $badkey"; exit 1; }
done

# 3. operation 字面值严格相等（不许变体 dec/decr/prev 等）
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: operation 变体污染"; exit 1; }

# 4. 上界拒 / 下界拒 / 远超上界
for badv in "9007199254740991" "-9007199254740991" "99999999999999999999"; do
  CODE=$(curl -s -o /tmp/w27-err.json -w "%{http_code}" "http://localhost:3700/decrement?value=$badv")
  [ "$CODE" = "400" ] || { echo "FAIL: $badv 非 400 (got $CODE)"; exit 1; }
  cat /tmp/w27-err.json | jq -e 'keys | sort == ["error"]' || { echo "FAIL: $badv 错误体 schema drift"; exit 1; }
  cat /tmp/w27-err.json | jq -e 'has("result") | not' || { echo "FAIL: $badv 错误体含 result"; exit 1; }
  cat /tmp/w27-err.json | jq -e 'has("operation") | not' || { echo "FAIL: $badv 错误体含 operation"; exit 1; }
done

# 5. strict-schema 拒 13 类
for badv_url in "1.5" "1.0" "1e2" "0xff" "abc" "Infinity" "NaN" "-" "" "1%2C000" "%2B5" "--5" "5-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/decrement?value=$badv_url")
  [ "$CODE" = "400" ] || { echo "FAIL: '$badv_url' 非 400 (got $CODE)"; exit 1; }
done

# 6. 缺参 + 错 query 名
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/decrement")
[ "$CODE" = "400" ] || { echo "FAIL: 缺参非 400"; exit 1; }
for bn in n x y m val input v a b target; do
  CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/decrement?$bn=5")
  [ "$CODE2" = "400" ] || { echo "FAIL: query=$bn 非 400"; exit 1; }
done

# 7. 前导 0 happy（防 parseInt 八进制）
RESP01=$(curl -fs "http://localhost:3700/decrement?value=01")
echo "$RESP01" | jq -e '.result == 0' || { echo "FAIL: 01 → result != 0"; exit 1; }
RESP_NEG01=$(curl -fs "http://localhost:3700/decrement?value=-01")
echo "$RESP_NEG01" | jq -e '.result == -2' || { echo "FAIL: -01 → result != -2"; exit 1; }

# 8. 已有 8 路由回归
curl -fs "http://localhost:3700/health" | jq -e '.ok == true' || { echo "FAIL: /health 回归"; exit 1; }
curl -fs "http://localhost:3700/sum?a=2&b=3" | jq -e '.sum == 5' || { echo "FAIL: /sum 回归"; exit 1; }
curl -fs "http://localhost:3700/multiply?a=2&b=3" | jq -e '.product == 6' || { echo "FAIL: /multiply 回归"; exit 1; }
curl -fs "http://localhost:3700/divide?a=6&b=3" | jq -e '.quotient == 2' || { echo "FAIL: /divide 回归"; exit 1; }
curl -fs "http://localhost:3700/power?a=2&b=3" | jq -e '.power == 8' || { echo "FAIL: /power 回归"; exit 1; }
curl -fs "http://localhost:3700/modulo?a=7&b=3" | jq -e '.remainder == 1' || { echo "FAIL: /modulo 回归"; exit 1; }
curl -fs "http://localhost:3700/factorial?n=5" | jq -e '.factorial == 120' || { echo "FAIL: /factorial 回归"; exit 1; }
curl -fs "http://localhost:3700/increment?value=5" | jq -e '.result == 6' || { echo "FAIL: /increment 回归"; exit 1; }

# 9. vitest 全量回归
cd /workspace/playground
npx vitest run --reporter=verbose

echo "✅ Golden Path E2E 通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: playground GET /decrement 路由 + 单测 + README

**范围**: 仅动 `playground/server.js`（新增 `/decrement` 路由，≈ 12-15 行）、`playground/tests/server.test.js`（新增 `describe('GET /decrement', ...)` 块）、`playground/README.md`（端点列表加 `/decrement` 段）三个文件，绝不动其他文件。

**大小**: M（≈ 200-300 行测试 + 12-15 行实现 + 30 行 README）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/decrement.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/decrement.test.js` | value=5 → 200, value=0 → -1, value=1 → 0, value=-1 → -2, 拒小数, 下界 -1 拒, 上界 +1 拒, 顶层 keys 严格等于, 成功响应不含禁用字段, operation 字面值严格, 上界拒错误体不含 result, 错 query 名, value=01 → 0 防八进制, 负数 happy, {ok:true} 回归 | 现 playground/server.js 无 `/decrement` 路由 → 所有相关 supertest 断言 fail（路由未注册 Express 默认 404）

> 后缀说明：playground 子项目零依赖 + 纯 JS（无 tsconfig、无 TS 编译），故 vitest 测试用 `.test.js`。与 SKILL 模板 `.test.ts` 不一致是被动适配 playground 子项目栈，不是合同违规（与 W19~W26 同处理）。

---

## Risks（Round 1 — Generator 实施时最易踩的坑）

> 不是"假设性问题"，是 W19~W26 实证过的真实漂移类型。

### Risk 1: off-by-one（最高严重度）
- **失败模式**：generator 误写 `return Number(value)` / `return Number(value) - 2` / `return Number(value) + 1`（复制 W26 模板未改运算符）
- **触发输入**：`value=0`（最敏感 — 期望 -1，复制 W26 错位为 1）、`value=1`（期望 0）、`value=-1`（期望 -2）
- **布防 DoD**：[BEHAVIOR-类1] 各独立条 `value=0→result=-1` / `value=1→result=0` / `value=-1→result=-2` / `value=5→result=4`，不共用断言

### Risk 2: 字段名漂移（PR-G 死规则不退化）
- **失败模式**：proposer 此版已字面照搬 PRD（contract `result`/`operation`/`"decrement"`/`value`），但 generator 可能漂到 `{decremented:4}` / `{prev:4}` / `{result:4, operation:"dec"}` / `req.query.n` 等任一禁用形态
- **触发输入**：任一 happy GET
- **布防 DoD**：3 条独立 [BEHAVIOR-类3] 反向 `has("X") | not` 检查（首要禁用 14 个 + generic 禁用 9 个 + 其他 endpoint 字段 9 个）；[BEHAVIOR-类2] keys 完整集合断言 + `operation == "decrement"` 字面严等

### Risk 3: strict-schema 复用 W19~W24 旧 regex 假绿
- **失败模式**：generator 复用 `STRICT_NUMBER` 浮点 regex `^-?\d+(\.\d+)?$` → `value=1.5` 漏拒；或复用 W24 `^\d+$` → `value=-5` 拒错（应通过）；或复用 W26 模板假"借用"导致 endpoint 间隐式耦合
- **触发输入**：`value=1.5`（浮点 regex 会让它通过 → bug）、`value=-5`（W24 regex 拒它 → bug）
- **布防 DoD**：[BEHAVIOR-类4] value=1.5 → 400 + value=1.0 → 400 + [BEHAVIOR-类1] value=-5 → 200 + value=-1 → 200

### Risk 4: 精度下界判定漏写或写错（边界 off-by-one）
- **失败模式**：generator 用 `< -Number.MAX_SAFE_INTEGER`（=−9007199254740991）做下界 → 漏拒；或用 `<= -9007199254740990` → 把 happy 下界 -9007199254740990 误拒
- **触发输入**：`value=-9007199254740990`（happy 必通过）、`value=-9007199254740991`（必拒）
- **布防 DoD**：两条独立 [BEHAVIOR] 在边界两侧 ±1 测，精确卡住正确实现 `Math.abs(Number(value)) > 9007199254740990`

### Risk 5: query 名漂移
- **失败模式**：generator 复读 W24 `req.query.n` / W19~W23 `req.query.a/b` → 用 `value=5` 时拿不到参数返 undefined → 接 `Number(undefined)=NaN` → strict 拒（错走错误分支但 CODE=400 假绿）；或更糟 — generator 把 query 名注册成 `n` → DoD `value=5` 全 404
- **触发输入**：`value=5`（必 happy 200）+ `n=5`（必 400）+ `x=5`（必 400）
- **布防 DoD**：[BEHAVIOR-类1] value=5 → result=4（正向）+ [BEHAVIOR-类4] n=5 → 400（反向）

### Risk 6: BigInt 重写诱惑
- **失败模式**：generator 看到 "9007199254740990" 觉得大数应该用 BigInt，写成 `{result: BigInt(value)-1n}` → JSON.stringify 抛 `TypeError: Do not know how to serialize a BigInt`
- **触发输入**：`value=-9007199254740990` happy
- **布防 DoD**：精度下界 happy [BEHAVIOR-类1] 用 `jq -e '.result == -9007199254740991'`（数字字面比较，BigInt 序列化失败时 response 直接 500 / 解析失败）+ artifact 检查实现不含 BigInt 字面量

### Risk 7: 错误响应混合污染
- **失败模式**：generator 错误分支返 `{error:"bad",result:null,operation:"decrement"}` → 错误体含禁用字段
- **触发输入**：`value=-9007199254740991`（下界拒）
- **布防 DoD**：[BEHAVIOR-类4] 下界拒错误体 `keys|sort==["error"]` + `has("result")|not` + `has("operation")|not` + `.error|type=="string" and length>0` 四联断言

### Risk 8: 八进制误解析（前导 0）
- **失败模式**：generator 用 `parseInt(value)`（无第二参） + ES5 旧引擎 → `parseInt("01")=1` 倒还对，但 `parseInt("08")=0`（旧 8 进制错误） → `value=08` happy 错位
- **触发输入**：`value=01` / `value=-01`
- **布防 DoD**：[BEHAVIOR-类1] value=01 → result==0 严等；E2E 兼测 value=-01 → result==-2

### Risk 9: W26 模板复制错位（[BEHAVIOR] 数量与类型分布）
- **失败模式**：proposer 复制 W26 contract-dod-ws1.md 时把"v5.0 [BEHAVIOR] 条目已搬迁到 vitest"末尾注释保留 → contract-dod-ws1.md 实际 [BEHAVIOR] 条目 = 0；触发 Bug 9
- **触发输入**：`grep -c '^- \[ \] \[BEHAVIOR' contract-dod-ws1.md`
- **布防 DoD**：proposer 自查 checklist 第 5 条强制 ≥ 4 条 + 4 类各 ≥ 1 条；本 contract 末尾 [BEHAVIOR] 条目数自查通过
