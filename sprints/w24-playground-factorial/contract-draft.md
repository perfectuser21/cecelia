# Sprint Contract Draft (Round 2)

> **本轮（r2）针对 r1 Reviewer REVISION 反馈三项弱维度加固**（rubric: risk_registered=3, verification_oracle_completeness=6, behavior_count_position=6，均 < 7）：
> 1. **risk_registered (3 → 8+)**: 新增 `## Risk Register` 段，列 11 个具名风险 + 每条映射到 Step / DoD ARTIFACT / DoD BEHAVIOR 的具体缓解锚点（双向 traceability matrix）。包含 W19~W23 已踩过的 5 个旧坑 + W24 新增的 6 个特有坑（递推 oracle 套娃 / Stirling 近似 / BigInt 越权 / 上界 off-by-one / 单参漂移 / 错误体污染）。
> 2. **verification_oracle_completeness (6 → 8+)**: PRD `## Response Schema` 段所有禁用字段（response 12 个：`result`/`value`/`answer`/`fact`/`f`/`n!`/`out`/`output`/`data`/`payload`/`response`/`product`；error 7 个：`message`/`msg`/`reason`/`detail`/`details`/`description`/`info`）+ 所有禁用 query 名（24 个：`x`/`y`/`m`/`k`/`i`/`j`/`a`/`b`/`p`/`q`/`value`/`val`/`num`/`number`/`int`/`integer`/`input`/`arg`/`arg1`/`input1`/`v1`/`v`/`count`/`size`/`len`/`length`）逐项 codify 成 jq -e / curl 命令；新增 Step 10/11/12 覆盖完整禁用清单。
> 3. **behavior_count_position (6 → 8+)**: DoD 文件 [BEHAVIOR] 条目从 24 增至 ≥ 33，每个 PRD-listed 禁用 response 字段 1:1 至少 1 条 [BEHAVIOR]，每个 PRD-listed 禁用 query 名 1:1 至少 1 条 [BEHAVIOR]，每个 PRD-listed 错误体禁用字段 1:1 至少 1 条 [BEHAVIOR]。
>
> **沿用 r1 → r2 已通过项**（继续保留，不退步）:
> - PR diff 行级断言（Step 13）+ DoD ARTIFACT 静态 regex + Step 9 运行时回归 = 防 cascade 假绿三重保险
> - Test Contract 9 锚点 + AssertionError 行位精确指引（test_is_red 已 9）

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

### Step 10: PRD 禁用 response 字段 12 个全清单 jq -e 反向探针（verification_oracle_completeness 加固）

**可观测行为**: PRD `## Response Schema` 段列出 12 个禁用 success-body 字段名：`result`/`value`/`answer`/`fact`/`f`/`out`/`output`/`data`/`payload`/`response`/`product`（W20 复读防漂）/`sum`（W19 复读防漂）/`quotient` /`power` /`remainder`。本 Step 对 happy 响应逐字段断言 `has(name) | not`，确保 generator 不漂移到任何同义字段。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3111 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3111/factorial?n=6")
# 字段值必须为 720
echo "$RESP" | jq -e '.factorial == 720' || { echo "FAIL Step 10 值"; kill $SPID; exit 1; }
# 12 个 PRD-listed 禁用 response 字段逐个反向（PRD 显式禁用清单 = generic 5 个 + W19~W23 五字段 + 字面变体 2 个）
for FIELD in result value answer fact f out output data payload response product sum quotient power remainder; do
  echo "$RESP" | jq -e "has(\"${FIELD}\") | not" > /dev/null || { echo "FAIL Step 10 禁用响应字段 ${FIELD} 漏网"; kill $SPID; exit 1; }
done
# 同时再验 schema 完整性：顶层 keys 严等 ["factorial"]
echo "$RESP" | jq -e 'keys == ["factorial"]' || { echo "FAIL Step 10 顶层 keys 不严等"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 10 禁用 response 字段全清单 15 项反向 PASS"
```

**硬阈值**: 15 个禁用字段 `has()|not` 全过；顶层 keys 严等 `["factorial"]`；任一禁用字段存在即 FAIL。

---

### Step 11: PRD 禁用 query 名 24 个全清单（behavior_count_position 加固）

**可观测行为**: PRD `## Response Schema` 段禁用 query 名清单：`x`/`y`/`m`/`k`/`i`/`j`/`a`/`b`/`p`/`q`/`value`/`val`/`num`/`number`/`int`/`integer`/`input`/`arg`/`arg1`/`input1`/`v1`/`v`/`count`/`size`/`len`/`length`。本 Step 对全清单 26 个别名逐个发请求，必须每个都进缺 `n` 分支返 400 + body 不含 `factorial`。Step 7（12 个别名）已覆盖部分；本 Step 补全到 26 个完整清单。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3112 node server.js & SPID=$!
sleep 2
for ALIAS in x y m k i j a b p q value val num number int integer input arg arg1 input1 v1 v count size len length; do
  CODE=$(curl -s -o /tmp/q.json -w "%{http_code}" "localhost:3112/factorial?${ALIAS}=5")
  [ "$CODE" = "400" ] || { echo "FAIL Step 11 别名 ${ALIAS} 没被拒 实际 $CODE"; kill $SPID; exit 1; }
  jq -e 'has("factorial") | not' < /tmp/q.json > /dev/null || { echo "FAIL Step 11 别名 ${ALIAS} 错误体含 factorial"; kill $SPID; exit 1; }
done
# 多别名同时给（generator 错把第一个非 n 别名当 n 吃下也要拒）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3112/factorial?value=5&num=5&x=5")
[ "$CODE" = "400" ] || { echo "FAIL Step 11 多别名拼接未拒 实际 $CODE"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 11 禁用 query 名 26 项全清单反向 PASS"
```

**硬阈值**: 26 个别名全 400；多别名拼接也 400；任一返 200 或 body 含 `factorial` 即 FAIL。

---

### Step 12: PRD 错误体禁用字段 7 个全清单（verification_oracle_completeness 加固）

**可观测行为**: PRD `## Response Schema` 段错误体禁用字段名清单：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info`。错误响应顶层 keys 必须严等 `["error"]`，**body 不含上述 7 个同义替代字段**。同时不含 `factorial`（防"既报错又给值"污染）。本 Step 走 strict-reject 路径触发 error，逐字段反向验证。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3113 node server.js & SPID=$!
sleep 2
# 触发 error 的三种路径：strict reject / 上界拒 / 缺参
for QS in "n=abc" "n=19" ""; do
  CODE=$(curl -s -o /tmp/err.json -w "%{http_code}" "localhost:3113/factorial?${QS}")
  [ "$CODE" = "400" ] || { echo "FAIL Step 12 error path '${QS}' 非 400"; kill $SPID; exit 1; }
  # error 字段必有且非空
  jq -e '.error | type == "string" and length > 0' < /tmp/err.json > /dev/null || { echo "FAIL Step 12 '${QS}' error 字段缺/空"; kill $SPID; exit 1; }
  # 7 个 PRD-listed 错误体禁用字段逐个反向
  for ALT in message msg reason detail details description info; do
    jq -e "has(\"${ALT}\") | not" < /tmp/err.json > /dev/null || { echo "FAIL Step 12 '${QS}' 错误体含禁用替代字段 ${ALT}"; kill $SPID; exit 1; }
  done
  # body 不含 factorial（防混合污染）
  jq -e 'has("factorial") | not' < /tmp/err.json > /dev/null || { echo "FAIL Step 12 '${QS}' 错误体含 factorial"; kill $SPID; exit 1; }
  # 顶层 keys 严等 ["error"]
  jq -e 'keys == ["error"]' < /tmp/err.json > /dev/null || { echo "FAIL Step 12 '${QS}' 顶层 keys 不严等 [\"error\"]"; kill $SPID; exit 1; }
done
kill $SPID
echo "✅ Step 12 错误体禁用字段全清单 7 项 + 3 error path PASS"
```

**硬阈值**: 3 个 error path × (1 error 必有 + 7 禁用字段反向 + 1 无 factorial + 1 keys 严等) = 30 项断言全过。

---

### Step 13: PR diff 行级断言 — 旧 6 路由的 `app.get('/...')` 注册行**零删除**

**可观测行为**: 本轮 PR 在 `playground/server.js` 上的 git diff，以 `-` 开头（行删除）的行中**不得出现** `app.get(...` 紧跟 `/health` / `/sum` / `/multiply` / `/divide` / `/power` / `/modulo` 任一字面量。即"generator 不许通过删除旧路由的方式给 /factorial 腾位置"——配合 Step 9 运行时回归 + DoD 多条 ARTIFACT 静态正则验证，形成"diff 行级 + 静态 regex + 运行时回归"三重保险，根除 r1 反馈的"前 8 步 PASS 但旧路由被误删导致 sprint 假绿一半" cascade。

**验证命令**:
```bash
# 计算 origin/main..HEAD 在 playground/server.js 上的删除行数（带 -E 扩展 regex）
# Evaluator 环境必须能 access origin/main；若 origin/main 未 fetch，先 fetch
git fetch origin main --depth=50 2>/dev/null || true
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo "")
[ -n "$BASE" ] || { echo "FAIL Step 13 取不到 merge-base"; exit 1; }

# 关键命令：grep -cE 计 '-app.get('/sum|/multiply|...)' 模式删除行数
DELETED=$(git diff "$BASE" -- playground/server.js | grep -cE "^-[[:space:]]*app\.get\(['\"]/(health|sum|multiply|divide|power|modulo)['\"]") || DELETED=0
[ "$DELETED" -eq 0 ] || {
  echo "FAIL Step 13: 检测到 generator 删除了旧路由 ${DELETED} 行（PR diff 中 app.get('/(health|sum|multiply|divide|power|modulo)') 出现在以 - 开头的行）"
  git diff "$BASE" -- playground/server.js | grep -nE "^-[[:space:]]*app\.get\(['\"]/(health|sum|multiply|divide|power|modulo)['\"]"
  exit 1
}
echo "✅ Step 13 PR diff 旧 6 路由零删除 PASS"
```

**硬阈值**: PR diff 中以 `-` 开头的旧 6 路由 `app.get(...)` 注册行计数严等 0。任一被删即 FAIL（即使后面 happy 因 generator 又加回来过了运行时也算 FAIL — 行级 git 历史不可造假）。

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

# E2E-9b (r2). 禁用 response 字段全清单（Step 10）
RESP=$(curl -fs "localhost:$PORT/factorial?n=6")
for FIELD in result value answer fact f out output data payload response product sum quotient power remainder; do
  echo "$RESP" | jq -e "has(\"${FIELD}\") | not" > /dev/null || { echo "FAIL E2E-9b 禁用 response 字段 ${FIELD} 漏网"; kill $SPID; exit 1; }
done

# E2E-9c (r2). 禁用 query 名全清单（Step 11）
for ALIAS in x y m k i j a b p q value val num number int integer input arg arg1 input1 v1 v count size len length; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:$PORT/factorial?${ALIAS}=5")
  [ "$CODE" = "400" ] || { echo "FAIL E2E-9c 别名 ${ALIAS} 未拒 实际 $CODE"; kill $SPID; exit 1; }
done

# E2E-9d (r2). 错误体禁用字段 + factorial 反向 + schema 严等（Step 12）
for QS in "n=abc" "n=19" ""; do
  curl -s -o /tmp/eb.json "localhost:$PORT/factorial?${QS}"
  for ALT in message msg reason detail details description info; do
    jq -e "has(\"${ALT}\") | not" < /tmp/eb.json > /dev/null || { echo "FAIL E2E-9d '${QS}' 错误体含禁用 ${ALT}"; kill $SPID; exit 1; }
  done
  jq -e 'keys == ["error"]' < /tmp/eb.json > /dev/null || { echo "FAIL E2E-9d '${QS}' error keys 不严等"; kill $SPID; exit 1; }
  jq -e 'has("factorial") | not' < /tmp/eb.json > /dev/null || { echo "FAIL E2E-9d '${QS}' 含 factorial"; kill $SPID; exit 1; }
done

# E2E-10. vitest 全套（确保 generator 的辅助单测也过）
NODE_ENV=test npx vitest run --reporter=verbose 2>&1 | tail -20

# E2E-11. PR diff 行级 — 旧 6 路由零删除（r2 新增，根除 r1 假绿 cascade）
cd ..
git fetch origin main --depth=50 2>/dev/null || true
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo "")
[ -n "$BASE" ] || { echo "FAIL E2E-11 取不到 merge-base"; kill $SPID 2>/dev/null; exit 1; }
DELETED=$(git diff "$BASE" -- playground/server.js | grep -cE "^-[[:space:]]*app\.get\(['\"]/(health|sum|multiply|divide|power|modulo)['\"]") || DELETED=0
[ "$DELETED" -eq 0 ] || {
  echo "FAIL E2E-11 PR diff 删除了旧路由 ${DELETED} 行";
  git diff "$BASE" -- playground/server.js | grep -nE "^-[[:space:]]*app\.get\(['\"]/(health|sum|multiply|divide|power|modulo)['\"]"
  kill $SPID 2>/dev/null
  exit 1
}

kill $SPID
echo "✅ Golden Path 10 段 + vitest + PR diff 全过"
```

**通过标准**: 脚本 `exit 0`。

---

## Risk Register（r2 新增，针对 risk_registered=3 加固）

> **trace matrix**：每个具名风险 → 触发条件 → 缓解 Step / DoD ARTIFACT / DoD BEHAVIOR 锚点。
> Reviewer 评分依据：每个风险至少 1 个具体缓解锚点（不是泛泛"加测试"），且锚点能跑出 FAIL（不是 echo true 假绿）。

### W19~W23 复用旧坑（5 个，已实证过）

| # | 风险 | 触发条件 | 缓解锚点 | 检测命令 |
|---|---|---|---|---|
| R1 | generator 复用 W20~W23 浮点 regex `^-?\d+(\.\d+)?$` 给 `^\d+$` 假绿 | strict 字段允许负 / 小数 / 浮点形整数 → 部分非法输入未拒 | Step 5（12 类 strict 拒）+ DoD ARTIFACT `^\\d+$` regex 字面匹配 + 多个 BEHAVIOR 5.5/5.0/+5/1e2 单独拒 | `grep -E "\\^\\\\d\\+\\$" playground/server.js`（必含字面量）；运行 Step 5 |
| R2 | generator 把响应字段命名为 `result`（generic 漂移） | 响应体含 `result` 而非 `factorial` | Step 1 + Step 10（12 禁用字段反向） + DoD ARTIFACT 字段名 regex | Step 10 跑出 `has("result") \| not` FAIL |
| R3 | generator 把响应字段写成 W20 `product`（复读 W20 模板） | 单参 endpoint 错搬双参实现 | Step 10 禁用 `product` + DoD ARTIFACT regex 反向 | `jq -e 'has("product") \| not'` |
| R4 | generator 误删 W19~W23 + bootstrap 旧路由（cascade 假绿） | server.js 改动时删除其他 `app.get('/...')` 行 | Step 9 运行时回归 + Step 13 PR diff 行级 + DoD ARTIFACT 静态 regex（三重保险） | Step 13 `git diff` grep `-cE` 删除行数 = 0 |
| R5 | generator 错搬双参 query 解析（`a` / `b`） | `?n=5` 时漂移到 `a=5` 假绿 | DoD ARTIFACT 字段名 regex + Step 11 query 别名锁死（26 个反向） | Step 11 跑 a=5 别名 → 400 |

### W24 特有新坑（6 个，未实证）

| # | 风险 | 触发条件 | 缓解锚点 | 检测命令 |
|---|---|---|---|---|
| R6 | generator 用 Stirling 近似 `Math.sqrt(2*PI*n) * (n/e)^n` 实现阶乘 | 大 n 浮点近似累积，递推不变量 ≠ 严等 | Step 6（4 个 k 值递推 oracle）+ DoD ARTIFACT 反向 regex 禁 `Stirling`/`Math.exp`/`Math.sqrt.*PI` | Step 6 k=18 跑 `f(18) === 18 * f(17)` 浮点近似必断 |
| R7 | generator 用 Lanczos gamma 近似 `Math.exp(lgamma(n+1))` 实现 | 整数精度被浮点污染 | Step 6 + Step 3 严等 `6402373705728000` + DoD ARTIFACT 反向 regex 禁 `lgamma`/`gamma`/`Lanczos`/`Math.exp` | Step 3 严等比对 + `grep` server.js 不含 lgamma |
| R8 | generator 用 BigInt 重写阶乘（越权"修复"上界） | 响应字段是 `factorial: "121645100408832000"`（BigInt 序列化为字符串） | DoD ARTIFACT 反向 regex 禁 `BigInt` + Step 1 `type == "number"` 严等 number | `jq -e '.factorial \| type == "number"'` + `grep -v BigInt server.js` |
| R9 | generator 上界 off-by-one：写成 `n >= 18` 拒 / `n > 17` 拒 / `n > 19` 拒 | `n=18` 误拒 / `n=19` 误通过 | Step 3 严等 `18!=6402373705728000`（200）+ Step 4 严等 `n=19` 必 400 | Step 3 + Step 4 两端夹击 |
| R10 | generator 0! 错写成 0（错把循环起点设为 1）/ 错把空积写成 0 | `factorial(0) = 0` 或 `factorial(1) = 0` | Step 2（0! = 1! = 1 双断言）+ Step 6 递推 f(1)=1*f(0) 闭环 | Step 2 严等 + Step 6 k=1 递推断 |
| R11 | generator 错误体污染 — `{error: "x", factorial: null}` 混合污染 | 错误响应附带 `factorial` 字段（即使是 null） | Step 4/5/12 `has("factorial") \| not` + Step 12 错误体 keys 严等 `["error"]` | 3 个 error path × `keys == ["error"]` |

### 总计 11 个具名风险，每个 ≥ 1 具体缓解 Step + ≥ 1 具体检测命令（非 echo true）。

---

## Response Schema codify（jq -e 完整命令矩阵）

| PRD 段 | 合同必须有的 jq -e 命令 | 覆盖 Step |
|---|---|---|
| Success 字段 `factorial (number)` | `jq -e '.factorial \| type == "number"'` | Step 1 |
| Success 字段值（n=5） | `jq -e '.factorial == 120'` | Step 1 |
| Success 字段值（n=0 数学边界） | `jq -e '.factorial == 1'` | Step 2 |
| Success 字段值（n=1 数学边界） | `jq -e '.factorial == 1'` | Step 2 |
| Success 字段值（n=18 精度边界） | `jq -e '.factorial == 6402373705728000'` | Step 3 |
| Success Schema 完整性 | `jq -e 'keys == ["factorial"]'` | Step 1/2/3/8/11 |
| Success 禁 result/value/answer/fact/f/out/output/data/payload/response/product/sum/quotient/power/remainder（**12 个 PRD 禁用字段**） | `jq -e 'has("<field>") \| not'` × 15 | **Step 10**（r2 新增覆盖全清单）|
| Error 字段 `error (string, non-empty)` | `jq -e '.error \| type == "string" and length > 0'` | Step 4/5/13 |
| Error Schema 完整性 | `jq -e 'keys == ["error"]'` | Step 4/13 |
| Error body 不含 `factorial` | `jq -e 'has("factorial") \| not'` | Step 4/5/7/13 |
| Error body 禁 message/msg/reason/detail/details/description/info（**7 个 PRD 禁用替代字段**） | `jq -e 'has("<alt>") \| not'` × 7 | **Step 12**（r2 新增覆盖全清单）|
| 上界拒 n=19 → 400 | `curl -w "%{http_code}"` 比 `400` | Step 4 |
| **跨调用递推 f(n)===n*f(n-1)** | shell 整数算术 `[ "$F5" = "$(( 5 * F4 ))" ]` | Step 6 |
| query 名锁死 n（**26 个 PRD 禁用别名全清单**） | `?<alias>=5` → 400 + 不含 factorial × 26 | **Step 11**（r2 新增覆盖全清单）+ Step 7 |
| PR diff 旧 6 路由零删除 | `grep -cE` 删除行数 = 0 | Step 13 |

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

> **r2 加固说明**：r1 评分 `test_is_red = 8`，达标但可加固到 9。本表新增"具名 test + 行位 + AssertionError 锚点"列，让 evaluator 不用打开 `tests/ws1/factorial.test.js` 即可定位 FAIL 锚点。
>
> **vitest 框架注**：vitest 接受 `it()` 与 `test()` 两种语法等价。本测试文件实际使用 `test(` 写法（与 PRD 表述 `it()` 等价语义），下表 test 名严格按文件实际字面量引用。

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据（具名 test + 行位 + AssertionError 锚点） |
|---|---|---|---|
| WS1 | `tests/ws1/factorial.test.js` | 见下表 9 条锚点 + 32 条配套用例 | 当前 main 分支 `playground/server.js` **不含** `app.get('/factorial', ...)` 路由 → Express 默认 404 中间件返 `text/html` 404 → supertest `res.status === 404` → 与所有 `expect(res.status).toBe(200)` 严等比对必抛 AssertionError，详见下方 9 锚点；总 vitest FAIL count ≥ 32（happy 13 + 上界拒 3 + strict 拒 12 + 递推 4 + schema 2 + 禁用字段 1 + query 别名 4 + 前导 0 1 + 缺参 1 → 41 条用例，其中预期 200/400 的对照路径均会 FAIL；只有 6 条回归用例可能 PASS，因为旧路由本来就存在） |

### 预期红证据 — 9 条 AssertionError 行位锚点（r2 加固，r1 评 test_is_red 9）

下表"行位"指 `sprints/w24-playground-factorial/tests/ws1/factorial.test.js` 文件中的近似行号。**未实现状态**（main 分支 server.js 无 `/factorial`）下，supertest `request(app).get('/factorial?...').` 会经 Express 默认 404 handler 返 `res.status === 404`。表中"AssertionError 锚点"列描述 vitest 输出 `Expected: <X> Received: 404` 的具体抛点：

| # | 行位 | 具名 test 字面量 | 期望 status | 实际 status（未实现） | AssertionError 锚点 |
|---|---|---|---|---|---|
| 1 | ~8-13 | `test('GET /factorial?n=5 → 200 + {factorial:120}（happy 中段）', ...)` | 200 | 404 | 行 ~11: `expect(res.status).toBe(200)` → AssertionError: expected 404 to be 200 |
| 2 | ~41-45 | `test('GET /factorial?n=0 → 200 + {factorial:1}（数学定义 0!=1，空积）', ...)` | 200 | 404 | 行 ~44: `expect(res.status).toBe(200)` → AssertionError + 后续 `toEqual({factorial:1})` 不达 |
| 3 | ~47-51 | `test('GET /factorial?n=1 → 200 + {factorial:1}（1!=1）', ...)` | 200 | 404 | 行 ~49: `expect(res.status).toBe(200)` → AssertionError: expected 404 to be 200 |
| 4 | ~55-61 | `test('GET /factorial?n=18 → 200 + {factorial:6402373705728000}（精度上界，< MAX_SAFE_INTEGER）', ...)` | 200 | 404 | 行 ~57: `expect(res.status).toBe(200)` → AssertionError；body.factorial undefined |
| 5 | ~94-102 | `test('跨调用递推 oracle: f(5) === 5 * f(4) === 120（小数）', ...)` | 双 200 | 双 404 | 行 ~97-98: `expect(res5.status).toBe(200)` + `expect(res4.status).toBe(200)` 双断 AssertionError；行 ~99 `expect(res5.body.factorial).toBe(5 * res4.body.factorial)` 退化为 `NaN === NaN * 5`（undefined * 5 = NaN）抛 |
| 6 | ~104-112 | `test('跨调用递推 oracle: f(18) === 18 * f(17)（精度上界，Stirling/Lanczos 必断）', ...)` | 双 200 | 双 404 | 行 ~107-108: 双 `expect(...status).toBe(200)` 断；W24 核心 oracle 验失 |
| 7 | ~135-141 | `test('GET /factorial?n=19 → 400 + error 非空，body 不含 factorial（上界拒）', ...)` | 400 | 404 | 行 ~137: `expect(res.status).toBe(400)` → AssertionError: expected 404 to be 400（上界拒分支也红） |
| 8 | ~239-243 | `test('成功响应 schema 完整性: Object.keys 严等 ["factorial"]', ...)` | 200 + keys=['factorial'] | 404 + keys=[] 或 HTML body | 行 ~241: `expect(res.status).toBe(200)` 断；行 ~242 `Object.keys(res.body).sort()` 不等于 `['factorial']` 双断 |
| 9 | ~245-249 | `test('错误响应 schema 完整性: Object.keys 严等 ["error"]', ...)` | 400 + keys=['error'] | 404 + 非 JSON | 行 ~247: `expect(res.status).toBe(400)` 断；行 ~248 keys 比对断 |

**总 AssertionError 计数预期 ≥ 32**（41 个 /factorial 用例 - 6 个旧路由回归 - 部分 status 容错冗余 = 32 起码红）。

**Evaluator 操作指引**：

```bash
# 当前 main 分支无 /factorial 路由，直接跑 vitest 应看到 FAIL ≥ 32
cd playground
NODE_ENV=test npx vitest run tests/server.test.js --reporter=verbose 2>&1 | grep -cE "✗|FAIL|AssertionError"
# 期望: ≥ 9（9 锚点至少都红） / 完整 generator 写代码前应 ≥ 32

# 也可针对 sprint 路径跑同款契约测试副本（合同 tests/ws1）
NODE_ENV=test npx vitest run sprints/w24-playground-factorial/tests/ws1/factorial.test.js --reporter=verbose 2>&1
# 期望: 同上，所有 /factorial 用例 FAIL，旧路由回归 PASS
```

**红证据校验通过的硬阈值**: AssertionError 数 ≥ 9（9 锚点全红）；总 FAIL 计数 ≥ 30（容 1-2 条 status-only 用例可能因 supertest 容错过；核心 9 锚点必须全红）。任一锚点 PASS（generator 偷跑实现）即视为合同失效。
