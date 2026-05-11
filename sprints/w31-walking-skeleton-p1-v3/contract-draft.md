# Sprint Contract Draft (Round 1) — W31 playground GET /decrement（Walking Skeleton P1 round 3 long-timeout）

> **PR-G 死规则字面照搬承诺**（v7.5 + W31 W26 模板漏改防御）：
> - response success keys = `result` + `operation`（字面，**严禁**漂到 `decremented`/`prev`/`previous`/`predecessor`/`pred`/`n_minus_one`/`minus_one`/`sub_one`/`subtracted`/`sub`/`dec`/`decr`/`decrementation` 任一禁用名）
> - operation 字面值 = `"decrement"`（**特别警告：禁止漏改 W26 模板留下的 `"increment"`；禁用变体 `dec`/`decr`/`pred`/`sub`/`minus_one`/`sub_one`/`pred`/`prev`/`previous`/`predecessor`/`incremented`/`n_plus_one`/`successor`/`op`/`method`/`action`/`type`/`kind`**）
> - query param 字面名 = `value`（禁用 `n`/`x`/`y`/`m`/`val`/`num`/`input`/`v`/`count` 等共 ≥ 24 个禁用名）
> - response error key = `error`（禁用 `message`/`msg`/`reason`/`detail`/`code`）
> - schema 完整性：成功响应 keys 字面集合 = `["operation","result"]`（按字母序）；错误响应 keys 字面集合 = `["error"]`
>
> Proposer 自查 checklist（v7.6 死规则 + Bug 9 ≥ 4 [BEHAVIOR]）：
> 1. PRD `## Response Schema` 段 success keys = {`result`,`operation`} ✓ contract jq -e 用 keys 字面集合 = {`result`,`operation`} ✓
> 2. PRD operation 字面 = `"decrement"` ✓ contract jq -e 写 `.operation == "decrement"` ✓（且独立写 `.operation != "increment"` 防 W26 模板漏改）
> 3. PRD 禁用清单（`decremented`/`prev`/`previous`/`predecessor`/`pred`/`n_minus_one`/`minus_one`/`sub_one`/`subtracted`/`sub`/`dec`/`decr`/`decrementation`/`incremented`/`n_plus_one`/`successor`/`value`/`input`/`output`/`data`/`payload`/`response`/`answer`/`out`/`meta`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`negation`）→ contract 仅在反向 `has("X") | not` 出现，**绝不出现在正向断言**
> 4. PRD success schema 完整性 keys 集合 = `["operation","result"]` ✓ contract jq -e `keys | sort == ["operation","result"]`
> 5. contract-dod-ws1.md `grep -c '^- \[ \] \[BEHAVIOR\]'` ≥ 4 ✓ 本合同 DoD 含 17 条 [BEHAVIOR] 内嵌 manual:bash（schema 字段 / keys 完整性 / 禁用字段反向 / error path / off-by-one / 精度上下界 / 字面 "decrement" 防漏改 / 缺参 / 错 query 名 / 多余 query / 前导 0 / 回归各 ≥ 1 条）

---

## Golden Path

[HTTP 客户端发 `GET /decrement?value=<十进制整数字符串，含可选前导负号>`]
→ [playground server 收到请求，校验 query 顶层 keys 长度 == 1 且唯一 key 是 `value`]
→ [对 value 做 strict-schema `^-?\d+$` 校验]
→ [strict 通过后判定 `Math.abs(Number(value)) > 9007199254740990`，超界则返 400]
→ [合法则计算 `result = Number(value) - 1`]
→ [返回 HTTP 200 `{result: <Number(value)-1>, operation: "decrement"}`，顶层 keys 字面 = `["operation","result"]`]

---

### Step 1: 客户端发 `GET /decrement?value=5` 合法请求

**可观测行为**: server 返 HTTP 200，body `{result: 4, operation: "decrement"}`，顶层 keys 字面集合 = `["operation","result"]`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3601 NODE_ENV=production node server.js > /tmp/ws1-step1.log 2>&1 &
SPID=$!
sleep 2

# 1. 值复算严格相等
RESP=$(curl -fs "http://localhost:3601/decrement?value=5")
echo "$RESP" | jq -e '.result == 4' || { kill $SPID; echo "FAIL: result != 4"; exit 1; }

# 2. operation 字面字符串相等 + 防漏改 "increment"
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; echo "FAIL: operation != \"decrement\""; exit 1; }
echo "$RESP" | jq -e '.operation != "increment"' || { kill $SPID; echo "FAIL: 漏改 W26 模板 operation=increment"; exit 1; }

# 3. result 类型为 number
echo "$RESP" | jq -e '.result | type == "number"' || { kill $SPID; echo "FAIL: result not number"; exit 1; }

# 4. schema 完整性 — 顶层 keys 字面集合相等
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; echo "FAIL: keys != [operation,result]"; exit 1; }

# 5. 禁用响应字段名反向不存在（含 W26 同义对偶诱惑 + W31 同义诱惑）
for k in decremented prev previous predecessor pred n_minus_one minus_one sub_one subtracted sub dec decr decrementation incremented n_plus_one successor value input output data payload response answer out meta sum product quotient power remainder factorial negation; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { kill $SPID; echo "FAIL: 禁用字段 $k 出现在 response"; exit 1; }
done

kill $SPID
echo "✅ Step 1 通过"
```

**硬阈值**: HTTP 200，`result === 4`，`operation === "decrement"` 字面严等，顶层 keys = `["operation","result"]`，30 个禁用字段反向全不存在

---

### Step 2: 客户端发 `GET /decrement?value=0`（off-by-one 边界 happy）

**可观测行为**: server 返 HTTP 200，body `{result: -1, operation: "decrement"}`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3602 NODE_ENV=production node server.js > /tmp/ws1-step2.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3602/decrement?value=0")
echo "$RESP" | jq -e '.result == -1' || { kill $SPID; echo "FAIL: 0 → result != -1（off-by-one）"; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 2 通过（off-by-one 0 → -1）"
```

**硬阈值**: `result === -1`，验证 off-by-one 防线（不会被当 falsy 漏返）

---

### Step 3: 客户端发 `GET /decrement?value=1`（off-by-one 边界 happy）

**可观测行为**: server 返 HTTP 200，body `{result: 0, operation: "decrement"}`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3603 NODE_ENV=production node server.js > /tmp/ws1-step3.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3603/decrement?value=1")
echo "$RESP" | jq -e '.result == 0' || { kill $SPID; echo "FAIL: 1 → result != 0"; exit 1; }
echo "$RESP" | jq -e '.result | type == "number"' || { kill $SPID; echo "FAIL: result type"; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 3 通过（1 → 0，0 不被当 falsy 漏返）"
```

**硬阈值**: `result === 0`（严格 0 数字字面，非 null/undefined/false）

---

### Step 4: 客户端发 `GET /decrement?value=-1`（off-by-one 负侧边界）

**可观测行为**: server 返 HTTP 200，body `{result: -2, operation: "decrement"}`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3604 NODE_ENV=production node server.js > /tmp/ws1-step4.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3604/decrement?value=-1")
echo "$RESP" | jq -e '.result == -2' || { kill $SPID; echo "FAIL: -1 → result != -2"; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 4 通过（-1 → -2 负侧 off-by-one）"
```

**硬阈值**: `result === -2`

---

### Step 5: 精度上界 `value=9007199254740990` 合法

**可观测行为**: 返 HTTP 200，`result === 9007199254740989`（精确，无浮点损失）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3605 NODE_ENV=production node server.js > /tmp/ws1-step5.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3605/decrement?value=9007199254740990")
echo "$RESP" | jq -e '.result == 9007199254740989' || { kill $SPID; echo "FAIL: 上界精度不准"; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 5 通过（精度上界 happy）"
```

**硬阈值**: `result === 9007199254740989`，精确整数

---

### Step 6: 精度下界 `value=-9007199254740990` 合法（结果命中 MIN_SAFE_INTEGER）

**可观测行为**: 返 HTTP 200，`result === -9007199254740991`（即 `Number.MIN_SAFE_INTEGER`）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3606 NODE_ENV=production node server.js > /tmp/ws1-step6.log 2>&1 &
SPID=$!
sleep 2

RESP=$(curl -fs "http://localhost:3606/decrement?value=-9007199254740990")
echo "$RESP" | jq -e '.result == -9007199254740991' || { kill $SPID; echo "FAIL: 下界精度不准"; exit 1; }
# 显式断言命中 MIN_SAFE_INTEGER
node -e "process.exit(Number.MIN_SAFE_INTEGER === -9007199254740991 ? 0 : 1)" || { kill $SPID; echo "FAIL: Number.MIN_SAFE_INTEGER 不等于预期常量"; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 6 通过（精度下界 happy → MIN_SAFE_INTEGER）"
```

**硬阈值**: `result === -9007199254740991 === Number.MIN_SAFE_INTEGER`

---

### Step 7: 上界拒 `value=9007199254740991`

**可观测行为**: 返 HTTP 400，`{error: "<非空 string>"}`，body 不含 `result` 也不含 `operation`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3607 NODE_ENV=production node server.js > /tmp/ws1-step7.log 2>&1 &
SPID=$!
sleep 2

CODE=$(curl -s -o /tmp/ws1-step7-body.json -w "%{http_code}" "http://localhost:3607/decrement?value=9007199254740991")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 上界 +1 非 400 (got $CODE)"; exit 1; }
cat /tmp/ws1-step7-body.json | jq -e '.error | type == "string" and length > 0' || { kill $SPID; exit 1; }
cat /tmp/ws1-step7-body.json | jq -e 'has("result") | not' || { kill $SPID; echo "FAIL: 错误体含 result"; exit 1; }
cat /tmp/ws1-step7-body.json | jq -e 'has("operation") | not' || { kill $SPID; echo "FAIL: 错误体含 operation"; exit 1; }
cat /tmp/ws1-step7-body.json | jq -e 'keys | sort == ["error"]' || { kill $SPID; echo "FAIL: 错误体含多余字段"; exit 1; }

kill $SPID
echo "✅ Step 7 通过（上界拒）"
```

**硬阈值**: HTTP 400，error 非空 string，错误体顶层 keys = `["error"]`

---

### Step 8: 下界拒 `value=-9007199254740991`

**可观测行为**: 返 HTTP 400，错误体顶层 keys = `["error"]`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3608 NODE_ENV=production node server.js > /tmp/ws1-step8.log 2>&1 &
SPID=$!
sleep 2

CODE=$(curl -s -o /tmp/ws1-step8-body.json -w "%{http_code}" "http://localhost:3608/decrement?value=-9007199254740991")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 下界 -1 非 400 (got $CODE)"; exit 1; }
cat /tmp/ws1-step8-body.json | jq -e 'keys | sort == ["error"]' || { kill $SPID; exit 1; }
cat /tmp/ws1-step8-body.json | jq -e 'has("result") | not' || { kill $SPID; exit 1; }
cat /tmp/ws1-step8-body.json | jq -e 'has("operation") | not' || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 8 通过（下界拒）"
```

**硬阈值**: HTTP 400，错误体不含 result/operation

---

### Step 9: strict-schema 拒（13 类非法输入扫一遍）

**可观测行为**: 13 类非法输入全返 HTTP 400

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3609 NODE_ENV=production node server.js > /tmp/ws1-step9.log 2>&1 &
SPID=$!
sleep 2

# 小数拒
CODE=$(curl -s -o /tmp/ws1-step9-body.json -w "%{http_code}" "http://localhost:3609/decrement?value=1.5")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 1.5 非 400 (got $CODE)"; exit 1; }
cat /tmp/ws1-step9-body.json | jq -e 'has("result") | not' || { kill $SPID; exit 1; }

# 1.0 也拒（小数点本身就拒）
CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=1.0")
[ "$CODE2" = "400" ] || { kill $SPID; echo "FAIL: 1.0 非 400 (got $CODE2)"; exit 1; }

# 科学计数法拒
CODE3=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=1e2")
[ "$CODE3" = "400" ] || { kill $SPID; echo "FAIL: 1e2 非 400"; exit 1; }

# 十六进制拒
CODE4=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=0xff")
[ "$CODE4" = "400" ] || { kill $SPID; echo "FAIL: 0xff 非 400"; exit 1; }

# 千分位拒（URL encoded 逗号 %2C）
CODE5=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=1%2C000")
[ "$CODE5" = "400" ] || { kill $SPID; echo "FAIL: 1,000 非 400"; exit 1; }

# 前导 + 拒（URL encoded %2B）
CODE6=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=%2B5")
[ "$CODE6" = "400" ] || { kill $SPID; echo "FAIL: +5 非 400"; exit 1; }

# 双重负号拒
CODE7=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=--5")
[ "$CODE7" = "400" ] || { kill $SPID; echo "FAIL: --5 非 400"; exit 1; }

# 尾部负号拒
CODE7b=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=5-")
[ "$CODE7b" = "400" ] || { kill $SPID; echo "FAIL: 5- 非 400"; exit 1; }

# Infinity 拒
CODE8=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=Infinity")
[ "$CODE8" = "400" ] || { kill $SPID; echo "FAIL: Infinity 非 400"; exit 1; }

# NaN 拒
CODE9=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=NaN")
[ "$CODE9" = "400" ] || { kill $SPID; echo "FAIL: NaN 非 400"; exit 1; }

# 字母拒
CODE10=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=abc")
[ "$CODE10" = "400" ] || { kill $SPID; echo "FAIL: abc 非 400"; exit 1; }

# 仅负号拒
CODE11=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=-")
[ "$CODE11" = "400" ] || { kill $SPID; echo "FAIL: 仅 - 非 400"; exit 1; }

# 空串拒
CODE12=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3609/decrement?value=")
[ "$CODE12" = "400" ] || { kill $SPID; echo "FAIL: 空串非 400"; exit 1; }

kill $SPID
echo "✅ Step 9 通过（strict 拒 13 类）"
```

**硬阈值**: 13 类非法输入全 400

---

### Step 10: 缺参 / 错 query 名 / 多余 query 拒

**可观测行为**: 缺 `value` 参数 → HTTP 400；用错 query 名（如 `n=5`、`x=5`）→ HTTP 400；`?value=5&extra=x` 多余 query → HTTP 400

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3610 NODE_ENV=production node server.js > /tmp/ws1-step10.log 2>&1 &
SPID=$!
sleep 2

# 缺 value
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3610/decrement")
[ "$CODE" = "400" ] || { kill $SPID; echo "FAIL: 缺参非 400 (got $CODE)"; exit 1; }

# 错 query 名（PRD 强约束：只接受 value，禁用其他 24+ 个名）
for badname in n x y m k val num number int integer input arg v count size len target a b; do
  CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3610/decrement?$badname=5")
  [ "$CODE2" = "400" ] || { kill $SPID; echo "FAIL: query 名 $badname 非 400 (got $CODE2)"; exit 1; }
done

# 多余 query 参（?value=5&extra=x）
CODE3=$(curl -s -o /tmp/ws1-step10-body.json -w "%{http_code}" "http://localhost:3610/decrement?value=5&extra=x")
[ "$CODE3" = "400" ] || { kill $SPID; echo "FAIL: 多余 query 非 400 (got $CODE3)"; exit 1; }
cat /tmp/ws1-step10-body.json | jq -e 'has("result") | not' || { kill $SPID; echo "FAIL: 多余 query 错误体含 result"; exit 1; }
cat /tmp/ws1-step10-body.json | jq -e 'has("operation") | not' || { kill $SPID; echo "FAIL: 多余 query 错误体含 operation"; exit 1; }

kill $SPID
echo "✅ Step 10 通过（缺参/错 query 名/多余 query 拒）"
```

**硬阈值**: 缺参、19 个禁用 query 名、多余 query 一律 400

---

### Step 11: 前导 0（`value=01`、`value=-01`）合法 happy

**可观测行为**: `value=01` → `{result: 0, operation: "decrement"}`；`value=-01` → `{result: -2, operation: "decrement"}`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3611 NODE_ENV=production node server.js > /tmp/ws1-step11.log 2>&1 &
SPID=$!
sleep 2

RESP1=$(curl -fs "http://localhost:3611/decrement?value=01")
echo "$RESP1" | jq -e '.result == 0' || { kill $SPID; echo "FAIL: 01 → result != 0（可能 generator 错用八进制 parseInt(value,8)）"; exit 1; }
echo "$RESP1" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }

RESP2=$(curl -fs "http://localhost:3611/decrement?value=-01")
echo "$RESP2" | jq -e '.result == -2' || { kill $SPID; echo "FAIL: -01 → result != -2"; exit 1; }

kill $SPID
echo "✅ Step 11 通过（前导 0 happy；非八进制误解析）"
```

**硬阈值**: `value=01` → `result === 0`（非八进制错位）；`value=-01` → `result === -2`

---

### Step 12: 回归 — 已有 8 路由（`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment`）不被破坏

**可观测行为**: 八条已有路由各 1 条 happy 用例仍通过

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3612 NODE_ENV=production node server.js > /tmp/ws1-step12.log 2>&1 &
SPID=$!
sleep 2

curl -fs "http://localhost:3612/health" | jq -e '.ok == true' || { kill $SPID; echo "FAIL: /health 回归"; exit 1; }
curl -fs "http://localhost:3612/sum?a=2&b=3" | jq -e '.sum == 5' || { kill $SPID; echo "FAIL: /sum 回归"; exit 1; }
curl -fs "http://localhost:3612/multiply?a=2&b=3" | jq -e '.product == 6' || { kill $SPID; echo "FAIL: /multiply 回归"; exit 1; }
curl -fs "http://localhost:3612/divide?a=6&b=3" | jq -e '.quotient == 2' || { kill $SPID; echo "FAIL: /divide 回归"; exit 1; }
curl -fs "http://localhost:3612/power?a=2&b=3" | jq -e '.power == 8' || { kill $SPID; echo "FAIL: /power 回归"; exit 1; }
curl -fs "http://localhost:3612/modulo?a=7&b=3" | jq -e '.remainder == 1' || { kill $SPID; echo "FAIL: /modulo 回归"; exit 1; }
curl -fs "http://localhost:3612/factorial?n=5" | jq -e '.factorial == 120' || { kill $SPID; echo "FAIL: /factorial 回归"; exit 1; }
curl -fs "http://localhost:3612/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { kill $SPID; echo "FAIL: /increment 回归（W26）"; exit 1; }

kill $SPID
echo "✅ Step 12 通过（8 路由回归）"
```

**硬阈值**: 8 条已有路由全 happy 不破坏

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd playground

# 0. 启 server（统一端口 3700 做 E2E）
PLAYGROUND_PORT=3700 NODE_ENV=production node server.js > /tmp/w31-e2e.log 2>&1 &
SPID=$!
trap "kill $SPID 2>/dev/null" EXIT
sleep 2

# 1. happy 多用例（含 off-by-one 0/1/-1、精度上下界、正负数）
for pair in "5:4" "0:-1" "1:0" "-1:-2" "-5:-6" "100:99" "-100:-101" "9007199254740990:9007199254740989" "-9007199254740990:-9007199254740991"; do
  V="${pair%:*}"; EXPECT="${pair#*:}"
  RESP=$(curl -fs "http://localhost:3700/decrement?value=$V")
  echo "$RESP" | jq -e ".result == $EXPECT" || { echo "FAIL: value=$V → result != $EXPECT"; exit 1; }
  echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: value=$V → operation != \"decrement\""; exit 1; }
  echo "$RESP" | jq -e '.operation != "increment"' || { echo "FAIL: value=$V → 漏改 W26 模板 operation=increment"; exit 1; }
  echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { echo "FAIL: value=$V → schema drift"; exit 1; }
done

# 2. 禁用字段反向断言（W31 PR-G + W26 同义对偶诱惑防御）
RESP=$(curl -fs "http://localhost:3700/decrement?value=5")
for badkey in decremented prev previous predecessor pred n_minus_one minus_one sub_one subtracted sub dec decr decrementation incremented n_plus_one successor value input output data payload response answer out meta sum product quotient power remainder factorial negation; do
  echo "$RESP" | jq -e "has(\"$badkey\") | not" > /dev/null || { echo "FAIL: 响应含禁用字段 $badkey"; exit 1; }
done

# 3. operation 字面值严格相等（含 W26 模板漏改防御）
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: operation 变体污染"; exit 1; }
echo "$RESP" | jq -e '.operation != "increment"' || { echo "FAIL: 漏改 W26 模板"; exit 1; }

# 4. 上界拒 / 下界拒
for badv in "9007199254740991" "-9007199254740991" "99999999999999999999"; do
  CODE=$(curl -s -o /tmp/w31-err.json -w "%{http_code}" "http://localhost:3700/decrement?value=$badv")
  [ "$CODE" = "400" ] || { echo "FAIL: $badv 非 400 (got $CODE)"; exit 1; }
  cat /tmp/w31-err.json | jq -e 'keys | sort == ["error"]' || { echo "FAIL: $badv 错误体 schema drift"; exit 1; }
  cat /tmp/w31-err.json | jq -e 'has("result") | not' || { echo "FAIL: $badv 错误体含 result"; exit 1; }
  cat /tmp/w31-err.json | jq -e 'has("operation") | not' || { echo "FAIL: $badv 错误体含 operation"; exit 1; }
done

# 5. strict-schema 拒 13 类
for badv_url in "1.5" "1.0" "1e2" "0xff" "abc" "Infinity" "NaN" "-" "" "1%2C000" "%2B5" "--5" "5-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/decrement?value=$badv_url")
  [ "$CODE" = "400" ] || { echo "FAIL: '$badv_url' 非 400 (got $CODE)"; exit 1; }
done

# 6. 缺参 + 错 query 名 + 多余 query
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/decrement")
[ "$CODE" = "400" ] || { echo "FAIL: 缺参非 400"; exit 1; }
for bn in n x y m val input v a b count size; do
  CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/decrement?$bn=5")
  [ "$CODE2" = "400" ] || { echo "FAIL: query=$bn 非 400"; exit 1; }
done
CODE3=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3700/decrement?value=5&extra=x")
[ "$CODE3" = "400" ] || { echo "FAIL: 多余 query 非 400"; exit 1; }

# 7. 前导 0 happy
RESP01=$(curl -fs "http://localhost:3700/decrement?value=01")
echo "$RESP01" | jq -e '.result == 0' || { echo "FAIL: 01 → result != 0"; exit 1; }
RESPN01=$(curl -fs "http://localhost:3700/decrement?value=-01")
echo "$RESPN01" | jq -e '.result == -2' || { echo "FAIL: -01 → result != -2"; exit 1; }

# 8. 已有路由回归
curl -fs "http://localhost:3700/health" | jq -e '.ok == true' || { echo "FAIL: /health 回归"; exit 1; }
curl -fs "http://localhost:3700/sum?a=2&b=3" | jq -e '.sum == 5' || { echo "FAIL: /sum 回归"; exit 1; }
curl -fs "http://localhost:3700/multiply?a=2&b=3" | jq -e '.product == 6' || { echo "FAIL: /multiply 回归"; exit 1; }
curl -fs "http://localhost:3700/divide?a=6&b=3" | jq -e '.quotient == 2' || { echo "FAIL: /divide 回归"; exit 1; }
curl -fs "http://localhost:3700/power?a=2&b=3" | jq -e '.power == 8' || { echo "FAIL: /power 回归"; exit 1; }
curl -fs "http://localhost:3700/modulo?a=7&b=3" | jq -e '.remainder == 1' || { echo "FAIL: /modulo 回归"; exit 1; }
curl -fs "http://localhost:3700/factorial?n=5" | jq -e '.factorial == 120' || { echo "FAIL: /factorial 回归"; exit 1; }
curl -fs "http://localhost:3700/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { echo "FAIL: /increment 回归"; exit 1; }

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

**范围**: 仅动 `playground/server.js`（在 `/factorial` 之后 `app.listen` 之前新增 `/decrement` 路由，≈ 10-13 行；写独立的字面量 `^-?\d+$` 或独立常量名，禁止 import 复用 W26 `STRICT_INT` 制造耦合）、`playground/tests/server.test.js`（新增 `describe('GET /decrement', ...)` 块，与既有 8 个 endpoint describe 平级）、`playground/README.md`（端点列表加 `/decrement` 段）三个文件，绝不动其他文件。

**大小**: M（≈ 200-300 行测试 + 10-13 行实现 + 30 行 README）

**依赖**: 无

**BEHAVIOR 覆盖**: `contract-dod-ws1.md` 内嵌 17 条 [BEHAVIOR] manual:bash 命令；辅助单测 `tests/ws1/decrement.test.js`（generator TDD 用，evaluator 不读输出）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/decrement.test.js` | value=5 → result==4 / value=0 → result==-1 / value=1 → result==0 / value=-1 → result==-2 / 精度上界 / 精度下界 / 上界 +1 拒 / 下界 -1 拒 / 缺 value / 多余 query / 前导 0 happy / 禁用字段名 / operation 字面严等 / 回归： | 现 playground/server.js 无 `/decrement` 路由 → 所有相关 supertest 断言 fail（Express 默认 404 → res.status===404 != 200） |

> 后缀说明：playground 子项目零依赖纯 JS（无 tsconfig），故 vitest 测试用 `.test.js`。与 SKILL 模板 `.test.ts` 不一致是被动适配 playground 子项目栈，不是合同违规（与 W26 一致）。

---

## Risks（最易踩坑 + 已布防 oracle）

> Generator 实施时最易踩的坑 + 已布防对应 DoD oracle。W31 是 W26 的算术对偶，proposer 必须挡住 generator 抄 W26 模板留下 increment 痕迹的两类风险。

### Risk 1: off-by-one（最高严重度）
- **失败模式**：generator 误写 `return Number(value)`（漏减）/ `return Number(value) + 1`（W26 模板漏改方向）/ `return Number(value) - 2` 等
- **触发输入**：`value=0`（最敏感 — 期望 -1，错位 0/-2/+1 一眼看出）、`value=1`（期望 0，错位 +1/-1/+2）、`value=-1`（期望 -2，错位 -1/+0）
- **布防 DoD**：三条独立 [BEHAVIOR]（value=0→result==-1；value=1→result==0；value=-1→result==-2），不与 `value=5` 共用

### Risk 2: W26 模板漏改 operation 字面（W31 独有 — 最易踩）
- **失败模式**：generator 复制 W26 `/increment` 路由模板时漏改 `operation: 'increment'` → `'decrement'`，端到端返回 `{result:4, operation:"increment"}` 算术对了但字面错
- **触发输入**：任一 happy GET
- **布防 DoD**：1 条独立 [BEHAVIOR] 断言 `.operation != "increment"`（反向防漏改）+ 1 条 `.operation == "decrement"` 字面严等正向断言；E2E 也复跑两次

### Risk 3: 字段名漂移（PR-G 验收核心 risk）
- **失败模式**：generator 漂到 `{decremented:4}` / `{prev:4}` / `{predecessor:4}` / `{n_minus_one:4}` / `{result:4, operation:"dec"}` / `req.query.n` 等任一禁用形态
- **触发输入**：任一 happy GET
- **布防 DoD**：1 条独立 [BEHAVIOR] 反向 `has("X") | not` 检查（≥ 30 个禁用名）+ 1 条 keys 完整集合断言 `keys|sort==["operation","result"]` + 1 条 `operation == "decrement"` 字面严等

### Risk 4: strict-schema 复用 W19~W24 旧 regex 假绿
- **失败模式**：generator 复用 `STRICT_NUMBER` 浮点 regex `^-?\d+(\.\d+)?$` → `value=1.5` 漏拒；或复用 W24 `^\d+$` → `value=-5` 拒错（应通过）
- **触发输入**：`value=1.5`（浮点 regex 会让它通过 → bug）、`value=-5`（W24 regex 拒它 → bug）
- **布防 DoD**：[BEHAVIOR] value=1.5 → 400 + value=1.0 → 400 + value=-5 → 200 + value=-1 → 200

### Risk 5: 精度上界判定漏写或写错（边界 off-by-one）
- **失败模式**：generator 用 `> Number.MAX_SAFE_INTEGER`（=9007199254740991）做上界 → 漏拒；或用 `>= 9007199254740990` → 把 happy 上界 9007199254740990 误拒
- **触发输入**：`value=9007199254740990`（happy 必通过）、`value=9007199254740991`（必拒）、`value=-9007199254740990`（happy 必通过 — result 命中 MIN_SAFE_INTEGER）、`value=-9007199254740991`（必拒）
- **布防 DoD**：四条独立 [BEHAVIOR] 在边界两侧 ±1 测，精确卡住正确实现 `Math.abs(Number(value)) > 9007199254740990`

### Risk 6: query 名漂移（v8.2 强约束）
- **失败模式**：generator 复读 W24 `req.query.n` / W19~W23 `req.query.a/b` → 用 `value=5` 时拿不到参数返 undefined → 接 `Number(undefined)=NaN` → strict 拒（错走错误分支但 CODE=400 假绿）；或更糟 — generator 把 query 名注册成 `n` → DoD `value=5` 全 404
- **触发输入**：`value=5`（必 happy 200）+ `n=5`（必 400）+ `x=5`（必 400）+ 其他 17+ 禁用名
- **布防 DoD**：[BEHAVIOR] value=5 → result=4（正向）+ n=5 → 400（反向）+ E2E 用 11 个错 query 名扫一遍

### Risk 7: 复用 W26 实现的 STRICT_INT 常量（PRD 禁解耦）
- **失败模式**：generator 看到 W26 已有 `STRICT_INT = /^-?\d+$/`，import 复用 → 表面通过但形成 endpoint 间隐式耦合，W26 改 regex 会破坏 /decrement
- **触发输入**：artifact 检查实现源码
- **布防 DoD**：[ARTIFACT] grep /decrement 路由源码块含独立的 `^-?\d+$` 字面量或独立常量名（非复用 W26 `STRICT_INT`）

### Risk 8: 错误响应混合污染
- **失败模式**：generator 错误分支返 `{error:"bad",result:null,operation:"decrement"}` → 错误体含禁用字段
- **触发输入**：`value=9007199254740991`（上界拒）/ `value=1.5`（strict 拒）
- **布防 DoD**：[BEHAVIOR] 上界拒错误体 `keys|sort==["error"]` + `has("result")|not` + `has("operation")|not` + `.error|type=="string" and length>0` 四联断言

### Risk 9: 八进制误解析
- **失败模式**：generator 用 `parseInt(value)`（无第二参） + ES5 旧引擎 → `parseInt("01")=1` 倒还对，但 `parseInt("08")=0`（旧 8 进制错误） → `value=08` happy 错位
- **触发输入**：`value=01` / `value=-01`
- **布防 DoD**：[BEHAVIOR] value=01 → result==0 严等；value=-01 → result==-2 严等

### Risk 10: BigInt 重写诱惑
- **失败模式**：generator 看到 "9007199254740990" 觉得大数应该用 BigInt，写成 `{result: BigInt(value)-1n}` → JSON.stringify 抛 `TypeError: Do not know how to serialize a BigInt`
- **触发输入**：`value=9007199254740990` happy
- **布防 DoD**：精度上界 happy [BEHAVIOR] 用 `jq -e '.result == 9007199254740989'`（数字字面比较，BigInt 序列化失败时 response 直接 500 / 解析失败）
