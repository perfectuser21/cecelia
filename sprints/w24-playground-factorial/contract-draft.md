# Sprint Contract Draft (Round 1) — W24 playground GET /factorial

> 单 workstream，autonomous journey；接 W19~W23 oracle 链；W24 新增 **跨调用递推不变量** + **PR-D inline SKILL pattern 验收**。

## Golden Path

[HTTP 客户端发 `GET /factorial?n=5`] → [playground server 用 `^\d+$` strict-schema 校验 → 显式 `Number(n) > 18` 上界拒 → 迭代独立复算 `1*2*...*n`] → [返回 200 + `{factorial: 120}`，evaluator 抓两端响应断言 `factorial(5) === 5 * factorial(4) === 120 === 5*24`]

---

### Step 1: 客户端发 happy 请求 `GET /factorial?n=5`

**可观测行为**: HTTP 200 + body `{factorial: 120}`，无任何多余字段。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4001 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
RESP=$(curl -fs "http://127.0.0.1:4001/factorial?n=5")
echo "$RESP" | jq -e '.factorial == 120'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: `jq -e` exit 0；响应 body 严格 `{"factorial":120}`。

---

### Step 2: strict-schema 字段类型校验

**可观测行为**: 响应顶层 `factorial` 必须是 number type，不能是 string、bigint、array、object 或 null。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4002 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
curl -fs "http://127.0.0.1:4002/factorial?n=10" | jq -e '.factorial | type == "number"'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: `jq -e` exit 0；`Number.MAX_SAFE_INTEGER` 之下都用 JS number 精确表达。

---

### Step 3: schema 完整性 — 顶层 keys 严格等于 `["factorial"]`

**可观测行为**: 成功响应顶层 keys 数组排序后必须严格等于 `["factorial"]`，不允许多余字段（无 `operation`、`result`、`n`、`input`、`value`、`fact`、`output` 等）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4003 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
curl -fs "http://127.0.0.1:4003/factorial?n=3" | jq -e 'keys == ["factorial"]'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: `keys == ["factorial"]` 严格相等；多 1 个字段（含 `operation`）即 FAIL。

---

### Step 4: 禁用响应字段反向 — `product` / `result` / `value` / `fact` / `output` / `sum` 必须不存在

**可观测行为**: 成功响应 body 严禁出现以下任一字段名：`product`（W20 的字段，generator 易复读漂移）、`result`（generic 漂移）、`value`、`fact`、`f`、`output`、`data`、`sum`、`quotient`、`power`、`remainder`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4004 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
RESP=$(curl -fs "http://127.0.0.1:4004/factorial?n=4")
echo "$RESP" | jq -e 'has("product") | not' && \
echo "$RESP" | jq -e 'has("result") | not' && \
echo "$RESP" | jq -e 'has("value") | not' && \
echo "$RESP" | jq -e 'has("fact") | not' && \
echo "$RESP" | jq -e 'has("output") | not' && \
echo "$RESP" | jq -e 'has("sum") | not'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: 6 个 `! has()` 全过；任何一条命中 → FAIL。

---

### Step 5: 边界 `n=0` → `{factorial:1}`（数学定义 0! = 1）

**可观测行为**: `factorial(0)` 必须等于 1，不允许 0 或 undefined 或缺字段。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4005 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
curl -fs "http://127.0.0.1:4005/factorial?n=0" | jq -e '.factorial == 1'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: 严格等于 1。

---

### Step 6: 边界 `n=1` → `{factorial:1}`

**可观测行为**: `factorial(1)` 必须等于 1。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4006 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
curl -fs "http://127.0.0.1:4006/factorial?n=1" | jq -e '.factorial == 1'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: 严格等于 1（防 off-by-one：generator 若错把循环写成 `for(i=1;i<n;i++)` 等价于 `(n-1)!` → `factorial(1)` 返 1 巧合过但 `factorial(5)` 返 24 假绿 → Step 1 抓）。

---

### Step 7: 精度上界 `n=18` → `{factorial:6402373705728000}`

**可观测行为**: 18! 是 `Number.MAX_SAFE_INTEGER` 之下最大的精确阶乘；必须返回精确值 `6402373705728000`，不允许浮点近似或 BigInt 字符串。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4007 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
curl -fs "http://127.0.0.1:4007/factorial?n=18" | jq -e '.factorial == 6402373705728000'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: 严格等于 `6402373705728000`（< `Number.MAX_SAFE_INTEGER === 9007199254740991`）。

---

### Step 8: 上界拒 `n=19` → HTTP 400

**可观测行为**: 19! = 121645100408832000 > `Number.MAX_SAFE_INTEGER`（精度上界），必须显式拒；HTTP 400 + body 不含 `factorial`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4008 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /tmp/r4008.json -w "%{http_code}" "http://127.0.0.1:4008/factorial?n=19")
HAS_FACT=$(jq 'has("factorial")' < /tmp/r4008.json)
HAS_ERR=$(jq -r '.error | type' < /tmp/r4008.json)
kill $SPID 2>/dev/null
[ "$CODE" = "400" ] && [ "$HAS_FACT" = "false" ] && [ "$HAS_ERR" = "string" ]
```

**硬阈值**: HTTP 400 + body 不含 `factorial` + body 含 `error: string`。

---

### Step 9: 上界拒 `n=100` → HTTP 400

**可观测行为**: 任意 `n > 18` 都拒；100 是 19 之外的另一个上界例。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4009 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4009/factorial?n=100")
kill $SPID 2>/dev/null
[ "$CODE" = "400" ]
```

**硬阈值**: HTTP 400。

---

### Step 10: 跨调用递推不变量 `factorial(5) === 5 * factorial(4)` （W24 核心 oracle）

**可观测行为**: evaluator 发两次独立 curl，把 `factorial(5)` 与 `factorial(4)` 提出来 join，断言乘法关系严格成立。若 generator 用 Stirling 近似 / Lanczos gamma 近似 / 浮点累积误差 / off-by-one（错把循环上限写成 `<n` 而非 `<=n`） → 一定违反此 oracle。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4010 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
F5=$(curl -fs "http://127.0.0.1:4010/factorial?n=5" | jq -r '.factorial')
F4=$(curl -fs "http://127.0.0.1:4010/factorial?n=4" | jq -r '.factorial')
kill $SPID 2>/dev/null
[ "$F5" = "120" ] && [ "$F4" = "24" ] && [ "$((5 * F4))" = "$F5" ]
```

**硬阈值**: F5 === 120 && F4 === 24 && 5*F4 === F5（即 5*24 === 120 严格相等）。

---

### Step 11: 跨调用递推不变量边界 `factorial(18) === 18 * factorial(17)` （精度上界 oracle）

**可观测行为**: 在精度上界处验递推关系，确保 generator 在大整数上没用近似算法。`17! === 355687428096000`、`18! === 6402373705728000`，且 `18 * 355687428096000 === 6402373705728000` 严格成立。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4011 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
F18=$(curl -fs "http://127.0.0.1:4011/factorial?n=18" | jq -r '.factorial')
F17=$(curl -fs "http://127.0.0.1:4011/factorial?n=17" | jq -r '.factorial')
kill $SPID 2>/dev/null
[ "$F18" = "6402373705728000" ] && [ "$F17" = "355687428096000" ] && [ "$((18 * F17))" = "$F18" ]
```

**硬阈值**: F18 === 6402373705728000 && F17 === 355687428096000 && 18*F17 === F18（即 18 * 355687428096000 === 6402373705728000）。

---

### Step 12: strict-schema 拒 — 缺参 `n` 缺失 → HTTP 400

**可观测行为**: 无 query → 400 + body 不含 `factorial`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4012 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /tmp/r4012.json -w "%{http_code}" "http://127.0.0.1:4012/factorial")
HAS_FACT=$(jq 'has("factorial")' < /tmp/r4012.json)
kill $SPID 2>/dev/null
[ "$CODE" = "400" ] && [ "$HAS_FACT" = "false" ]
```

**硬阈值**: HTTP 400 + body 不含 `factorial`。

---

### Step 13: strict-schema 拒 — 用错 query 名 `value=5` → HTTP 400（缺 `n` 分支）

**可观测行为**: generator 不许漂移到 `value` / `num` / `input` / `x` 等同义词；用 `value=5` 时 `n` 仍未提供 → 走缺参分支 400。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4013 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4013/factorial?value=5")
kill $SPID 2>/dev/null
[ "$CODE" = "400" ]
```

**硬阈值**: HTTP 400。

---

### Step 14: strict-schema 拒 — 负数 `n=-1` → HTTP 400

**可观测行为**: `^\d+$` 拒前导负号；HTTP 400。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4014 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4014/factorial?n=-1")
kill $SPID 2>/dev/null
[ "$CODE" = "400" ]
```

**硬阈值**: HTTP 400。

---

### Step 15: strict-schema 拒 — 小数 `n=5.5` → HTTP 400

**可观测行为**: `^\d+$` 拒小数点；HTTP 400。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4015 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4015/factorial?n=5.5")
kill $SPID 2>/dev/null
[ "$CODE" = "400" ]
```

**硬阈值**: HTTP 400（防 generator 复用 W20/W21/W22/W23 的 `^-?\d+(\.\d+)?$` regex 假绿）。

---

### Step 16: strict-schema 拒 — 浮点形整数 `n=5.0` → HTTP 400

**可观测行为**: 即使数值是整数，只要含小数点也拒（语义"整数 only"严格）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4016 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4016/factorial?n=5.0")
kill $SPID 2>/dev/null
[ "$CODE" = "400" ]
```

**硬阈值**: HTTP 400（强制 strict 严格语义）。

---

### Step 17: strict-schema 拒 — 科学计数法 `n=1e2` → HTTP 400

**可观测行为**: `^\d+$` 拒 `e`；HTTP 400（防 `Number("1e2")===100` 假绿）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4017 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4017/factorial?n=1e2")
kill $SPID 2>/dev/null
[ "$CODE" = "400" ]
```

**硬阈值**: HTTP 400。

---

### Step 18: strict-schema 拒 — 十六进制 `n=0xff` → HTTP 400

**可观测行为**: `^\d+$` 拒 `x` 字符。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4018 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4018/factorial?n=0xff")
kill $SPID 2>/dev/null
[ "$CODE" = "400" ]
```

**硬阈值**: HTTP 400。

---

### Step 19: strict-schema 拒 — 字母 `n=abc` → HTTP 400

**可观测行为**: 非数字串拒。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4019 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
CODE=$(curl -s -o /tmp/r4019.json -w "%{http_code}" "http://127.0.0.1:4019/factorial?n=abc")
HAS_FACT=$(jq 'has("factorial")' < /tmp/r4019.json)
kill $SPID 2>/dev/null
[ "$CODE" = "400" ] && [ "$HAS_FACT" = "false" ]
```

**硬阈值**: HTTP 400 + body 不含 `factorial`。

---

### Step 20: 错误响应 schema — `keys == ["error"]` 且 `.error | type == "string"` 非空

**可观测行为**: 错误响应顶层 keys 严格 `["error"]`；error 是非空 string；body 不含 `factorial`、`message`、`msg`、`reason`、`detail`、`description`、`info`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4020 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
RESP=$(curl -s "http://127.0.0.1:4020/factorial?n=abc")
echo "$RESP" | jq -e 'keys == ["error"]' && \
echo "$RESP" | jq -e '.error | type == "string" and length > 0' && \
echo "$RESP" | jq -e 'has("message") | not' && \
echo "$RESP" | jq -e 'has("msg") | not' && \
echo "$RESP" | jq -e 'has("factorial") | not'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: 5 个 jq -e 全过。

---

### Step 21: happy 用例 `n=05` 前导零 → `{factorial:120}` （strict 通过 + Number("05")===5 等价）

**可观测行为**: `^\d+$` 允许前导 0；`Number("05") === 5`；返回 `{factorial:120}` 与 `n=5` 等价。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4021 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
curl -fs "http://127.0.0.1:4021/factorial?n=05" | jq -e '.factorial == 120'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: `factorial === 120`。

---

### Step 22: 回归 — W19~W23 五条路由 + bootstrap `/health` 共 6 条 happy 仍 200

**可观测行为**: `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 六条现有路由必须不被破坏。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=4022 node server.js > /dev/null 2>&1 & SPID=$!
sleep 2
curl -fs "http://127.0.0.1:4022/health" | jq -e '.ok == true' && \
curl -fs "http://127.0.0.1:4022/sum?a=2&b=3" | jq -e '.sum == 5' && \
curl -fs "http://127.0.0.1:4022/multiply?a=2&b=3" | jq -e '.product == 6' && \
curl -fs "http://127.0.0.1:4022/divide?a=6&b=2" | jq -e '.quotient == 3' && \
curl -fs "http://127.0.0.1:4022/power?a=2&b=10" | jq -e '.power == 1024' && \
curl -fs "http://127.0.0.1:4022/modulo?a=5&b=3" | jq -e '.remainder == 2'
RC=$?
kill $SPID 2>/dev/null
exit $RC
```

**硬阈值**: 6 个 jq -e 全过。

---

## E2E 验收（最终 Evaluator 整套跑）

**journey_type**: autonomous

**完整验证脚本**（覆盖以上 22 个 Step 的浓缩版，单 server 实例端口 4099；evaluator 至少应执行此脚本，exit 0 为通过）:

```bash
#!/usr/bin/env bash
set -e

cd /workspace/playground
PLAYGROUND_PORT=4099 node server.js > /tmp/factorial-e2e.log 2>&1 &
SPID=$!
trap 'kill $SPID 2>/dev/null' EXIT
sleep 2

# 1. happy + 字段值 + 类型 + schema 完整性 + 禁用字段反向
RESP=$(curl -fs "http://127.0.0.1:4099/factorial?n=5")
echo "$RESP" | jq -e '.factorial == 120' > /dev/null
echo "$RESP" | jq -e '.factorial | type == "number"' > /dev/null
echo "$RESP" | jq -e 'keys == ["factorial"]' > /dev/null
echo "$RESP" | jq -e 'has("product") | not' > /dev/null
echo "$RESP" | jq -e 'has("result") | not' > /dev/null
echo "$RESP" | jq -e 'has("value") | not' > /dev/null
echo "$RESP" | jq -e 'has("output") | not' > /dev/null
echo "✓ Step 1-4 PASS (happy + type + schema + 禁用反向)"

# 2. 边界 n=0, n=1, n=18
curl -fs "http://127.0.0.1:4099/factorial?n=0" | jq -e '.factorial == 1' > /dev/null
curl -fs "http://127.0.0.1:4099/factorial?n=1" | jq -e '.factorial == 1' > /dev/null
curl -fs "http://127.0.0.1:4099/factorial?n=18" | jq -e '.factorial == 6402373705728000' > /dev/null
echo "✓ Step 5-7 PASS (边界 0/1/18)"

# 3. 上界拒 n=19, n=20, n=100
for N in 19 20 100; do
  CODE=$(curl -s -o /tmp/uc.json -w "%{http_code}" "http://127.0.0.1:4099/factorial?n=$N")
  [ "$CODE" = "400" ] || { echo "FAIL: n=$N 应 400 实际 $CODE"; exit 1; }
  jq -e 'has("factorial") | not' < /tmp/uc.json > /dev/null
done
echo "✓ Step 8-9 PASS (上界拒 19/20/100)"

# 4. 跨调用递推不变量（W24 核心 oracle）
F5=$(curl -fs "http://127.0.0.1:4099/factorial?n=5" | jq -r '.factorial')
F4=$(curl -fs "http://127.0.0.1:4099/factorial?n=4" | jq -r '.factorial')
[ "$F5" = "120" ] && [ "$F4" = "24" ] && [ "$((5 * F4))" = "$F5" ] || { echo "FAIL: f(5) != 5*f(4)"; exit 1; }

F18=$(curl -fs "http://127.0.0.1:4099/factorial?n=18" | jq -r '.factorial')
F17=$(curl -fs "http://127.0.0.1:4099/factorial?n=17" | jq -r '.factorial')
[ "$F18" = "6402373705728000" ] && [ "$F17" = "355687428096000" ] && [ "$((18 * F17))" = "$F18" ] || { echo "FAIL: f(18) != 18*f(17)"; exit 1; }
echo "✓ Step 10-11 PASS (跨调用递推不变量 5/4 + 18/17)"

# 5. strict-schema 拒
for QS in "" "n=-1" "n=5.5" "n=5.0" "n=+5" "n=1e2" "n=0xff" "n=1%2C000" "n=abc" "n=Infinity" "n=NaN" "n=" "value=5"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4099/factorial?$QS")
  [ "$CODE" = "400" ] || { echo "FAIL: 'http://127.0.0.1:4099/factorial?$QS' 应 400 实际 $CODE"; exit 1; }
done
echo "✓ Step 12-19 PASS (strict 拒 13 类)"

# 6. 错误响应 schema
RESP=$(curl -s "http://127.0.0.1:4099/factorial?n=abc")
echo "$RESP" | jq -e 'keys == ["error"]' > /dev/null
echo "$RESP" | jq -e '.error | type == "string" and length > 0' > /dev/null
echo "$RESP" | jq -e 'has("factorial") | not' > /dev/null
echo "$RESP" | jq -e 'has("message") | not' > /dev/null
echo "✓ Step 20 PASS (error schema 严格)"

# 7. 前导 0 happy
curl -fs "http://127.0.0.1:4099/factorial?n=05" | jq -e '.factorial == 120' > /dev/null
echo "✓ Step 21 PASS (前导 0 happy)"

# 8. 回归（6 路由）
curl -fs "http://127.0.0.1:4099/health" | jq -e '.ok == true' > /dev/null
curl -fs "http://127.0.0.1:4099/sum?a=2&b=3" | jq -e '.sum == 5' > /dev/null
curl -fs "http://127.0.0.1:4099/multiply?a=2&b=3" | jq -e '.product == 6' > /dev/null
curl -fs "http://127.0.0.1:4099/divide?a=6&b=2" | jq -e '.quotient == 3' > /dev/null
curl -fs "http://127.0.0.1:4099/power?a=2&b=10" | jq -e '.power == 1024' > /dev/null
curl -fs "http://127.0.0.1:4099/modulo?a=5&b=3" | jq -e '.remainder == 2' > /dev/null
echo "✓ Step 22 PASS (6 路由回归)"

# 9. PR diff 行级断言 — 验 generator 未删旧路由 (静态)
cd /workspace
DEL_OLD=$(git diff origin/main -- playground/server.js 2>/dev/null | grep -E "^-\s*app\.get\(\s*['\"](\/health|\/sum|\/multiply|\/divide|\/power|\/modulo)['\"]" | wc -l)
[ "$DEL_OLD" = "0" ] || { echo "FAIL: PR diff 删除了 $DEL_OLD 行旧路由 app.get"; exit 1; }
echo "✓ PR diff 行级断言 PASS (无旧路由 app.get 被删)"

echo "✅ W24 Golden Path 全 22 Step + PR diff 验证通过"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 GET /factorial（strict-schema `^\d+$` + 上界 18 拒 + 跨调用递推 oracle）

**范围**: `playground/server.js` 在 `/modulo` 路由之后、`app.listen` 之前新增 `GET /factorial` 路由（strict-schema 校验 + 上界拒 + 迭代复算 + 字段锁死 `factorial`）；`playground/tests/server.test.js` 新增 `GET /factorial` describe 块（happy + 边界 + 上界拒 + strict 拒 + 跨调用递推 oracle + schema oracle + 错误体不含 `factorial` + 现有 6 路由回归）；`playground/README.md` 端点列表加 `/factorial` 段（happy + 边界 + 上界拒 + 递推不变量 各示例）。
**大小**: M（约 14 行 server.js 净增 + 约 240 行测试 + 约 35 行 README）。
**依赖**: 无（W19~W23 已合并，作为回归基线）。

**BEHAVIOR 覆盖测试文件**: `sprints/w24-playground-factorial/tests/ws1/factorial.test.js`（vitest，generator TDD red-green 用；evaluator 不读 vitest 输出，只跑 `contract-dod-ws1.md` 的 `manual:bash` 命令）。

---

## Test Contract

| Workstream | DoD 文件 (含 manual:bash) | Vitest 测试文件 (generator 参考) | BEHAVIOR 覆盖锚点 | 预期红证据 (Red phase) |
|---|---|---|---|---|
| WS1 | `contract-dod-ws1.md` (≥ 24 条 [BEHAVIOR] 内嵌 manual:bash) | `tests/ws1/factorial.test.js` (≥ 30 条 it()) | happy n=0/1/2/5/10/18 + 上界拒 n=19/20/100 + strict 拒 13 类 + 跨调用递推 f(5)=5*f(4) + f(18)=18*f(17) + schema keys=['factorial'] + 错误 keys=['error'] + 禁用字段反向 6+ + 6 路由回归 | 在 `playground/server.js` 加 `/factorial` 路由之前，`factorial.test.js` 应有 ≥ 30 个 fail（404 / 字段不存在等） |

---

## GAN 对抗审查焦点（提示 Reviewer）

1. **验证命令防造假**：每个 [BEHAVIOR] 都启 + kill 独立 server，端口不冲突；jq -e 直接断言值（非 `[ -n "$RESP" ]` 假绿）；recursive oracle 用 `$((5 * F4)) = $F5` 算术比较（generator 用 Stirling 近似必挂）。
2. **schema 完整性 jq -e codify**：PRD Response Schema 段每字段 → ≥ 1 条 jq -e（field type + value + keys==[...] + has(forbidden)|not 全覆盖）。
3. **strict-schema 严格性**：`^\d+$` regex 与 W20-W23 的 `^-?\d+(\.\d+)?$` 不同；负号 / 小数 / `5.0` / `+5` 都拒；前导 0 必须通过（PRD 显式约定）。
4. **跨调用递推 oracle**：W24 首次扩展 evaluator 范式从"单 curl 单 oracle"到"双 curl + join 关系断言"；Step 10/11 是 W24 核心新颖性，Reviewer 必须确认这两个 Step 真在合同里出现且命令真能跑。
5. **PR-D 验收**：Reviewer 输出报告必须含 v6.2 SKILL.md 全部 7 维 rubric（含 `verification_oracle_completeness` + `behavior_count_position`），否则视为 Bug 6 修复未生效。
