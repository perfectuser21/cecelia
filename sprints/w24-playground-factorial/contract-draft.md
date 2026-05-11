# Sprint Contract Draft (Round 1)

> **合同范围**：playground 加 `GET /factorial` endpoint，单参 `n`、strict-schema `^\d+$`、`n > 18` 显式拒、迭代精确复算、**跨调用递推不变量** oracle 强制双 curl 验证、PR-D Bug 6 inline SKILL pattern 真生效验收。
> **journey_type**: autonomous
> **合同硬范围**：只动 `playground/server.js`、`playground/tests/server.test.js`、`playground/README.md`。**禁动**任何 brain / engine / dashboard / apps / packages 代码；**禁动** `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 这六条路由的实现与单测一字一节；**禁引入**新依赖（含 BigInt 重写、bignumber.js、decimal.js、mathjs、zod、joi、ajv 任意一个）；**禁加** `Number.isFinite` 结果兜底（strict + `n ≤ 18` 已保证有限）；**禁支持** 负数 / 浮点 / 复数 / gamma 延拓阶乘。

---

## Golden Path

[客户端发 `GET /factorial?n=<非负整数十进制字符串>`] → [playground server 按 strict-schema `^\d+$` 校验 n → 显式判定 `Number(n) > 18` 拒 → 迭代独立复算 `1*2*...*Number(n)`] → [客户端收 200 + `{"factorial": <精确整数>}`，或 400 + `{"error": "<非空字符串>"}`，且对任何 `Number(n) > 0` 的合法 n 均有跨调用关系 `factorial(n) === n * factorial(n-1)` 严格成立]

---

### Step 1: 客户端发起合法 happy 请求（中段值）

**可观测行为**: 对 `GET /factorial?n=5` 返 HTTP 200，body 严等 `{"factorial": 120}`，顶层 keys 严等 `["factorial"]`，无任何禁用字段（`result`/`value`/`fact`/`product` 等）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3101 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3101/factorial?n=5")
echo "$RESP" | jq -e '.factorial == 120' || { echo "FAIL step1 值不等于 120"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.factorial | type == "number"' || { echo "FAIL step1 factorial 非 number 类型"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["factorial"]' || { echo "FAIL step1 顶层 keys 不严等 [\"factorial\"]"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL step1 禁用字段 result 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("value") | not' || { echo "FAIL step1 禁用字段 value 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("product") | not' || { echo "FAIL step1 W20 字段 product 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("fact") | not' || { echo "FAIL step1 禁用字段 fact 漏网"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 1 happy 中段 PASS"
```

**硬阈值**: `.factorial === 120` 严等；`keys == ["factorial"]` 严等；任一禁用字段存在即 FAIL。

---

### Step 2: 数学定义边界 `n=0` 与 `n=1`（0! = 1! = 1）

**可观测行为**: `GET /factorial?n=0` → `{factorial: 1}`；`GET /factorial?n=1` → `{factorial: 1}`。防 off-by-one 实现（写成 `0! = 0` 或循环起点错位）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3102 node server.js & SPID=$!
sleep 2
R0=$(curl -fs "localhost:3102/factorial?n=0")
echo "$R0" | jq -e '.factorial == 1' || { echo "FAIL 0! != 1 实际=$R0"; kill $SPID; exit 1; }
R1=$(curl -fs "localhost:3102/factorial?n=1")
echo "$R1" | jq -e '.factorial == 1' || { echo "FAIL 1! != 1 实际=$R1"; kill $SPID; exit 1; }
echo "$R0" | jq -e 'keys == ["factorial"]' || { echo "FAIL n=0 schema 不严"; kill $SPID; exit 1; }
echo "$R1" | jq -e 'keys == ["factorial"]' || { echo "FAIL n=1 schema 不严"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 2 数学边界 0!=1!=1 PASS"
```

**硬阈值**: `0!` 与 `1!` 均严等 1；任一不等即 FAIL。

---

### Step 3: 精度上界 `n=18` 必须精确返 `6402373705728000`

**可观测行为**: `GET /factorial?n=18` → `{factorial: 6402373705728000}`，且数值小于 `Number.MAX_SAFE_INTEGER (9007199254740991)`，整数精度无损。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3103 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3103/factorial?n=18")
echo "$RESP" | jq -e '.factorial == 6402373705728000' || { echo "FAIL 18! 不严等 6402373705728000 实际=$RESP"; kill $SPID; exit 1; }
# 同时断言 < MAX_SAFE_INTEGER（防 generator 用近似实现侥幸过）
echo "$RESP" | jq -e '.factorial < 9007199254740991' || { echo "FAIL 18! 越过 MAX_SAFE_INTEGER 精度边界"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["factorial"]' || { echo "FAIL n=18 schema 不严"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 3 精度上界 n=18 PASS"
```

**硬阈值**: `18! === 6402373705728000` 严等；且 `< 9007199254740991`。

---

### Step 4: 上界拒 `n=19` / `n=20` / `n=100` 必返 400 且 body 不含 `factorial`

**可观测行为**: `GET /factorial?n=19`、`n=20`、`n=100` 均返 HTTP 400 + `{"error": "<非空字符串>"}`，body 顶层 keys 严等 `["error"]`，**不含 `factorial` 字段**，且 generator 不得在错误体里放 `factorial: null` 或其他值（防"既报错又给值"混合污染）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3104 node server.js & SPID=$!
sleep 2
for N in 19 20 100; do
  CODE=$(curl -s -o /tmp/r${N}.json -w "%{http_code}" "localhost:3104/factorial?n=${N}")
  [ "$CODE" = "400" ] || { echo "FAIL n=${N} 非 400 实际 $CODE"; kill $SPID; exit 1; }
  jq -e '.error | type == "string"' < /tmp/r${N}.json || { echo "FAIL n=${N} error 非 string"; kill $SPID; exit 1; }
  jq -e '.error | length > 0' < /tmp/r${N}.json || { echo "FAIL n=${N} error 为空"; kill $SPID; exit 1; }
  jq -e 'has("factorial") | not' < /tmp/r${N}.json || { echo "FAIL n=${N} 错误体含 factorial 字段"; kill $SPID; exit 1; }
  jq -e 'keys == ["error"]' < /tmp/r${N}.json || { echo "FAIL n=${N} 错误体 schema 不严"; kill $SPID; exit 1; }
done
kill $SPID
echo "✅ Step 4 上界拒 19/20/100 PASS"
```

**硬阈值**: 三个超界值全 400；body 严等 `{error: "<non-empty>"}`；不含 `factorial`。

---

### Step 5: strict-schema 拒（`^\d+$` 白名单外全 400）

**可观测行为**: 负号 / 小数点 / 前导 `+` / 科学计数法 / 十六进制 / 千分位 / 空串 / 字母串 / `Infinity` / `NaN` / 缺参 全返 400，body 严等 `{error: "<non-empty>"}`，不含 `factorial`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3105 node server.js & SPID=$!
sleep 2
# 缺参（无 query）
CODE=$(curl -s -o /tmp/no.json -w "%{http_code}" "localhost:3105/factorial")
[ "$CODE" = "400" ] || { echo "FAIL 缺参非 400 实际 $CODE"; kill $SPID; exit 1; }
jq -e 'keys == ["error"]' < /tmp/no.json || { echo "FAIL 缺参 schema 不严"; kill $SPID; exit 1; }
jq -e 'has("factorial") | not' < /tmp/no.json || { echo "FAIL 缺参错误体含 factorial"; kill $SPID; exit 1; }

# strict-schema 拒系列 — 必须每条都 400
for Q in "n=-1" "n=-5" "n=5.5" "n=5.0" "n=%2B5" "n=1e2" "n=0xff" "n=1,000" "n=" "n=abc" "n=Infinity" "n=NaN"; do
  CODE=$(curl -s -o /tmp/bad.json -w "%{http_code}" "localhost:3105/factorial?${Q}")
  [ "$CODE" = "400" ] || { echo "FAIL strict 拒 ${Q} 非 400 实际 $CODE"; kill $SPID; exit 1; }
  jq -e '.error | type == "string" and length > 0' < /tmp/bad.json || { echo "FAIL ${Q} error 非空 string"; kill $SPID; exit 1; }
  jq -e 'has("factorial") | not' < /tmp/bad.json || { echo "FAIL ${Q} 错误体含 factorial"; kill $SPID; exit 1; }
done
kill $SPID
echo "✅ Step 5 strict-schema 12 项拒 PASS"
```

**硬阈值**: 12 条非法输入全 400；全部 body 严等 `{error: "<non-empty>"}`；任一含 `factorial` 即 FAIL。

---

### Step 6: **跨调用递推不变量** oracle（W24 核心新增）

**可观测行为**: 对任意 `Number(n) > 0` 且 `Number(n) <= 18` 的合法 n，独立发两次请求 `GET /factorial?n=k` 与 `GET /factorial?n=k-1`，必满足 `factorial(k) === k * factorial(k-1)`。覆盖小值 `k=5` 与精度上界 `k=18` 两端。若 generator 用 Stirling / Lanczos gamma 近似或浮点累积，必被抓。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3106 node server.js & SPID=$!
sleep 2
# k=5 递推: f(5) === 5 * f(4) === 120 === 5 * 24
F5=$(curl -fs "localhost:3106/factorial?n=5" | jq '.factorial')
F4=$(curl -fs "localhost:3106/factorial?n=4" | jq '.factorial')
[ -n "$F5" ] && [ -n "$F4" ] || { echo "FAIL 抓不到 f(5)/f(4) 响应"; kill $SPID; exit 1; }
EXPECTED5=$(( 5 * F4 ))
[ "$F5" = "$EXPECTED5" ] || { echo "FAIL 递推 f(5)=${F5} != 5*f(4)=${EXPECTED5}"; kill $SPID; exit 1; }

# k=10 递推: f(10) === 10 * f(9)
F10=$(curl -fs "localhost:3106/factorial?n=10" | jq '.factorial')
F9=$(curl -fs "localhost:3106/factorial?n=9" | jq '.factorial')
EXPECTED10=$(( 10 * F9 ))
[ "$F10" = "$EXPECTED10" ] || { echo "FAIL 递推 f(10)=${F10} != 10*f(9)=${EXPECTED10}"; kill $SPID; exit 1; }

# k=18 精度上界递推: f(18) === 18 * f(17)（精确整数关系，浮点近似实现必断）
F18=$(curl -fs "localhost:3106/factorial?n=18" | jq '.factorial')
F17=$(curl -fs "localhost:3106/factorial?n=17" | jq '.factorial')
EXPECTED18=$(( 18 * F17 ))
[ "$F18" = "$EXPECTED18" ] || { echo "FAIL 递推上界 f(18)=${F18} != 18*f(17)=${EXPECTED18}"; kill $SPID; exit 1; }

# k=1 递推: f(1) === 1 * f(0)（边界递推，1!=1=1*1）
F1=$(curl -fs "localhost:3106/factorial?n=1" | jq '.factorial')
F0=$(curl -fs "localhost:3106/factorial?n=0" | jq '.factorial')
EXPECTED1=$(( 1 * F0 ))
[ "$F1" = "$EXPECTED1" ] || { echo "FAIL 边界递推 f(1)=${F1} != 1*f(0)=${EXPECTED1}"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 6 跨调用递推不变量（k=1/5/10/18）PASS"
```

**硬阈值**: 4 个 k 值递推关系全严等；用 shell 整数算术（`$(( ))`）做精确比对，避免浮点干扰；不严等即 FAIL。

---

### Step 7: query 参数名锁死 `n`，禁用别名一律拒

**可观测行为**: 用 `value` / `num` / `input` / `x` / `a` 等任何别名代替 `n` → endpoint 应进入"缺 n" 分支返 400（缺参分支），body 不含 `factorial`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3107 node server.js & SPID=$!
sleep 2
for ALIAS in value num input x a number int integer val v count size; do
  CODE=$(curl -s -o /tmp/alias.json -w "%{http_code}" "localhost:3107/factorial?${ALIAS}=5")
  [ "$CODE" = "400" ] || { echo "FAIL 别名 ${ALIAS} 没被拒 实际 $CODE"; kill $SPID; exit 1; }
  jq -e 'has("factorial") | not' < /tmp/alias.json || { echo "FAIL 别名 ${ALIAS} 错误体含 factorial"; kill $SPID; exit 1; }
done
kill $SPID
echo "✅ Step 7 query 别名锁死 PASS"
```

**硬阈值**: 12 个别名全 400；任一返 200 或 body 含 `factorial` 即 FAIL。

---

### Step 8: 前导 0 strict 通过且等价 happy（`n=05` ↔ `n=5`）

**可观测行为**: `GET /factorial?n=05` → 200 + `{factorial: 120}`（`^\d+$` 允许前导 0，且 `Number("05") === 5`）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3108 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3108/factorial?n=05")
echo "$RESP" | jq -e '.factorial == 120' || { echo "FAIL n=05 不等价 n=5 实际=$RESP"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["factorial"]' || { echo "FAIL n=05 schema 不严"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 8 前导 0 等价 PASS"
```

**硬阈值**: `n=05` 与 `n=5` 严等 120。

---

### Step 9: 现有 6 条路由回归无损

**可观测行为**: `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo` 每条至少 1 个 happy 仍返预期响应。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3109 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3109/health" | jq -e '.ok == true' || { echo "FAIL /health 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3109/sum?a=2&b=3" | jq -e '.sum == 5' || { echo "FAIL /sum 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3109/multiply?a=2&b=3" | jq -e '.product == 6' || { echo "FAIL /multiply 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3109/divide?a=6&b=2" | jq -e '.quotient == 3' || { echo "FAIL /divide 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3109/power?a=2&b=10" | jq -e '.power == 1024' || { echo "FAIL /power 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3109/modulo?a=10&b=3" | jq -e '.remainder == 1' || { echo "FAIL /modulo 回归"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 9 旧 6 路由回归 PASS"
```

**硬阈值**: 6 条路由 happy 全过；任一断裂即 FAIL。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:

```bash
#!/bin/bash
set -e

cd playground
npm install --silent 2>&1 | tail -5

# 起服务（避免端口冲突）
PORT=3199
PLAYGROUND_PORT=$PORT node server.js & SPID=$!
sleep 2

# E2E-1. happy 中段
RESP=$(curl -fs "localhost:$PORT/factorial?n=5")
echo "$RESP" | jq -e '.factorial == 120' || { echo "FAIL E2E-1"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["factorial"]' || { echo "FAIL E2E-1 schema"; kill $SPID; exit 1; }

# E2E-2. 数学边界 0!=1!=1
curl -fs "localhost:$PORT/factorial?n=0" | jq -e '.factorial == 1' || { echo "FAIL E2E-2a 0!=1"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/factorial?n=1" | jq -e '.factorial == 1' || { echo "FAIL E2E-2b 1!=1"; kill $SPID; exit 1; }

# E2E-3. 精度上界 n=18
curl -fs "localhost:$PORT/factorial?n=18" | jq -e '.factorial == 6402373705728000' || { echo "FAIL E2E-3 18!"; kill $SPID; exit 1; }

# E2E-4. 上界拒 19/20/100
for N in 19 20 100; do
  CODE=$(curl -s -o /tmp/e4.json -w "%{http_code}" "localhost:$PORT/factorial?n=$N")
  [ "$CODE" = "400" ] || { echo "FAIL E2E-4 n=$N 非 400"; kill $SPID; exit 1; }
  jq -e 'has("factorial") | not' < /tmp/e4.json || { echo "FAIL E2E-4 n=$N 错误体含 factorial"; kill $SPID; exit 1; }
done

# E2E-5. strict-schema 拒系列
for Q in "n=-1" "n=5.5" "n=%2B5" "n=1e2" "n=0xff" "n=abc" "n=" "n=Infinity"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:$PORT/factorial?$Q")
  [ "$CODE" = "400" ] || { echo "FAIL E2E-5 strict $Q 非 400 实际 $CODE"; kill $SPID; exit 1; }
done

# E2E-6. 跨调用递推不变量（W24 核心 oracle）
F5=$(curl -fs "localhost:$PORT/factorial?n=5" | jq '.factorial')
F4=$(curl -fs "localhost:$PORT/factorial?n=4" | jq '.factorial')
[ "$F5" = "$(( 5 * F4 ))" ] || { echo "FAIL E2E-6a 递推 f(5)!=5*f(4)"; kill $SPID; exit 1; }
F18=$(curl -fs "localhost:$PORT/factorial?n=18" | jq '.factorial')
F17=$(curl -fs "localhost:$PORT/factorial?n=17" | jq '.factorial')
[ "$F18" = "$(( 18 * F17 ))" ] || { echo "FAIL E2E-6b 递推 f(18)!=18*f(17)"; kill $SPID; exit 1; }

# E2E-7. query 名锁死
CODE=$(curl -s -o /tmp/e7.json -w "%{http_code}" "localhost:$PORT/factorial?value=5")
[ "$CODE" = "400" ] || { echo "FAIL E2E-7 别名 value 未拒"; kill $SPID; exit 1; }
jq -e 'has("factorial") | not' < /tmp/e7.json || { echo "FAIL E2E-7 别名错误体含 factorial"; kill $SPID; exit 1; }

# E2E-8. 前导 0 等价
curl -fs "localhost:$PORT/factorial?n=05" | jq -e '.factorial == 120' || { echo "FAIL E2E-8 n=05"; kill $SPID; exit 1; }

# E2E-9. 旧 6 路由回归
curl -fs "localhost:$PORT/health" | jq -e '.ok == true' || { echo "FAIL E2E-9 /health"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/sum?a=2&b=3" | jq -e '.sum == 5' || { echo "FAIL E2E-9 /sum"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/multiply?a=2&b=3" | jq -e '.product == 6' || { echo "FAIL E2E-9 /multiply"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/divide?a=6&b=2" | jq -e '.quotient == 3' || { echo "FAIL E2E-9 /divide"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/power?a=2&b=10" | jq -e '.power == 1024' || { echo "FAIL E2E-9 /power"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/modulo?a=10&b=3" | jq -e '.remainder == 1' || { echo "FAIL E2E-9 /modulo"; kill $SPID; exit 1; }

# E2E-10. vitest 全套（确保 generator 的辅助单测也过）
NODE_ENV=test npx vitest run --reporter=verbose 2>&1 | tail -20

kill $SPID
echo "✅ Golden Path 9 段 + vitest 全过"
```

**通过标准**: 脚本 `exit 0`。

---

## Response Schema codify（jq -e 完整命令矩阵）

| PRD 段 | 合同必须有的 jq -e 命令 | 覆盖 Step |
|---|---|---|
| Success 字段 `factorial (number)` | `jq -e '.factorial \| type == "number"'` | Step 1 |
| Success 字段值（n=5） | `jq -e '.factorial == 120'` | Step 1 |
| Success 字段值（n=0 数学边界） | `jq -e '.factorial == 1'` | Step 2 |
| Success 字段值（n=1 数学边界） | `jq -e '.factorial == 1'` | Step 2 |
| Success 字段值（n=18 精度边界） | `jq -e '.factorial == 6402373705728000'` | Step 3 |
| Success Schema 完整性 | `jq -e 'keys == ["factorial"]'` | Step 1/2/3/8 |
| Success 禁 result 字段 | `jq -e 'has("result") \| not'` | Step 1 |
| Success 禁 value 字段 | `jq -e 'has("value") \| not'` | Step 1 |
| Success 禁 product 字段（W20 复用防漂） | `jq -e 'has("product") \| not'` | Step 1 |
| Success 禁 fact 字段 | `jq -e 'has("fact") \| not'` | Step 1 |
| Error 字段 `error (string, non-empty)` | `jq -e '.error \| type == "string" and length > 0'` | Step 4/5 |
| Error Schema 完整性 | `jq -e 'keys == ["error"]'` | Step 4 |
| Error body 不含 `factorial` | `jq -e 'has("factorial") \| not'` | Step 4/5/7 |
| 上界拒 n=19 → 400 | `curl -w "%{http_code}"` 比 `400` | Step 4 |
| **跨调用递推 f(n)===n*f(n-1)** | shell 整数算术 `[ "$F5" = "$(( 5 * F4 ))" ]` | Step 6 |
| query 名锁死 n | `?value=5` → 400 + 不含 factorial | Step 7 |

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 GET /factorial（server + tests + README，含跨调用递推 oracle）

**范围**:
- `playground/server.js`：在 `/modulo` 路由之后、`app.listen` 之前新增 `GET /factorial`。strict-schema 用**新的** `^\d+$`（**禁止**复用既有 `STRICT_NUMBER`）；判定顺序 = 缺参 → strict regex → `Number(n) > 18` 上界拒 → 迭代 `for(i=2; i<=Number(n); i++)` 累积复算 → 200 返 `{factorial: result}`。
- `playground/tests/server.test.js`：新增 `describe('GET /factorial')` 块（与 `/sum`/`/multiply`/`/divide`/`/power`/`/modulo` describe 平级），覆盖 happy 7+（含 n=0/1/2/5/10/12/18）、上界拒 3+（n=19/20/100）、strict 拒 8+、值 oracle 3+（含 n=18 严等 6402373705728000）、**跨调用递推 oracle 2+**（k=5 与 k=18，supertest 同 `it()` 内两次 `await request(app).get()` 之后 `expect(body_k.factorial === k * body_{k-1}.factorial)`）、schema oracle 2+、错误体不含 factorial 1+、错误体 keys 严等 ["error"] 1+、回归断言 6+。
- `playground/README.md`：端点列表加 `/factorial`，给出 happy（含 n=0 边界）、上界拒（n=19）、strict 拒、跨调用递推 各示例 ≥ 1。
- 不引入新依赖；不引入 BigInt；不引入 `Number.isFinite` 兜底；不动旧 6 路由一个字符。

**大小**: M（server ≈ 12 行，tests ≈ 100+ 行含递推用例，README ≈ 30+ 行）。

**依赖**: 无（playground 子项目独立）。

**BEHAVIOR 覆盖测试文件**: `tests/ws1/factorial.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/factorial.test.ts` | happy 中段 / 数学边界 0!=1!=1 / 精度上界 n=18 / 上界拒 19+/strict-schema 拒 / **跨调用递推** k=5 + k=18 / schema 完整 / 错误体不含 factorial / query 别名锁 / 前导 0 等价 / 旧路由回归 | 当前 server.js **不含** `/factorial` 路由 → 所有 happy / 递推 / 边界用例返 404 而非 200 → vitest FAIL ≥ 12 条 |
