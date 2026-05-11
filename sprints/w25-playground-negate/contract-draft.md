# Sprint Contract Draft (Round 1)

> **合同范围**：playground 加 `GET /negate` endpoint，单参 `n`、strict-schema **回到浮点白名单 `^-?\d+(\.\d+)?$`**（复用 W20 `STRICT_NUMBER`，与 W24 整数 `^\d+$` 形成对比）、`-Number(n)` 取负实现、**跨调用自反不变量（involution）** oracle 强制 chained 双 curl 验证、PR-E Bug 7 generator inline SKILL pattern 真生效验收。
> **journey_type**: autonomous
> **合同硬范围**：只动 `playground/server.js`、`playground/tests/server.test.js`、`playground/README.md`。**禁动**任何 brain / engine / dashboard / apps / packages 代码；**禁动** `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 这七条路由的实现与单测一字一节；**禁引入**新依赖（含 BigInt 重写、bignumber.js、decimal.js、mathjs、zod、joi、ajv 任意一个）；**禁支持** path param / body / POST；**禁加** `Number.isFinite` 结果兜底（取负在 strict 合法输入上结果一定有限，加多余兜底视为合同违约）；**禁用位运算 `~Number(n)+1` 或 `0-Number(n)`**（必须用一元负号 `-Number(n)`，避免边界差异）。

---

## Golden Path

[客户端发 `GET /negate?n=<合法十进制有符号数字串>`] → [playground server 用浮点 strict-schema `^-?\d+(\.\d+)?$` 校验 n（复用 `STRICT_NUMBER` 常量；**不**复用 W24 `^\d+$`）→ 不做任何业务规则拒（不像 W21/W22/W24 有 b=0 / 0^0 / n>18 这类拒）→ 计算 `-Number(n)` 取负] → [客户端收 200 + `{"negation": <-Number(n)>}`，顶层 keys 严等 `["negation"]`；对该响应再发一次 `GET /negate?n=<r1.negation>` 必返 `{"negation": <Number(原 n)>}`（链式自反不变量 `f(f(n))===n`）；或错误情况返 400 + `{"error": "<非空字符串>"}` 不含 `negation`]

---

### Step 1: 客户端发起合法 happy 请求（正整数）

**可观测行为**: 对 `GET /negate?n=5` 返 HTTP 200，body 严等 `{"negation": -5}`，`.negation === -5` 且 `typeof === "number"`，顶层 keys 严等 `["negation"]`，无任何禁用字段（`result`/`value`/`negated`/`inverse`/`opposite`/`product` 等）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3201 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3201/negate?n=5")
echo "$RESP" | jq -e '.negation == -5' || { echo "FAIL Step1 值不等于 -5 实际=$RESP"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.negation | type == "number"' || { echo "FAIL Step1 negation 非 number 类型"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["negation"]' || { echo "FAIL Step1 顶层 keys 不严等 [\"negation\"]"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL Step1 禁用字段 result 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("value") | not' || { echo "FAIL Step1 禁用字段 value 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("negated") | not' || { echo "FAIL Step1 禁用字段 negated 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("inverse") | not' || { echo "FAIL Step1 禁用字段 inverse 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("opposite") | not' || { echo "FAIL Step1 禁用字段 opposite 漏网"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 1 happy 正整数 PASS"
```

**硬阈值**: `.negation === -5` 严等；`keys == ["negation"]` 严等；任一禁用字段存在即 FAIL。

---

### Step 2: 负数取负（负的负是正）

**可观测行为**: `GET /negate?n=-5` → `{negation: 5}`；`GET /negate?n=-100` → `{negation: 100}`。证明 generator 不能错写成 `Math.abs(n)`（绝对值会让负数也变正数，但本 Step 同时验正数路径 → Step 1 已断；这里独立验负数路径返正数）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3202 node server.js & SPID=$!
sleep 2
R1=$(curl -fs "localhost:3202/negate?n=-5")
echo "$R1" | jq -e '.negation == 5' || { echo "FAIL Step2 -5 的负不为 5 实际=$R1"; kill $SPID; exit 1; }
echo "$R1" | jq -e 'keys == ["negation"]' || { echo "FAIL Step2 n=-5 schema 不严"; kill $SPID; exit 1; }
R2=$(curl -fs "localhost:3202/negate?n=-100")
echo "$R2" | jq -e '.negation == 100' || { echo "FAIL Step2 -100 的负不为 100 实际=$R2"; kill $SPID; exit 1; }
R3=$(curl -fs "localhost:3202/negate?n=100")
echo "$R3" | jq -e '.negation == -100' || { echo "FAIL Step2 100 的负不为 -100 实际=$R3"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 2 负数路径 PASS"
```

**硬阈值**: -5 → 5，-100 → 100，100 → -100 全严等。

---

### Step 3: 零 / 负零等价（JSON 序列化下 -0 规范成 0）

**可观测行为**: `GET /negate?n=0` 与 `GET /negate?n=-0` 与 `GET /negate?n=0.0` 与 `GET /negate?n=-0.0` 均返 `{negation: 0}`（不可能区分；JS `JSON.stringify({negation:-0}) === '{"negation":0}'`）。防 generator 错返 `{negation: "-0"}` 字符串型或 `{negation: -0}` 经某种自定义序列化暴露负零。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3203 node server.js & SPID=$!
sleep 2
for N in 0 -0 0.0 -0.0; do
  RESP=$(curl -fs "localhost:3203/negate?n=$N")
  echo "$RESP" | jq -e '.negation == 0' || { echo "FAIL Step3 n=$N 不等价 0 实际=$RESP"; kill $SPID; exit 1; }
  echo "$RESP" | jq -e '.negation | type == "number"' || { echo "FAIL Step3 n=$N negation 非 number 类型"; kill $SPID; exit 1; }
  echo "$RESP" | jq -e 'keys == ["negation"]' || { echo "FAIL Step3 n=$N schema 不严"; kill $SPID; exit 1; }
done
kill $SPID
echo "✅ Step 3 零 / 负零等价 PASS"
```

**硬阈值**: 0 / -0 / 0.0 / -0.0 四个输入均返 `{negation: 0}` 严等；任一不为 number 类型或非 0 即 FAIL。

---

### Step 4: 小数取负（含正小数、负小数）

**可观测行为**: `GET /negate?n=3.14` → `{negation: -3.14}`；`GET /negate?n=-3.14` → `{negation: 3.14}`；`GET /negate?n=1.5` → `{negation: -1.5}`。证明 generator 不能错用位运算 `~Number(n)+1`（位运算会截断小数到整数，3.14 → -3 而非 -3.14）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3204 node server.js & SPID=$!
sleep 2
R1=$(curl -fs "localhost:3204/negate?n=3.14")
echo "$R1" | jq -e '.negation == -3.14' || { echo "FAIL Step4 3.14 → -3.14 实际=$R1（疑位运算截断到 -3）"; kill $SPID; exit 1; }
R2=$(curl -fs "localhost:3204/negate?n=-3.14")
echo "$R2" | jq -e '.negation == 3.14' || { echo "FAIL Step4 -3.14 → 3.14 实际=$R2"; kill $SPID; exit 1; }
R3=$(curl -fs "localhost:3204/negate?n=1.5")
echo "$R3" | jq -e '.negation == -1.5' || { echo "FAIL Step4 1.5 → -1.5 实际=$R3"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 4 小数路径 PASS"
```

**硬阈值**: 3.14 / -3.14 / 1.5 三个 IEEE-754 表示精确的小数全严等；任一被截断 / 漂移即 FAIL。

---

### Step 5: **跨调用自反不变量（involution）** oracle（W25 核心新增）

**可观测行为**: 对任意 strict 合法 n，独立发两次 chained 请求：先 `GET /negate?n=<n>` 得 `r1.negation`；再 `GET /negate?n=<r1.negation>` 得 `r2.negation`，必满足 `r2.negation === Number(<原 n>)`。这是 W19~W24 单 curl 或独立两 curl 范式的首次 **链式依赖** 扩展——第二次请求的 query 参数等于第一次响应的字段值。覆盖正整数、负小数、零三个语义类（零退化为身份）。若 generator 错写 `Math.abs(n)` / `~Number(n)+1` / 直接 `Number(n)` 不取负 / `String(-Number(n))` 字符串型，必被抓。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3205 node server.js & SPID=$!
sleep 2

# Case A: n=5 → r1=-5 → r2=5（正整数闭环）
R1A=$(curl -fs "localhost:3205/negate?n=5" | jq '.negation')
[ "$R1A" = "-5" ] || { echo "FAIL Step5-A r1.negation=$R1A != -5"; kill $SPID; exit 1; }
R2A=$(curl -fs "localhost:3205/negate?n=$R1A" | jq '.negation')
[ "$R2A" = "5" ] || { echo "FAIL Step5-A 自反 r2.negation=$R2A != Number(5)=5"; kill $SPID; exit 1; }

# Case B: n=-3.14 → r1=3.14 → r2=-3.14（负小数闭环，位运算实现必断在 r1 阶段）
R1B=$(curl -fs "localhost:3205/negate?n=-3.14" | jq '.negation')
[ "$R1B" = "3.14" ] || { echo "FAIL Step5-B r1.negation=$R1B != 3.14"; kill $SPID; exit 1; }
R2B=$(curl -fs "localhost:3205/negate?n=$R1B" | jq '.negation')
[ "$R2B" = "-3.14" ] || { echo "FAIL Step5-B 自反 r2.negation=$R2B != Number(-3.14)=-3.14"; kill $SPID; exit 1; }

# Case C: n=0 → r1=0 → r2=0（零退化为身份，仍闭环）
R1C=$(curl -fs "localhost:3205/negate?n=0" | jq '.negation')
[ "$R1C" = "0" ] || { echo "FAIL Step5-C r1.negation=$R1C != 0"; kill $SPID; exit 1; }
R2C=$(curl -fs "localhost:3205/negate?n=$R1C" | jq '.negation')
[ "$R2C" = "0" ] || { echo "FAIL Step5-C 零自反 r2.negation=$R2C != 0"; kill $SPID; exit 1; }

# Case D: n=100 → r1=-100 → r2=100（大整数闭环）
R1D=$(curl -fs "localhost:3205/negate?n=100" | jq '.negation')
[ "$R1D" = "-100" ] || { echo "FAIL Step5-D r1.negation=$R1D != -100"; kill $SPID; exit 1; }
R2D=$(curl -fs "localhost:3205/negate?n=$R1D" | jq '.negation')
[ "$R2D" = "100" ] || { echo "FAIL Step5-D 自反 r2.negation=$R2D != 100"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Step 5 跨调用自反不变量 4 路径 PASS"
```

**硬阈值**: 4 个 case 的 chained `f(f(n)) === Number(<原 n>)` 全严等；shell 字面字符串比对（避免浮点干扰）；任一不等即 FAIL。

---

### Step 6: 前导 0 strict 通过且等价 happy

**可观测行为**: `GET /negate?n=05` → 200 + `{negation: -5}`（`^-?\d+(\.\d+)?$` 允许前导 0，且 `Number("05") === 5`）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3206 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3206/negate?n=05")
echo "$RESP" | jq -e '.negation == -5' || { echo "FAIL Step6 n=05 不等价 n=5 实际=$RESP"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["negation"]' || { echo "FAIL Step6 n=05 schema 不严"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 6 前导 0 等价 PASS"
```

**硬阈值**: `n=05` 与 `n=5` 严等 `negation == -5`。

---

### Step 7: strict-schema 拒（`^-?\d+(\.\d+)?$` 白名单外全 400）

**可观测行为**: 前导 `+`、双负号、点前无数字、点后无数字、科学计数法、十六进制、千分位、空串、字母串、`Infinity`、`NaN`、缺参 全返 400，body 严等 `{error: "<non-empty>"}`，不含 `negation`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3207 node server.js & SPID=$!
sleep 2

# 缺参（无 query）
CODE=$(curl -s -o /tmp/no_n.json -w "%{http_code}" "localhost:3207/negate")
[ "$CODE" = "400" ] || { echo "FAIL 缺参非 400 实际 $CODE"; kill $SPID; exit 1; }
jq -e 'keys == ["error"]' < /tmp/no_n.json || { echo "FAIL 缺参 schema 不严"; kill $SPID; exit 1; }
jq -e 'has("negation") | not' < /tmp/no_n.json || { echo "FAIL 缺参错误体含 negation"; kill $SPID; exit 1; }

# strict-schema 拒系列 — 必须每条都 400
for Q in "n=%2B5" "n=--5" "n=5." "n=.5" "n=1e2" "n=0xff" "n=1,000" "n=" "n=abc" "n=Infinity" "n=-Infinity" "n=NaN"; do
  CODE=$(curl -s -o /tmp/bad.json -w "%{http_code}" "localhost:3207/negate?${Q}")
  [ "$CODE" = "400" ] || { echo "FAIL strict 拒 ${Q} 非 400 实际 $CODE"; kill $SPID; exit 1; }
  jq -e '.error | type == "string" and length > 0' < /tmp/bad.json || { echo "FAIL ${Q} error 非空 string"; kill $SPID; exit 1; }
  jq -e 'has("negation") | not' < /tmp/bad.json || { echo "FAIL ${Q} 错误体含 negation"; kill $SPID; exit 1; }
  jq -e 'keys == ["error"]' < /tmp/bad.json || { echo "FAIL ${Q} 错误体 keys 不严等"; kill $SPID; exit 1; }
done
kill $SPID
echo "✅ Step 7 strict-schema 13 项拒 PASS"
```

**硬阈值**: 13 条非法输入（含缺参）全 400；全部 body 严等 `{error: "<non-empty>"}`；任一含 `negation` 或非严 keys 即 FAIL。

---

### Step 8: query 名锁死 `n`，禁用别名一律拒

**可观测行为**: 用 `value` / `num` / `input` / `x` / `a` / `number` / `int` / `integer` / `val` / `v` / `count` / `size` / `arg` 等任何别名代替 `n` → endpoint 应进入"缺 n" 分支返 400，body 不含 `negation`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3208 node server.js & SPID=$!
sleep 2
for ALIAS in x y m k i j a b p q value val num number int integer float decimal input arg arg1 input1 v1 v count size target operand data; do
  CODE=$(curl -s -o /tmp/alias.json -w "%{http_code}" "localhost:3208/negate?${ALIAS}=5")
  [ "$CODE" = "400" ] || { echo "FAIL 别名 ${ALIAS} 没被拒 实际 $CODE"; kill $SPID; exit 1; }
  jq -e 'has("negation") | not' < /tmp/alias.json || { echo "FAIL 别名 ${ALIAS} 错误体含 negation"; kill $SPID; exit 1; }
  jq -e 'keys == ["error"]' < /tmp/alias.json || { echo "FAIL 别名 ${ALIAS} 错误体 keys 不严等"; kill $SPID; exit 1; }
done
# 多别名同时给（generator 错把第一个非 n 别名当 n 吃下也要拒）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3208/negate?value=5&num=5&x=5")
[ "$CODE" = "400" ] || { echo "FAIL 多别名拼接未拒 实际 $CODE"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 8 query 别名锁死 27 项 PASS"
```

**硬阈值**: 27 个 PRD 禁用别名全 400；多别名拼接也 400；任一返 200 或 body 含 `negation` 即 FAIL。

---

### Step 9: 禁用 response 字段全清单反向探针（verification_oracle_completeness 加固）

**可观测行为**: PRD `## Response Schema` 段列禁用 success-body 字段名：`result`/`value`/`answer`/`negated`/`inverse`/`opposite`/`sign_flipped`/`flipped`/`neg`/`minus`/`output`/`out`/`data`/`payload`/`response` + W19~W24 复读防漂 `sum`/`product`/`quotient`/`power`/`remainder`/`factorial`。本 Step 对 happy 响应逐字段断言 `has(name) | not`，确保 generator 不漂移到任何同义 / 复用字段（PR-E 验收命门）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3209 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3209/negate?n=7")
# 字段值必须为 -7
echo "$RESP" | jq -e '.negation == -7' || { echo "FAIL Step9 值"; kill $SPID; exit 1; }
# 21 个 PRD-listed 禁用 response 字段逐个反向（generic 15 个 + W19~W24 字段 6 个）
for FIELD in result value answer negated inverse opposite sign_flipped flipped neg minus output out data payload response sum product quotient power remainder factorial; do
  echo "$RESP" | jq -e "has(\"${FIELD}\") | not" > /dev/null || { echo "FAIL Step9 禁用响应字段 ${FIELD} 漏网"; kill $SPID; exit 1; }
done
# 同时再验 schema 完整性：顶层 keys 严等 ["negation"]
echo "$RESP" | jq -e 'keys == ["negation"]' || { echo "FAIL Step9 顶层 keys 不严等"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 9 禁用 response 字段全清单 21 项反向 PASS"
```

**硬阈值**: 21 个禁用字段 `has()|not` 全过；顶层 keys 严等 `["negation"]`；任一禁用字段存在即 FAIL（**PR-E 验收命门**：Bug 7 inline SKILL pattern 真生效的体现）。

---

### Step 10: 错误体禁用字段全清单（防混合污染）

**可观测行为**: PRD `## Response Schema` 段错误体禁用字段名清单：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info`。错误响应顶层 keys 必须严等 `["error"]`，**body 不含上述 7 个同义替代字段**。同时不含 `negation`（防"既报错又给值"污染）。本 Step 走 strict-reject + 缺参两类 error path 触发 error，逐字段反向验证。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3210 node server.js & SPID=$!
sleep 2
# 触发 error 的两类路径：strict reject / 缺参
for QS in "n=abc" "n=1e2" "n=Infinity" ""; do
  CODE=$(curl -s -o /tmp/err.json -w "%{http_code}" "localhost:3210/negate?${QS}")
  [ "$CODE" = "400" ] || { echo "FAIL Step10 error path '${QS}' 非 400"; kill $SPID; exit 1; }
  # error 字段必有且非空
  jq -e '.error | type == "string" and length > 0' < /tmp/err.json > /dev/null || { echo "FAIL Step10 '${QS}' error 字段缺/空"; kill $SPID; exit 1; }
  # 7 个 PRD-listed 错误体禁用替代字段逐个反向
  for ALT in message msg reason detail details description info; do
    jq -e "has(\"${ALT}\") | not" < /tmp/err.json > /dev/null || { echo "FAIL Step10 '${QS}' 错误体含禁用替代字段 ${ALT}"; kill $SPID; exit 1; }
  done
  # body 不含 negation（防混合污染）
  jq -e 'has("negation") | not' < /tmp/err.json > /dev/null || { echo "FAIL Step10 '${QS}' 错误体含 negation"; kill $SPID; exit 1; }
  # 顶层 keys 严等 ["error"]
  jq -e 'keys == ["error"]' < /tmp/err.json > /dev/null || { echo "FAIL Step10 '${QS}' 顶层 keys 不严等"; kill $SPID; exit 1; }
done
kill $SPID
echo "✅ Step 10 错误体禁用字段全清单 7 项 + 4 error path PASS"
```

**硬阈值**: 4 个 error path × (1 error 必有 + 7 禁用字段反向 + 1 无 negation + 1 keys 严等) = 40 项断言全过。

---

### Step 11: 现有 7 条路由回归无损

**可观测行为**: `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 每条至少 1 个 happy 仍返预期响应（防 generator 误删 cascade 假绿）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3211 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3211/health" | jq -e '.ok == true' || { echo "FAIL /health 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3211/sum?a=2&b=3" | jq -e '.sum == 5' || { echo "FAIL /sum 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3211/multiply?a=2&b=3" | jq -e '.product == 6' || { echo "FAIL /multiply 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3211/divide?a=6&b=2" | jq -e '.quotient == 3' || { echo "FAIL /divide 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3211/power?a=2&b=10" | jq -e '.power == 1024' || { echo "FAIL /power 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3211/modulo?a=10&b=3" | jq -e '.remainder == 1' || { echo "FAIL /modulo 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3211/factorial?n=5" | jq -e '.factorial == 120' || { echo "FAIL /factorial 回归"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 11 旧 7 路由回归 PASS"
```

**硬阈值**: 7 条路由 happy 全过；任一断裂即 FAIL。

---

### Step 12: PR diff 行级断言 — 旧 7 路由的 `app.get('/...')` 注册行**零删除**

**可观测行为**: 本轮 PR 在 `playground/server.js` 上的 git diff，以 `-` 开头（行删除）的行中**不得出现** `app.get(...` 紧跟 `/health` / `/sum` / `/multiply` / `/divide` / `/power` / `/modulo` / `/factorial` 任一字面量。即"generator 不许通过删除旧路由的方式给 /negate 腾位置"——配合 Step 11 运行时回归 + DoD ARTIFACT 静态正则验证，形成"diff 行级 + 静态 regex + 运行时回归"三重保险，根除 cascade 假绿。

**验证命令**:
```bash
git fetch origin main --depth=50 2>/dev/null || true
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo "")
[ -n "$BASE" ] || { echo "FAIL Step 12 取不到 merge-base"; exit 1; }
DELETED=$(git diff "$BASE" -- playground/server.js | grep -cE "^-[[:space:]]*app\.get\(['\"]/(health|sum|multiply|divide|power|modulo|factorial)['\"]") || DELETED=0
[ "$DELETED" -eq 0 ] || {
  echo "FAIL Step 12: generator 删除了旧路由 ${DELETED} 行（PR diff 中 app.get('/(health|sum|multiply|divide|power|modulo|factorial)') 出现在以 - 开头的行）"
  git diff "$BASE" -- playground/server.js | grep -nE "^-[[:space:]]*app\.get\(['\"]/(health|sum|multiply|divide|power|modulo|factorial)['\"]"
  exit 1
}
echo "✅ Step 12 PR diff 旧 7 路由零删除 PASS"
```

**硬阈值**: PR diff 中以 `-` 开头的旧 7 路由 `app.get(...)` 注册行计数严等 0。任一被删即 FAIL（即使后面 happy 因 generator 又加回来过了运行时也算 FAIL — 行级 git 历史不可造假）。

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
PORT=3299
PLAYGROUND_PORT=$PORT node server.js & SPID=$!
sleep 2

# E2E-1. happy 正整数 + schema 严等
RESP=$(curl -fs "localhost:$PORT/negate?n=5")
echo "$RESP" | jq -e '.negation == -5' || { echo "FAIL E2E-1 值"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["negation"]' || { echo "FAIL E2E-1 schema"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.negation | type == "number"' || { echo "FAIL E2E-1 type"; kill $SPID; exit 1; }

# E2E-2. 负数取负
curl -fs "localhost:$PORT/negate?n=-5" | jq -e '.negation == 5' || { echo "FAIL E2E-2a -5→5"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/negate?n=-100" | jq -e '.negation == 100' || { echo "FAIL E2E-2b -100→100"; kill $SPID; exit 1; }

# E2E-3. 零 / 负零等价
for N in 0 -0 0.0 -0.0; do
  curl -fs "localhost:$PORT/negate?n=$N" | jq -e '.negation == 0' || { echo "FAIL E2E-3 n=$N != 0"; kill $SPID; exit 1; }
done

# E2E-4. 小数取负
curl -fs "localhost:$PORT/negate?n=3.14" | jq -e '.negation == -3.14' || { echo "FAIL E2E-4a 3.14"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/negate?n=-3.14" | jq -e '.negation == 3.14' || { echo "FAIL E2E-4b -3.14"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/negate?n=1.5" | jq -e '.negation == -1.5' || { echo "FAIL E2E-4c 1.5"; kill $SPID; exit 1; }

# E2E-5. 跨调用自反不变量 oracle（W25 核心 — chained 两次 curl，第二次 query 用第一次响应字段值）
# Case A: n=5
R1A=$(curl -fs "localhost:$PORT/negate?n=5" | jq '.negation')
[ "$R1A" = "-5" ] || { echo "FAIL E2E-5A r1=$R1A != -5"; kill $SPID; exit 1; }
R2A=$(curl -fs "localhost:$PORT/negate?n=$R1A" | jq '.negation')
[ "$R2A" = "5" ] || { echo "FAIL E2E-5A 自反 r2=$R2A != 5"; kill $SPID; exit 1; }
# Case B: n=-3.14
R1B=$(curl -fs "localhost:$PORT/negate?n=-3.14" | jq '.negation')
[ "$R1B" = "3.14" ] || { echo "FAIL E2E-5B r1=$R1B != 3.14"; kill $SPID; exit 1; }
R2B=$(curl -fs "localhost:$PORT/negate?n=$R1B" | jq '.negation')
[ "$R2B" = "-3.14" ] || { echo "FAIL E2E-5B 自反 r2=$R2B != -3.14"; kill $SPID; exit 1; }
# Case C: n=0
R1C=$(curl -fs "localhost:$PORT/negate?n=0" | jq '.negation')
[ "$R1C" = "0" ] || { echo "FAIL E2E-5C r1=$R1C != 0"; kill $SPID; exit 1; }
R2C=$(curl -fs "localhost:$PORT/negate?n=$R1C" | jq '.negation')
[ "$R2C" = "0" ] || { echo "FAIL E2E-5C 自反 r2=$R2C != 0"; kill $SPID; exit 1; }

# E2E-6. 前导 0 等价
curl -fs "localhost:$PORT/negate?n=05" | jq -e '.negation == -5' || { echo "FAIL E2E-6 n=05"; kill $SPID; exit 1; }

# E2E-7. strict-schema 拒系列
for Q in "n=%2B5" "n=--5" "n=5." "n=.5" "n=1e2" "n=0xff" "n=abc" "n=" "n=Infinity" "n=NaN" "n=1,000"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:$PORT/negate?$Q")
  [ "$CODE" = "400" ] || { echo "FAIL E2E-7 strict $Q 非 400 实际 $CODE"; kill $SPID; exit 1; }
done
# 缺参
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:$PORT/negate")
[ "$CODE" = "400" ] || { echo "FAIL E2E-7 缺参非 400"; kill $SPID; exit 1; }

# E2E-8. query 名锁死
for ALIAS in value num input x a number int integer val v count size; do
  CODE=$(curl -s -o /tmp/e8.json -w "%{http_code}" "localhost:$PORT/negate?${ALIAS}=5")
  [ "$CODE" = "400" ] || { echo "FAIL E2E-8 别名 ${ALIAS} 未拒 实际 $CODE"; kill $SPID; exit 1; }
  jq -e 'has("negation") | not' < /tmp/e8.json || { echo "FAIL E2E-8 别名 ${ALIAS} 错误体含 negation"; kill $SPID; exit 1; }
done

# E2E-9. 禁用 response 字段全清单（PR-E 验收命门）
RESP=$(curl -fs "localhost:$PORT/negate?n=7")
for FIELD in result value answer negated inverse opposite sign_flipped flipped neg minus output out data payload response sum product quotient power remainder factorial; do
  echo "$RESP" | jq -e "has(\"${FIELD}\") | not" > /dev/null || { echo "FAIL E2E-9 禁用 response 字段 ${FIELD} 漏网（PR-E Bug 7 未真生效）"; kill $SPID; exit 1; }
done

# E2E-10. 错误体禁用字段
for QS in "n=abc" "n=1e2" ""; do
  curl -s -o /tmp/eb.json "localhost:$PORT/negate?${QS}"
  for ALT in message msg reason detail details description info; do
    jq -e "has(\"${ALT}\") | not" < /tmp/eb.json > /dev/null || { echo "FAIL E2E-10 '${QS}' 错误体含禁用 ${ALT}"; kill $SPID; exit 1; }
  done
  jq -e 'keys == ["error"]' < /tmp/eb.json > /dev/null || { echo "FAIL E2E-10 '${QS}' error keys 不严等"; kill $SPID; exit 1; }
  jq -e 'has("negation") | not' < /tmp/eb.json > /dev/null || { echo "FAIL E2E-10 '${QS}' 含 negation"; kill $SPID; exit 1; }
done

# E2E-11. 旧 7 路由回归
curl -fs "localhost:$PORT/health" | jq -e '.ok == true' || { echo "FAIL E2E-11 /health"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/sum?a=2&b=3" | jq -e '.sum == 5' || { echo "FAIL E2E-11 /sum"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/multiply?a=2&b=3" | jq -e '.product == 6' || { echo "FAIL E2E-11 /multiply"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/divide?a=6&b=2" | jq -e '.quotient == 3' || { echo "FAIL E2E-11 /divide"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/power?a=2&b=10" | jq -e '.power == 1024' || { echo "FAIL E2E-11 /power"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/modulo?a=10&b=3" | jq -e '.remainder == 1' || { echo "FAIL E2E-11 /modulo"; kill $SPID; exit 1; }
curl -fs "localhost:$PORT/factorial?n=5" | jq -e '.factorial == 120' || { echo "FAIL E2E-11 /factorial"; kill $SPID; exit 1; }

# E2E-12. vitest 全套
NODE_ENV=test npx vitest run --reporter=verbose 2>&1 | tail -20

# E2E-13. PR diff 行级 — 旧 7 路由零删除
cd ..
git fetch origin main --depth=50 2>/dev/null || true
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo "")
[ -n "$BASE" ] || { echo "FAIL E2E-13 取不到 merge-base"; kill $SPID 2>/dev/null; exit 1; }
DELETED=$(git diff "$BASE" -- playground/server.js | grep -cE "^-[[:space:]]*app\.get\(['\"]/(health|sum|multiply|divide|power|modulo|factorial)['\"]") || DELETED=0
[ "$DELETED" -eq 0 ] || {
  echo "FAIL E2E-13 PR diff 删除了旧路由 ${DELETED} 行";
  git diff "$BASE" -- playground/server.js | grep -nE "^-[[:space:]]*app\.get\(['\"]/(health|sum|multiply|divide|power|modulo|factorial)['\"]"
  kill $SPID 2>/dev/null
  exit 1
}

kill $SPID
echo "✅ Golden Path 12 段 + vitest + PR diff 全过"
```

**通过标准**: 脚本 `exit 0`。

---

## Risk Register

> **trace matrix**：每个具名风险 → 触发条件 → 缓解 Step / DoD ARTIFACT / DoD BEHAVIOR 锚点。
> Reviewer 评分依据：每个风险至少 1 个具体缓解锚点（不是泛泛"加测试"），且锚点能跑出 FAIL（不是 echo true 假绿）。

### W19~W24 复用旧坑（5 个，已实证过）

| # | 风险 | 触发条件 | 缓解锚点 | 检测命令 |
|---|---|---|---|---|
| R1 | generator 把响应字段命名为 `result`（generic 漂移；W19~W24 实证 5/5 倾向） | 响应体含 `result` 而非 `negation` | Step 1 + Step 9（21 禁用字段反向）+ DoD ARTIFACT 字段名 regex | Step 9 跑出 `has("result") \| not` FAIL |
| R2 | generator 把响应字段写成 W19~W24 复用字段（`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`） | 单参 endpoint 错搬其他实现 | Step 9 禁用全清单 + DoD ARTIFACT regex 反向 | `jq -e 'has("factorial") \| not'` 等 6 条 |
| R3 | generator 误删 W19~W24 + bootstrap 旧 7 路由（cascade 假绿） | server.js 改动时删除其他 `app.get('/...')` 行 | Step 11 运行时回归 + Step 12 PR diff 行级 + DoD ARTIFACT 静态 regex（三重保险） | Step 12 `git diff` grep `-cE` 删除行数 = 0 |
| R4 | generator 错搬双参 query 解析（`a` / `b`） | `?n=5` 时漂移到 `a=5` 假绿 | DoD ARTIFACT 字段名 regex + Step 8 query 别名锁死（27 个反向） | Step 8 跑 a=5 别名 → 400 |
| R5 | generator 复用 W24 整数 regex `^\d+$` 给浮点用 | strict 错拒合法负数 / 小数（如 `n=-5` 被错拒） | Step 2 / Step 4（负数 + 小数 happy）+ DoD ARTIFACT regex 字面匹配 `^-?\\d+(\\.\\d+)?$` | Step 2 跑 n=-5 应 200 + Step 4 跑 n=3.14 应 200 |

### W25 特有新坑（7 个，未实证）

| # | 风险 | 触发条件 | 缓解锚点 | 检测命令 |
|---|---|---|---|---|
| R6 | generator 错写成 `Math.abs(n)`（返绝对值） | n=-5 返 5 而非 5；但 n=5 返 5 也巧合过；自反 oracle 抓 | Step 2（n=5 → -5 严等）+ Step 5 自反 oracle A（n=5 → r1=-5 严等） | Step 2 严等 -5；`Math.abs(5)=5≠-5` FAIL |
| R7 | generator 错用位运算 `~Number(n)+1` | 浮点 3.14 被截断到 -3 而非 -3.14 | Step 4（3.14 → -3.14 严等）+ Step 5 自反 Case B | Step 4 跑 3.14 → -3.14；位运算实现 → -3 FAIL |
| R8 | generator 错用 `String(-Number(n))` 字符串型 | `.negation` 是 `"-5"` 字符串而非 -5 number | Step 1 `type == "number"` + Step 9 schema 完整性 + DoD ARTIFACT 段不含 `String(` | Step 1 `jq -e '.negation \| type == "number"'` 抓 |
| R9 | generator 错写直接 `Number(n)` 不取负（忘了一元负号） | n=5 返 5（应为 -5） | Step 1 严等 -5 + Step 5 自反 oracle 第一次必断 | Step 1 跑 n=5 应 -5；返 5 → FAIL |
| R10 | generator 负零暴露 — 错返 `{negation: -0}` 经自定义序列化 | n=0 返 `{negation: -0}` 非 0 | Step 3（0/-0 全严等 0） + DoD ARTIFACT 段不含 `JSON.stringify.*-0` | Step 3 `jq -e '.negation == 0'` 抓 |
| R11 | generator 错误体污染 — `{error: "x", negation: null}` 混合 | 错误响应附带 `negation` 字段（即使是 null） | Step 7/8/10 `has("negation") \| not` + Step 10 错误体 keys 严等 `["error"]` | 4 个 error path × `keys == ["error"]` |
| R12 | **PR-E 验收失败** — generator 字段名漂移（`negated`/`inverse`/`opposite`/`result`/`value`） | response 顶层 keys 包含上述任一同义词 | Step 9（21 禁用字段反向）+ DoD ARTIFACT 字段名 regex 字面 `negation:` | Step 9 跑 21 条 `has()|not` 全过；任一漏即视为 Bug 7 修复未真生效 |

### 总计 12 个具名风险，每个 ≥ 1 具体缓解 Step + ≥ 1 具体检测命令（非 echo true）。

---

## Response Schema codify（jq -e 完整命令矩阵）

| PRD 段 | 合同必须有的 jq -e 命令 | 覆盖 Step |
|---|---|---|
| Success 字段 `negation (number)` | `jq -e '.negation \| type == "number"'` | Step 1/3 |
| Success 字段值（n=5） | `jq -e '.negation == -5'` | Step 1/E2E-1 |
| Success 字段值（n=-5） | `jq -e '.negation == 5'` | Step 2 |
| Success 字段值（n=0 / -0） | `jq -e '.negation == 0'` | Step 3 |
| Success 字段值（n=3.14） | `jq -e '.negation == -3.14'` | Step 4 |
| Success Schema 完整性 | `jq -e 'keys == ["negation"]'` | Step 1/2/3/4/6/9 |
| Success 禁 result/value/answer/negated/inverse/opposite/sign_flipped/flipped/neg/minus/output/out/data/payload/response/sum/product/quotient/power/remainder/factorial（**21 个 PRD 禁用字段**） | `jq -e 'has("<field>") \| not'` × 21 | **Step 9**（PR-E 验收命门）|
| Error 字段 `error (string, non-empty)` | `jq -e '.error \| type == "string" and length > 0'` | Step 7/10 |
| Error Schema 完整性 | `jq -e 'keys == ["error"]'` | Step 7/8/10 |
| Error body 不含 `negation` | `jq -e 'has("negation") \| not'` | Step 7/8/10 |
| Error body 禁 message/msg/reason/detail/details/description/info（**7 个 PRD 禁用替代字段**） | `jq -e 'has("<alt>") \| not'` × 7 | **Step 10**（覆盖全清单）|
| **跨调用自反不变量 f(f(n))===Number(n)** | chained 双 curl，第二次 query 用第一次响应字段值，shell 字面字符串比对 | **Step 5**（W25 核心）|
| query 名锁死 n（**27 个 PRD 禁用别名全清单**） | `?<alias>=5` → 400 + 不含 negation × 27 | **Step 8** |
| PR diff 旧 7 路由零删除 | `grep -cE` 删除行数 = 0 | Step 12 |

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 GET /negate（server + tests + README，含跨调用自反 oracle）

**范围**:
- `playground/server.js`：在 `/factorial` 路由之后、`app.listen` 之前新增 `GET /negate`。strict-schema **复用** 已有 `STRICT_NUMBER = /^-?\d+(\.\d+)?$/` 常量（W20 引入，W20/W21/W22/W23 已共用；**不复用** W24 `^\d+$` 整数白名单——必须接受负数与小数）。判定顺序 = 缺参 → strict regex 校验 → 直接 `-Number(n)` 取负 → 200 返 `{negation: result}`。**禁用** 位运算 `~Number(n)+1` 与 `0-Number(n)`（必须用一元负号 `-Number(n)`）；**禁用** `Number.isFinite` 兜底（一元负号在 strict 合法输入上结果一定有限）；**禁用** `Math.abs` / `Math.sign` 中间步骤。
- `playground/tests/server.test.js`：新增 `describe('GET /negate')` 块（与 `/sum`/`/multiply`/`/divide`/`/power`/`/modulo`/`/factorial` describe 平级），覆盖 happy 8+（含 `n=5`/`n=-5`/`n=0`/`n=-0`/`n=3.14`/`n=-3.14`/`n=100`/`n=-100`，其中 `n=0` 和 `n=-0` 各必须有独立用例显式断言 `negation === 0`）、strict 拒 12+（前导 + / 双负号 / 点前无数字 / 点后无数字 / 科学计数法 / 十六进制 / 千分位 / 空串 / 字母串 / Infinity / NaN / 缺参 各至少 1 条）、值 oracle 4+（正整数 / 负整数 / 正小数 / 负小数 各至少 1 条）、**跨调用自反 oracle 3+**（同 `it()` 内两次 `await request(app).get('/negate')`，第二次 query 用 `String(r1.body.negation)`；覆盖正整数 / 负小数 / 零各 1）、schema oracle 2+（`Object.keys(res.body).sort()` 严等 `['negation']`，错误体严等 `['error']`）、错误体不含 negation 1+、错误体 keys 严等 ["error"] 1+、query 别名锁 2+（`value=5` 与 `x=5` 都 400）、schema type 断言 1+（`typeof res.body.negation === 'number'`）、回归断言 7+（旧 7 路由各 ≥ 1 条 happy）。
- `playground/README.md`：端点列表加 `/negate`，补 happy（含负数 / 小数 / 零）/ strict 拒 / 自反 oracle 各示例 ≥ 1。
- 不引入新依赖；不引入 BigInt；不引入 `Number.isFinite` 兜底；不动旧 7 路由一个字符。

**大小**: M（server ≈ 10 行净增 + tests ≈ 110+ 行净增含自反用例 + README ≈ 30+ 行）。

**依赖**: 无（playground 子项目独立）。

**BEHAVIOR 覆盖测试文件**: `tests/ws1/negate.test.js`

---

## Test Contract

> **vitest 框架注**：vitest 接受 `it()` 与 `test()` 两种语法等价。本测试文件实际使用 `test(` 写法（与 PRD 表述 `it()` 等价语义），下表 test 名严格按文件实际字面量引用。

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据（具名 test + 行位 + AssertionError 锚点） |
|---|---|---|---|
| WS1 | `tests/ws1/negate.test.js` | happy 正整数/负数/零/负零/小数/负小数、跨调用自反、前导 +、query 别名、schema 完整性、不含 negation、回归 | 当前 main 分支 `playground/server.js` **不含** `app.get('/negate', ...)` 路由 → Express 默认 404 中间件返 `text/html` 404 → supertest `res.status === 404` → 与所有 `expect(res.status).toBe(200)` 严等比对必抛 AssertionError，详见下方 9 锚点；总 vitest FAIL count ≥ 33（happy 8 + strict 拒 12 + 值 oracle 4 + 自反 3 + schema 2 + query 别名 2 + type 1 + 错误体 1 → 33 条用例，其中预期 200/400 的对照路径均会 FAIL；只有 7 条回归用例可能 PASS） |

### 预期红证据 — 9 条 AssertionError 行位锚点

下表"行位"指 `sprints/w25-playground-negate/tests/ws1/negate.test.js` 文件中的近似行号。**未实现状态**（main 分支 server.js 无 `/negate`）下，supertest `request(app).get('/negate?...').` 会经 Express 默认 404 handler 返 `res.status === 404`。表中"AssertionError 锚点"列描述 vitest 输出 `Expected: <X> Received: 404` 的具体抛点：

| # | 行位 | 具名 test 字面量 | 期望 status | 实际 status（未实现） | AssertionError 锚点 |
|---|---|---|---|---|---|
| 1 | ~8-13 | `test('GET /negate?n=5 → 200 + {negation:-5}（happy 正整数）', ...)` | 200 | 404 | 行 ~11: `expect(res.status).toBe(200)` → AssertionError: expected 404 to be 200 |
| 2 | ~15-20 | `test('GET /negate?n=-5 → 200 + {negation:5}（负数路径）', ...)` | 200 | 404 | 行 ~18: `expect(res.status).toBe(200)` → AssertionError |
| 3 | ~22-27 | `test('GET /negate?n=0 → 200 + {negation:0}（零退化为身份）', ...)` | 200 | 404 | 行 ~25: `expect(res.status).toBe(200)` → AssertionError |
| 4 | ~29-34 | `test('GET /negate?n=-0 → 200 + {negation:0}（JSON 下负零规范）', ...)` | 200 | 404 | 行 ~32: `expect(res.status).toBe(200)` → AssertionError |
| 5 | ~40-46 | `test('GET /negate?n=3.14 → 200 + {negation:-3.14}（正小数）', ...)` | 200 | 404 | 行 ~43: `expect(res.status).toBe(200)` → AssertionError；body.negation undefined |
| 6 | ~70-79 | `test('跨调用自反 oracle: f(f(5)) === 5（chained 两次 supertest）', ...)` | 双 200 | 双 404 | 行 ~73-74: `expect(r1.status).toBe(200)` + `expect(r2.status).toBe(200)` 双断 AssertionError；行 ~76 `expect(r2.body.negation).toBe(Number('5'))` 退化为 `undefined === 5` 抛 |
| 7 | ~81-90 | `test('跨调用自反 oracle: f(f(-3.14)) === -3.14（chained 负小数）', ...)` | 双 200 | 双 404 | 行 ~84-85: 双 `expect(...status).toBe(200)` 断；W25 核心 oracle 验失 |
| 8 | ~140-145 | `test('成功响应 schema 完整性: Object.keys 严等 ["negation"]', ...)` | 200 + keys=['negation'] | 404 + keys=[] 或 HTML body | 行 ~142: `expect(res.status).toBe(200)` 断；行 ~143 `Object.keys(res.body).sort()` 不等于 `['negation']` 双断 |
| 9 | ~160-165 | `test('GET /negate?value=5 (query 别名锁) → 400 + body 不含 negation', ...)` | 400 + 不含 negation | 404 + 默认 HTML | 行 ~162: `expect(res.status).toBe(400)` → AssertionError: expected 404 to be 400 |

**总 AssertionError 计数预期 ≥ 33**（33 个 /negate 用例 - 7 个旧路由回归 - 部分 status 容错冗余 = 26 起码红；核心 9 锚点必须全红）。

**Evaluator 操作指引**：

```bash
# 当前 main 分支无 /negate 路由，直接跑 vitest 应看到 FAIL ≥ 26
cd playground
NODE_ENV=test npx vitest run tests/server.test.js --reporter=verbose 2>&1 | grep -cE "✗|FAIL|AssertionError"
# 期望: ≥ 9（9 锚点至少都红） / 完整 generator 写代码前应 ≥ 26

# 也可针对 sprint 路径跑同款契约测试副本（合同 tests/ws1）
NODE_ENV=test npx vitest run sprints/w25-playground-negate/tests/ws1/negate.test.js --reporter=verbose 2>&1
# 期望: 同上，所有 /negate 用例 FAIL，旧路由回归 PASS
```

**红证据校验通过的硬阈值**: AssertionError 数 ≥ 9（9 锚点全红）；总 FAIL 计数 ≥ 24（容 1-2 条 status-only 用例可能因 supertest 容错过；核心 9 锚点必须全红）。任一锚点 PASS（generator 偷跑实现）即视为合同失效。
