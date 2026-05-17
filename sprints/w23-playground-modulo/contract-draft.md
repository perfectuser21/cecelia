# Sprint Contract Draft (Round 2)

W23 Walking Skeleton — playground 新增 `GET /modulo` endpoint，引入 **被除数符号不变量**（sign-of-dividend invariant）作为 W19~W22 链路上首个 **语义不变量级** oracle 探针。

---

## Golden Path

[HTTP 客户端发起 `GET /modulo?a=<dec>&b=<dec>` 请求] → [playground server strict-schema 校验 + 除零拒 + JS 原生 `%` 运算] → [收到 200 + `{"remainder": N}` 严 schema，且满足值复算 + 符号不变量两条 oracle] / [收到 400 + `{"error":"..."}` 且 body 不含 `remainder`]

---

### Step 1: 客户端发请求（入口）

**可观测行为**: HTTP 客户端发 `GET /modulo?a=5&b=3` 请求到 playground server（默认 :3000）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3101 node server.js &
SPID=$!
sleep 2
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3101/modulo?a=5&b=3")
kill $SPID 2>/dev/null
[ "$HTTP" = "200" ] || { echo "FAIL: 入口端点未挂载，期望 200 得到 $HTTP"; exit 1; }
echo "PASS Step1: 入口端点存在"
```

**硬阈值**: HTTP 200，server 可启动，端点存在。

---

### Step 2: server strict-schema 校验

**可观测行为**: 不匹配正则 `^-?\d+(\.\d+)?$` 的输入（科学计数法、Infinity、NaN、前导 +、缺整数部分、十六进制、千分位、空串）一律返 400 + 非空 error，body 不含 `remainder`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3102 node server.js &
SPID=$!
sleep 2

# 8 类非法输入全 400 + body 不含 remainder
for bad in "a=1e3&b=2" "a=Infinity&b=2" "a=2&b=NaN" "a=%2B2&b=3" "a=.5&b=2" "a=2.&b=3" "a=0xff&b=2" "a=1%2C000&b=2" "a=&b=3" "a=abc&b=3"; do
  RESP=$(curl -s "http://127.0.0.1:3102/modulo?${bad}")
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3102/modulo?${bad}")
  [ "$CODE" = "400" ] || { echo "FAIL: ${bad} 期望 400 得到 $CODE"; kill $SPID; exit 1; }
  echo "$RESP" | jq -e '.error | type == "string" and length > 0' >/dev/null || { echo "FAIL: ${bad} 缺非空 error"; kill $SPID; exit 1; }
  echo "$RESP" | jq -e 'has("remainder") | not' >/dev/null || { echo "FAIL: ${bad} 失败响应不应含 remainder"; kill $SPID; exit 1; }
done

kill $SPID 2>/dev/null
echo "PASS Step2: strict-schema 8 类非法输入全 400"
```

**硬阈值**: 8 类非法输入全部返 400 + 非空 error + body 不含 `remainder`。

---

### Step 3: server 除零兜底（b=0 显式拒）

**可观测行为**: strict-schema 通过但 `Number(b) === 0` 时（含 `0`、`0.0`、`-0`、`-0.0`），返 400 + 非空 error + body 不含 `remainder`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3103 node server.js &
SPID=$!
sleep 2

# 4 类 b=0 都拒
for case in "a=5&b=0" "a=0&b=0" "a=-5&b=0" "a=5&b=0.0"; do
  RESP=$(curl -s "http://127.0.0.1:3103/modulo?${case}")
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3103/modulo?${case}")
  [ "$CODE" = "400" ] || { echo "FAIL: ${case} 期望 400 得到 $CODE"; kill $SPID; exit 1; }
  echo "$RESP" | jq -e '.error | type == "string" and length > 0' >/dev/null || { echo "FAIL: ${case} 缺非空 error"; kill $SPID; exit 1; }
  echo "$RESP" | jq -e 'has("remainder") | not' >/dev/null || { echo "FAIL: ${case} body 不应含 remainder"; kill $SPID; exit 1; }
done

kill $SPID 2>/dev/null
echo "PASS Step3: 除零兜底 4 类全拒"
```

**硬阈值**: `a=5&b=0` / `a=0&b=0` / `a=-5&b=0` / `a=5&b=0.0` 全返 400 + body 不含 `remainder`。

---

### Step 4: server 计算 `a % b` 并返 200 + 严 schema

**可观测行为**: strict + `b !== 0` → 200 + `{"remainder": Number(a) % Number(b)}`，顶层 keys 严格等于 `["remainder"]`，无任何附加字段。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3104 node server.js &
SPID=$!
sleep 2

# 1. happy path 值复算 oracle
RESP=$(curl -s "http://127.0.0.1:3104/modulo?a=5&b=3")
echo "$RESP" | jq -e '.remainder == 2' >/dev/null || { echo "FAIL: 5%3 应为 2，得到 $RESP"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.remainder | type == "number"' >/dev/null || { echo "FAIL: remainder 必须是 number"; kill $SPID; exit 1; }

# 2. 严 schema：keys 必须恰好等于 ["remainder"]，不允许任何附加字段
echo "$RESP" | jq -e 'keys == ["remainder"]' >/dev/null || { echo "FAIL: 顶层 keys 必须严格等于 [\"remainder\"]，得到 $(echo "$RESP" | jq -c 'keys')"; kill $SPID; exit 1; }

# 3. 禁用字段反向检查（W19/W20 实证 generator 倾向漂移）
for forbidden in result value answer mod modulo rem rest residue out output data payload response sum product quotient power operation a b input dividend divisor numerator denominator; do
  echo "$RESP" | jq -e "has(\"$forbidden\") | not" >/dev/null || { echo "FAIL: 禁用字段 $forbidden 出现在响应中"; kill $SPID; exit 1; }
done

# 4. 整除场景（remainder === 0）
RESP=$(curl -s "http://127.0.0.1:3104/modulo?a=6&b=2")
echo "$RESP" | jq -e '.remainder == 0' >/dev/null || { echo "FAIL: 6%2 应为 0"; kill $SPID; exit 1; }

# 5. 浮点取模
RESP=$(curl -s "http://127.0.0.1:3104/modulo?a=5.5&b=2")
echo "$RESP" | jq -e '.remainder == 1.5' >/dev/null || { echo "FAIL: 5.5%2 应为 1.5"; kill $SPID; exit 1; }

# 6. a=0 场景
RESP=$(curl -s "http://127.0.0.1:3104/modulo?a=0&b=5")
echo "$RESP" | jq -e '.remainder == 0' >/dev/null || { echo "FAIL: 0%5 应为 0"; kill $SPID; exit 1; }

kill $SPID 2>/dev/null
echo "PASS Step4: 值复算 + 严 schema + 禁用字段反向 全过"
```

**硬阈值**: happy 值复算严格 toBe；顶层 keys 严格 `["remainder"]`；25 个禁用字段全部反向不存在。

---

### Step 5: **W23 核心 oracle —— 被除数符号不变量**

**可观测行为**: 所有 `Number(a) !== 0` 的成功响应必须满足 `Math.sign(remainder) === Math.sign(Number(a))`。JS truncated mod 符号跟随被除数；若 generator 错用 floored mod（如 `((a%b)+b)%b`），符号会跟随除数 b 而非 a，oracle 必抓。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3105 node server.js &
SPID=$!
sleep 2

# W23 关键探针 #1：a=-5, b=3 → JS truncated 期望 -2（floored mod 会返 1）
RESP=$(curl -s "http://127.0.0.1:3105/modulo?a=-5&b=3")
echo "$RESP" | jq -e '.remainder == -2' >/dev/null || { echo "FAIL: -5%3 应为 -2 (JS truncated)，得到 $RESP"; kill $SPID; exit 1; }
# 符号不变量断言：sign(remainder) === sign(-5) === -1
SIGN=$(echo "$RESP" | jq '.remainder | if . > 0 then 1 elif . < 0 then -1 else 0 end')
[ "$SIGN" = "-1" ] || { echo "FAIL: sign(-5%3) 应为 -1，得到 $SIGN（可能 generator 错用 floored mod）"; kill $SPID; exit 1; }

# W23 关键探针 #2：a=5, b=-3 → JS truncated 期望 2（floored mod 会返 -1）
RESP=$(curl -s "http://127.0.0.1:3105/modulo?a=5&b=-3")
echo "$RESP" | jq -e '.remainder == 2' >/dev/null || { echo "FAIL: 5%-3 应为 2 (JS truncated)，得到 $RESP"; kill $SPID; exit 1; }
SIGN=$(echo "$RESP" | jq '.remainder | if . > 0 then 1 elif . < 0 then -1 else 0 end')
[ "$SIGN" = "1" ] || { echo "FAIL: sign(5%-3) 应为 1，得到 $SIGN"; kill $SPID; exit 1; }

# W23 探针 #3：a=-5, b=-3 → JS truncated 期望 -2
RESP=$(curl -s "http://127.0.0.1:3105/modulo?a=-5&b=-3")
echo "$RESP" | jq -e '.remainder == -2' >/dev/null || { echo "FAIL: -5%-3 应为 -2"; kill $SPID; exit 1; }
SIGN=$(echo "$RESP" | jq '.remainder | if . > 0 then 1 elif . < 0 then -1 else 0 end')
[ "$SIGN" = "-1" ] || { echo "FAIL: sign(-5%-3) 应为 -1，得到 $SIGN"; kill $SPID; exit 1; }

# W23 探针 #4：a=0 边界（不施加符号断言，仅断言 remainder === 0）
RESP=$(curl -s "http://127.0.0.1:3105/modulo?a=0&b=-5")
echo "$RESP" | jq -e '.remainder == 0' >/dev/null || { echo "FAIL: 0%-5 应为 0"; kill $SPID; exit 1; }

kill $SPID 2>/dev/null
echo "PASS Step5: 符号不变量 4 类全过（floored mod 实现必挂在此）"
```

**硬阈值**: `-5%3 === -2` / `5%-3 === 2` / `-5%-3 === -2` 三条 truncated 语义全严等；对应 `Math.sign` 全严等于被除数符号。

---

### Step 6: 错误响应 schema 严格（与 W22 一致）

**可观测行为**: 失败响应 body 顶层 keys 严格等于 `["error"]`，error 为非空 string；不允许 `message`/`msg`/`reason`/`detail` 等同义替代；body 必不含 `remainder`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3106 node server.js &
SPID=$!
sleep 2

RESP=$(curl -s "http://127.0.0.1:3106/modulo?a=foo&b=3")
echo "$RESP" | jq -e 'keys == ["error"]' >/dev/null || { echo "FAIL: 错误响应顶层 keys 必须严格等于 [\"error\"]，得到 $(echo "$RESP" | jq -c 'keys')"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.error | type == "string" and length > 0' >/dev/null || { echo "FAIL: error 必须是非空 string"; kill $SPID; exit 1; }

# 禁用错误字段同义替代
for forbidden in message msg reason detail details description info remainder; do
  echo "$RESP" | jq -e "has(\"$forbidden\") | not" >/dev/null || { echo "FAIL: 错误响应不应含 $forbidden"; kill $SPID; exit 1; }
done

kill $SPID 2>/dev/null
echo "PASS Step6: 错误响应 schema 严格"
```

**硬阈值**: 错误顶层 keys 严格 `["error"]`；8 个禁用错误同义字段全部不存在。

---

### Step 7: 回归 — `/health`、`/sum`、`/multiply`、`/divide`、`/power` 行为不变（出口）

**可观测行为**: 5 条现有路由各取 1 个 happy 用例验证仍 200。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3107 node server.js &
SPID=$!
sleep 2

# /health
curl -fs "http://127.0.0.1:3107/health" | jq -e '.ok == true' >/dev/null || { echo "FAIL: /health regression"; kill $SPID; exit 1; }

# /sum
curl -fs "http://127.0.0.1:3107/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null || { echo "FAIL: /sum regression"; kill $SPID; exit 1; }

# /multiply
curl -fs "http://127.0.0.1:3107/multiply?a=2&b=3" | jq -e '.product == 6' >/dev/null || { echo "FAIL: /multiply regression"; kill $SPID; exit 1; }

# /divide
curl -fs "http://127.0.0.1:3107/divide?a=6&b=2" | jq -e '.quotient == 3' >/dev/null || { echo "FAIL: /divide regression"; kill $SPID; exit 1; }

# /power
curl -fs "http://127.0.0.1:3107/power?a=2&b=10" | jq -e '.power == 1024' >/dev/null || { echo "FAIL: /power regression"; kill $SPID; exit 1; }

kill $SPID 2>/dev/null
echo "PASS Step7: 5 条现有路由回归全过"
```

**硬阈值**: 5 条现有路由 happy 各 200 + 字段值正确。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd playground

# 安装依赖（如未安装）
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1

# 启 server
PLAYGROUND_PORT=3201 node server.js &
SPID=$!
sleep 2

cleanup() { kill $SPID 2>/dev/null || true; }
trap cleanup EXIT

BASE="http://127.0.0.1:3201"

# === 1. /modulo happy path（6 类） ===
echo "[1/7] /modulo happy path"
curl -fs "$BASE/modulo?a=5&b=3"   | jq -e '.remainder == 2'   >/dev/null
curl -fs "$BASE/modulo?a=10&b=3"  | jq -e '.remainder == 1'   >/dev/null
curl -fs "$BASE/modulo?a=6&b=2"   | jq -e '.remainder == 0'   >/dev/null
curl -fs "$BASE/modulo?a=5.5&b=2" | jq -e '.remainder == 1.5' >/dev/null
curl -fs "$BASE/modulo?a=0&b=5"   | jq -e '.remainder == 0'   >/dev/null
curl -fs "$BASE/modulo?a=0&b=-5"  | jq -e '.remainder == 0'   >/dev/null

# === 2. /modulo W23 核心符号不变量 oracle（4 类） ===
echo "[2/7] /modulo 符号不变量"
curl -fs "$BASE/modulo?a=-5&b=3"  | jq -e '.remainder == -2' >/dev/null   # JS truncated 关键，floored 会返 1
curl -fs "$BASE/modulo?a=5&b=-3"  | jq -e '.remainder == 2'  >/dev/null   # floored 会返 -1
curl -fs "$BASE/modulo?a=-5&b=-3" | jq -e '.remainder == -2' >/dev/null
# Math.sign 不变量：sign(remainder) === sign(a) 当 a !== 0
SIGN1=$(curl -fs "$BASE/modulo?a=-5&b=3" | jq '.remainder | if . > 0 then 1 elif . < 0 then -1 else 0 end')
[ "$SIGN1" = "-1" ] || { echo "FAIL: sign(-5%3) 应 -1，得 $SIGN1"; exit 1; }
SIGN2=$(curl -fs "$BASE/modulo?a=5&b=-3" | jq '.remainder | if . > 0 then 1 elif . < 0 then -1 else 0 end')
[ "$SIGN2" = "1" ]  || { echo "FAIL: sign(5%-3) 应 1，得 $SIGN2"; exit 1; }

# === 3. /modulo 严 schema + 禁用字段反向 ===
echo "[3/7] /modulo 严 schema"
RESP=$(curl -fs "$BASE/modulo?a=5&b=3")
echo "$RESP" | jq -e 'keys == ["remainder"]' >/dev/null
echo "$RESP" | jq -e '.remainder | type == "number"' >/dev/null
for f in result value answer mod modulo rem rest residue out output data payload response sum product quotient power operation dividend divisor numerator denominator; do
  echo "$RESP" | jq -e "has(\"$f\") | not" >/dev/null || { echo "FAIL: 禁用字段 $f 漏网"; exit 1; }
done

# === 4. /modulo 除零兜底（b=0 拒）===
echo "[4/7] /modulo 除零兜底"
for case in "a=5&b=0" "a=0&b=0" "a=-5&b=0" "a=5&b=0.0"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/modulo?${case}")
  [ "$CODE" = "400" ] || { echo "FAIL: ${case} 期望 400 得 $CODE"; exit 1; }
  RESP=$(curl -s "$BASE/modulo?${case}")
  echo "$RESP" | jq -e 'has("remainder") | not' >/dev/null || { echo "FAIL: ${case} 失败响应不应含 remainder"; exit 1; }
done

# === 5. /modulo strict-schema 拒（10 类）===
echo "[5/7] /modulo strict-schema 拒"
for bad in "a=1e3&b=2" "a=Infinity&b=2" "a=2&b=NaN" "a=%2B2&b=3" "a=.5&b=2" "a=2.&b=3" "a=0xff&b=2" "a=1%2C000&b=2" "a=&b=3" "a=abc&b=3" "a=2" "b=3" ""; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/modulo?${bad}")
  [ "$CODE" = "400" ] || { echo "FAIL: bad=${bad} 期望 400 得 $CODE"; exit 1; }
done

# === 6. /modulo 错误响应 schema 严格 ===
echo "[6/7] /modulo 错误响应 schema"
RESP=$(curl -s "$BASE/modulo?a=foo&b=3")
echo "$RESP" | jq -e 'keys == ["error"]' >/dev/null
echo "$RESP" | jq -e '.error | type == "string" and length > 0' >/dev/null
for f in message msg reason detail details description info remainder; do
  echo "$RESP" | jq -e "has(\"$f\") | not" >/dev/null || { echo "FAIL: 错误响应不应含 $f"; exit 1; }
done

# === 7. 现有 5 条路由回归 ===
echo "[7/7] 5 条现有路由回归"
curl -fs "$BASE/health"             | jq -e '.ok == true'    >/dev/null
curl -fs "$BASE/sum?a=2&b=3"        | jq -e '.sum == 5'      >/dev/null
curl -fs "$BASE/multiply?a=2&b=3"   | jq -e '.product == 6'  >/dev/null
curl -fs "$BASE/divide?a=6&b=2"     | jq -e '.quotient == 3' >/dev/null
curl -fs "$BASE/power?a=2&b=10"     | jq -e '.power == 1024' >/dev/null

echo "✅ E2E 验证全过 — W23 /modulo Golden Path 7 步收敛"
```

**通过标准**: 脚本 exit 0。任一断言失败 → exit 1。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 GET /modulo + 单测 + README

**范围**:
- `playground/server.js` — 在 `/power` 路由之后、`app.listen` 之前新增 `GET /modulo` 路由，复用 `STRICT_NUMBER` 常量做校验 + `Number(b) === 0` 显式拒 + JS 原生 `%` 计算，返 `{remainder: Number(a) % Number(b)}`。约 10 行实现。
- `playground/tests/server.test.js` — 新增 `describe('GET /modulo ...')` 块（与现有 5 个 describe 块平级），覆盖 happy(≥6) + 除零拒(≥2) + strict 拒(≥7 类各 1) + 值 oracle(≥2，至少 1 条负被除数) + 符号不变量 oracle(≥2，含负正) + schema oracle(≥1) + 失败 body 不含 remainder(≥1) + 5 条现有路由回归各 1 条。
- `playground/README.md` — 端点列表加 `/modulo` 行；新增 `### \`GET /modulo\` 示例` 段，含 happy / `b=0` 拒 / 符号语义 / strict 拒 各 ≥1 个示例。

**大小**: M (100-300 行，主要测试覆盖)
**依赖**: 无（单 workstream，无前置）

**BEHAVIOR 覆盖测试文件**: `tests/ws1/modulo.test.ts`（TDD red 阶段，generator 起服务真验证；evaluator 不读 vitest，只跑 DoD 文件 manual:bash）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红 it() 清单（≥6 条具名）+ 未实现时失败原因 |
|---|---|---|---|
| WS1 | `tests/ws1/modulo.test.js` | modulo、oracle、符号不变量、除零兜底、反向 schema、不含 remainder、REG /health、REG /sum、REG /multiply、REG /divide、REG /power | 见下方"预期红 it() 清单"段（10 条具名 test，全部对应到 `tests/ws1/modulo.test.js` 实际行号），实现前 vitest 全红 |

### 预期红 it() 清单（evaluator 可直接 grep 验证 `tests/ws1/modulo.test.js` 字面量）

> 全部 10 条均为 `tests/ws1/modulo.test.js` 中实际存在的 `test('...')` 字面量，evaluator 可用 `grep -c "test('GET /modulo"` + `grep -c "test('REG /"` 验证清单完整性，再跑 `vitest run` 验证未实现时全红。

| # | 具名 test | 实测行号 | 未实现时失败原因 |
|---|---|---|---|
| 1 | `test('GET /modulo?a=5&b=3 → 200 + {remainder:2} (正正整数 happy)', ...)` | tests/ws1/modulo.test.js:8 | 端点不存在 → supertest 收 404，`expect(res.status).toBe(200)` fail |
| 2 | `test('GET /modulo?a=-5&b=3 → 200 + {remainder:-2} (符号跟随被除数 -5，floored mod 实现必挂)', ...)` | tests/ws1/modulo.test.js:69 | 端点未实现 → 404；若 generator 用 floored mod `((a%b)+b)%b` → 返 1 而非 -2，`toEqual({remainder:-2})` fail |
| 3 | `test('GET /modulo?a=-5&b=3 → Math.sign(remainder) === -1 (符号不变量探针 #1，负被除数)', ...)` | tests/ws1/modulo.test.js:75 | 端点未实现 → res.body.remainder undefined，`Math.sign(undefined)` 为 NaN，`toBe(-1)` fail；floored mod 实现 → Math.sign 返 1 而非 -1 → fail（**W23 核心符号不变量探针**） |
| 4 | `test('GET /modulo?a=5&b=-3 → Math.sign(remainder) === 1 (符号不变量探针 #2，正被除数 + 负除数)', ...)` | tests/ws1/modulo.test.js:88 | 端点未实现 → fail；floored mod → Math.sign 返 -1 而非 1 → fail |
| 5 | `test('GET /modulo?a=5&b=0 → 400 + 非空 error + body 不含 remainder (除零兜底)', ...)` | tests/ws1/modulo.test.js:124 | 端点未实现 → 404 而非 400，`toBe(400)` fail；若 generator 漏掉除零拒 → JS `5 % 0 === NaN` → 即使返 200/500 都和 toBe(400) 不符 → fail |
| 6 | `test('GET /modulo?a=0&b=0 → 400 + 非空 error + body 不含 remainder (0%0 也归此分支)', ...)` | tests/ws1/modulo.test.js:132 | 端点未实现 → fail；漏除零分支 → fail（0%0 === NaN） |
| 7 | `test('GET /modulo?a=1e3&b=2 (科学计数法) → 400 + body 不含 remainder', ...)` | tests/ws1/modulo.test.js:182 | 端点未实现 → fail；若 generator 用 `Number(a)`/`parseFloat` 而非 strict 正则 → 1e3 通过返 200 而非 400 → fail（strict-schema 探针） |
| 8 | `test('GET /modulo?a=5&b=3 响应顶层 keys 严格等于 ["remainder"] (schema oracle)', ...)` | tests/ws1/modulo.test.js:103 | 端点未实现 → res.body 为 {} → `Object.keys` 为 [] → toEqual([\"remainder\"]) fail；若 generator 漂移到 `result`/加 `operation` → keys 不严格等于 → fail |
| 9 | `test('GET /modulo?a=5&b=3 成功响应不含禁用同义字段 (反向 schema 完整性探针)', ...)` | tests/ws1/modulo.test.js:109 | 端点未实现 → fail；若 generator 把字段名漂移到 `result`/`mod`/`product`/`quotient` 等 25 个禁用字段任一 → `not.toHaveProperty` fail（**反向漂移防御探针**） |
| 10 | `test('GET /modulo?a=foo&b=3 错误响应顶层 keys 严格等于 ["error"]', ...)` | tests/ws1/modulo.test.js:257 | 端点未实现 → fail；若 generator 错误响应用 `message`/`msg`/`reason`/`detail` 同义替代 → keys 不严格 → fail |

**evaluator 验证脚本**（自动审查清单完整性 + Red evidence）：

```bash
TF=sprints/w23-playground-modulo/tests/ws1/modulo.test.js

# 1. it() 清单存在性（≥10 条 test，远超阈值 6）
COUNT=$(grep -cE "^\s*test\(" "$TF")
[ "$COUNT" -ge 10 ] || { echo "FAIL: test() 数 $COUNT < 10"; exit 1; }

# 2. 关键探针字面量存在（用 grep -F 避免正则转义）
grep -qF "remainder: -2" "$TF" || { echo "FAIL: 缺 floored mod 探针 -5%3 (期望 remainder: -2)"; exit 1; }
grep -qF "Math.sign(res.body.remainder)" "$TF" || { echo "FAIL: 缺符号不变量断言"; exit 1; }
grep -qF "toEqual(['remainder'])" "$TF" || { echo "FAIL: 缺严 schema 断言 toEqual(['remainder'])"; exit 1; }
grep -qF "not.toHaveProperty('remainder')" "$TF" || { echo "FAIL: 缺失败响应不含 remainder 断言"; exit 1; }
grep -qF "toEqual(['error'])" "$TF" || { echo "FAIL: 缺错误响应严 schema toEqual(['error'])"; exit 1; }

# 3. 实现前必红（端点不存在 → 404）
cd playground && npx vitest run ../sprints/w23-playground-modulo/tests/ws1/modulo.test.js --reporter=verbose 2>&1 | tee /tmp/red.log
grep -E "FAIL|✗|failed" /tmp/red.log || { echo "ERROR: 测试未产生 Red"; exit 1; }
echo "✅ 预期红清单 + Red evidence 全过"
```

---

## Risks & Mitigations（GAN Round 2 反馈强化）

> Reviewer Round 1 反馈：合同需显式列举高风险失败模式 + 对应 mitigation 命令，evaluator 跑时不能因为前置 Step 红而误绿后续 Step。本段把 4 类 high-impact risk 写成"风险/影响/Mitigation 命令"三段式，每条 Mitigation 都对应到上面 Step 1-7 的具体可执行验证命令。

### Risk 1: 除零兜底缺失（generator 漏掉 `b=0` 显式拒，导致 5%0 返 NaN 或 500）

- **影响**: JS 原生 `5 % 0 === NaN`，若 generator 直接 `return {remainder: a%b}`，会返 `{remainder: null}` (JSON 不能序列化 NaN) 或 `{remainder: NaN}` 同时 status=200，违反"b=0 必拒 400"硬约束。
- **Mitigation**: Step 3 验证 4 类 `b=0` 输入（`a=5&b=0` / `a=0&b=0` / `a=-5&b=0` / `a=5&b=0.0`）全返 400 + body 不含 `remainder`。E2E 脚本 [4/7] 段同款检查；任一 200 → exit 1。

### Risk 2: floored mod 漂移（generator 错用 `((a%b)+b)%b` 而非 JS 原生 `%`）

- **影响**: `-5%3` JS truncated 应返 -2，floored mod 会返 1（符号跟随除数 b 而非被除数 a），同时 `5%-3` floored 会返 -1 而非 2。**值正确但语义错**——若 evaluator 只跑标准 oracle（值复算）会被绕过；必须配 Math.sign 不变量两层断言才能抓住。
- **Mitigation**: Step 5 双层断言——(1) 值复算 `jq -e '.remainder == -2'` (2) 符号不变量 `Math.sign(remainder) === Math.sign(a)` 当 a≠0；任一不过 exit 1。覆盖 `a=-5&b=3`（期望 sign=-1）+ `a=5&b=-3`（期望 sign=1）+ `a=-5&b=-3`（期望 sign=-1）三类。E2E 脚本 [2/7] 段同款。

### Risk 3: cascade 失败（前置 Step 红但 evaluator 继续跑后续 Step，污染 verdict）

- **影响**: 若 Step 1（入口端点存在）已 fail（404），Step 2-7 的 jq -e 断言会因 RESP 为空字符串而 silent skip 或假绿，导致 evaluator 输出"7/7 PASS"实际上 endpoint 没挂。
- **Mitigation**: E2E 脚本顶 `set -e`（已在 contract-draft Line 237 注入），任一命令非 0 立即整脚本退出。每个 jq -e 失败都用 `|| { echo "FAIL: ..."; exit 1; }` 显式中断；Step 1-7 内部 for 循环里也都是 `kill $SPID; exit 1` 非 0 即退。

### Risk 4: generator 漂移字段名（响应字段从 `remainder` 漂到 `result` / `mod` / `product` / `quotient` 等 W19~W22 同义名）

- **影响**: W19 `/sum` → `sum`、W20 `/multiply` → `product`、W21 `/divide` → `quotient`、W22 `/power` → `power`，generator 倾向于把 `/modulo` 字段写成 generic `result` 或前序同义 `product`/`mod`/`rem`。若 evaluator 只验"值正确"会过；必须配 25 字段反向 `has(...) | not` 全检 + `keys == ["remainder"]` 严 schema 双层断言。
- **Mitigation**: Step 4 列 25 个禁用字段（`result` / `value` / `answer` / `mod` / `modulo` / `rem` / `rest` / `residue` / `out` / `output` / `data` / `payload` / `response` / `sum` / `product` / `quotient` / `power` / `operation` / `a` / `b` / `input` / `dividend` / `divisor` / `numerator` / `denominator`）反向 `jq -e 'has("$f") | not'` 全检。E2E [3/7] 段同款；任一 has → exit 1。配对 `jq -e 'keys == ["remainder"]'` 严 schema 锁顶层 keys 严格唯一。错误响应另含 8 个禁用字段反向（`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `remainder`）。

---

## Reviewer Round 1 反馈处理对照表

| Reviewer 反馈 | 本轮处理位置 | 状态 |
|---|---|---|
| Risk 列表（含 4 个 Risk + Mitigation） | 本文件 ## Risks & Mitigations 段 | ✅ 新增 |
| 值复算 + Math.sign 不变量两层断言 | Step 5 + Risk 2 + 测试 #69-99 | ✅ 已存（明确化）|
| E2E 脚本顶 `set -e`（cascade 防御） | E2E 段 Line 237 + Risk 3 | ✅ 已存（明确化）|
| 25 个禁用字段反向 `has(...) \| not` 全检 | Step 4 + E2E [3/7] + Risk 4 + DoD ARTIFACT #41 | ✅ 已存（明确化）|
| Test Contract 加"预期红 it() 清单"列（≥6 条具名 it + 未实现失败原因） | 本文件 ### 预期红 it() 清单 段（10 条具名 test，超阈值 6）| ✅ 新增 |
| evaluator 可 grep test 文件验证 it 存在 + 跑 vitest 必红 | 本文件 evaluator 验证脚本段 | ✅ 新增 |
