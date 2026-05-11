# Sprint Contract Draft (Round 1)

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

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/w23-playground-modulo/tests/ws1/modulo.test.ts` | (1) happy 值复算 (2) 符号不变量 (3) 除零拒 (4) strict 拒 (5) 严 schema (6) 错误 body 不含 remainder | 实现前所有 it() 全 fail（端点不存在 → 404 vs 期望 200/400） |
