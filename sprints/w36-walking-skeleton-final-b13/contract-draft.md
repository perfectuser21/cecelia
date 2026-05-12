# Sprint Contract Draft (Round 1)

## Golden Path

[HTTP 客户端发 GET /decrement?value=<整数字符串>] → [playground server 启动并监听端口；按 strict-schema `^-?\d+$` 校验 value；查 query keys 集合恰好 ["value"]；显式拒 `|Number(value)| > 9007199254740990`；计算 `Number(value) - 1`] → [200 响应，body 顶层 keys 字面 sort 等于 ["operation","result"]，`result === Number(value) - 1`，`operation === "decrement"` 字面字符串严格相等；非法输入 / 缺参 / 错 query 名 / 超界 → 400 + `{error: <非空字符串>}`，body 顶层 keys 字面 sort 等于 ["error"]，不含 result/operation]

---

### Step 1: 启 playground server

**可观测行为**: 在指定端口启动 express server；`/health` 返 `{ok:true}` 证明 8 路由前缀仍存活；新增 `/decrement` 路由已注册（未实现时是 404；实现后是 400 缺参）。

**验证命令**:
```bash
# 假设 cwd=playground
PLAYGROUND_PORT=3100 node server.js &
SPID=$!
sleep 2
# 1. 健康检查仍存活（不破坏既有路由）
curl -fs "localhost:3100/health" | jq -e '.ok == true' || { echo "FAIL: /health 不可用"; kill $SPID; exit 1; }
# 2. /decrement 路由已注册（无参访问应是 400 而非 404）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3100/decrement")
[ "$CODE" = "400" ] || { echo "FAIL: /decrement 路由未注册，返回 $CODE"; kill $SPID; exit 1; }
kill $SPID
echo OK
```

**硬阈值**: `/health` 返 `{ok:true}` 且 `/decrement` 无参访问返 HTTP 400（不是 404）。

---

### Step 2: happy path 值复算 + 顶层 keys 集合相等 + operation 字面字符串严格相等

**可观测行为**: 对合法整数输入返 200 + `{result: Number(value)-1, operation: "decrement"}`；顶层 keys 字面 sort 等于 `["operation","result"]`；operation 字面字符串严格等于 `"decrement"`；result 类型为 number。

**验证命令**:
```bash
PLAYGROUND_PORT=3101 node server.js & SPID=$!
sleep 2

# 中段：value=5 → result=4
RESP=$(curl -fs "localhost:3101/decrement?value=5")
echo "$RESP" | jq -e '.result == 4' || { echo "FAIL: value=5 result 应为 4"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: operation 必须字面字符串 \"decrement\""; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.result | type == "number"' || { echo "FAIL: result 必须为 number 类型"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { echo "FAIL: keys 集合必须严格等于 [operation,result]"; kill $SPID; exit 1; }

# off-by-one 防盲抄 W26：value=0 → result=-1（不是 +1）
RESP=$(curl -fs "localhost:3101/decrement?value=0")
echo "$RESP" | jq -e '.result == -1' || { echo "FAIL: value=0 result 应为 -1（不是 +1，防盲抄 W26 increment）"; kill $SPID; exit 1; }

# off-by-one 防盲抄 W26：value=1 → result=0
RESP=$(curl -fs "localhost:3101/decrement?value=1")
echo "$RESP" | jq -e '.result == 0' || { echo "FAIL: value=1 result 应为 0"; kill $SPID; exit 1; }

# 负侧：value=-5 → result=-6
RESP=$(curl -fs "localhost:3101/decrement?value=-5")
echo "$RESP" | jq -e '.result == -6' || { echo "FAIL: value=-5 result 应为 -6"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 4 项 jq -e 断言全 exit 0；`value=0 → -1` 与 `value=1 → 0` 必须显式过（防 generator 抄 W26 的 `+1`）。

---

### Step 3: 精度上下界 happy（边界精度无损）

**可观测行为**: 在精度上界 / 下界 ±9007199254740990 内，`Number(value) - 1` 仍精确无浮点损失。

**验证命令**:
```bash
PLAYGROUND_PORT=3102 node server.js & SPID=$!
sleep 2

# 上界 happy：value=9007199254740990 → result=9007199254740989
RESP=$(curl -fs "localhost:3102/decrement?value=9007199254740990")
echo "$RESP" | jq -e '.result == 9007199254740989' || { echo "FAIL: 上界 happy 应返 9007199254740989"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: 上界 happy operation 字面错"; kill $SPID; exit 1; }

# 下界 happy：value=-9007199254740990 → result=-9007199254740991（注意：W26 increment 下界是 -9007199254740989，W36 decrement 下界是 -9007199254740991，不可混淆）
RESP=$(curl -fs "localhost:3102/decrement?value=-9007199254740990")
echo "$RESP" | jq -e '.result == -9007199254740991' || { echo "FAIL: 下界 happy 应返 -9007199254740991（不是 W26 增量 -9007199254740989）"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 上下界精度 happy 各 1 项断言通过。

---

### Step 4: 上下界拒（绝对值 > 9007199254740990）

**可观测行为**: `|Number(value)| > 9007199254740990` 时返 HTTP 400，body 顶层 keys = ["error"]，不含 result，不含 operation。

**验证命令**:
```bash
PLAYGROUND_PORT=3103 node server.js & SPID=$!
sleep 2

# 上界 +1 拒：value=9007199254740991 → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3103/decrement?value=9007199254740991")
[ "$CODE" = "400" ] || { echo "FAIL: 上界+1 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 上界拒响应体严 schema：keys=[error]，不含 result/operation
RESP=$(curl -s "localhost:3103/decrement?value=9007199254740991")
echo "$RESP" | jq -e 'keys | sort == ["error"]' || { echo "FAIL: 上界拒错误体 keys 应为 [error]"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 错误体不应含 result"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("operation") | not' || { echo "FAIL: 错误体不应含 operation"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.error | type == "string" and length > 0' || { echo "FAIL: error 应为非空字符串"; kill $SPID; exit 1; }

# 下界 -1 拒：value=-9007199254740991 → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3103/decrement?value=-9007199254740991")
[ "$CODE" = "400" ] || { echo "FAIL: 下界-1 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 远超上界拒：value=99999999999999999999 → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3103/decrement?value=99999999999999999999")
[ "$CODE" = "400" ] || { echo "FAIL: 远超上界 应 400，实得 $CODE"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 6 项断言全过，含错误体 schema 完整性 + result/operation 反向缺失。

---

### Step 5: strict-schema 拒（小数 / 前导 + / 双重负号 / 科学计数 / 十六进制 / 千分位 / 空白 / 字母 / 空串 / Infinity / NaN）

**可观测行为**: 任一不匹配 `^-?\d+$` 的输入返 400 + 错误体 schema 完整。

**验证命令**:
```bash
PLAYGROUND_PORT=3104 node server.js & SPID=$!
sleep 2

# 用循环挨个拒——任一不返 400 即 FAIL
for V in "1.5" "1.0" "+5" "--5" "5-" "1e2" "0xff" "1,000" "1 000" "" "abc" "Infinity" "NaN" "-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --get --data-urlencode "value=$V" "localhost:3104/decrement")
  if [ "$CODE" != "400" ]; then
    echo "FAIL: strict 拒 value='$V' 应 400，实得 $CODE"
    kill $SPID
    exit 1
  fi
done

# 任一 strict 拒响应体严 schema：keys=[error]
RESP=$(curl -s "localhost:3104/decrement?value=1.5")
echo "$RESP" | jq -e 'keys | sort == ["error"]' || { echo "FAIL: strict 拒错误体 keys 应为 [error]"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: strict 拒错误体不应含 result"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("operation") | not' || { echo "FAIL: strict 拒错误体不应含 operation"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 14 项 strict-schema 拒输入全 400 + 错误体 schema 完整。

---

### Step 6: 错 query 名 + 缺参 + 前导 0 happy

**可观测行为**:
- 缺 value 参数返 400
- 错 query 名（`n` / `a` / `x` 等）返 400
- 前导 0 `01` / `-01` 走过 strict 后归一化为 1 / -1，返 happy（不许错用八进制解析）

**验证命令**:
```bash
PLAYGROUND_PORT=3105 node server.js & SPID=$!
sleep 2

# 缺 value 参数（无 query）：400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3105/decrement")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 value 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 错 query 名 n=5：400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3105/decrement?n=5")
[ "$CODE" = "400" ] || { echo "FAIL: 错 query 名 n=5 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 错 query 名 a=5：400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3105/decrement?a=5")
[ "$CODE" = "400" ] || { echo "FAIL: 错 query 名 a=5 应 400，实得 $CODE"; kill $SPID; exit 1; }

# 前导 0 happy：value=01 → result=0（不是八进制）
RESP=$(curl -fs "localhost:3105/decrement?value=01")
echo "$RESP" | jq -e '.result == 0' || { echo "FAIL: value=01 应返 result=0（十进制归一化，不是八进制）"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: value=01 operation 字面错"; kill $SPID; exit 1; }

# 前导 0 负侧：value=-01 → result=-2
RESP=$(curl -fs "localhost:3105/decrement?value=-01")
echo "$RESP" | jq -e '.result == -2' || { echo "FAIL: value=-01 应返 result=-2"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 5 项断言全过。

---

### Step 7: 禁用字段名反向断言（PR-G 死规则黑名单）

**可观测行为**: response body 不含 PRD 禁用清单的任一字段名（防 generator/proposer 漂到同义词）。

**验证命令**:
```bash
PLAYGROUND_PORT=3106 node server.js & SPID=$!
sleep 2

RESP=$(curl -fs "localhost:3106/decrement?value=5")

# PR-G 死规则黑名单：首要禁用 + 泛 generic 禁用 + 复用其他 endpoint 字段名禁用
for K in decremented previous prev predecessor n_minus_one minus_one pred dec decr decrementation subtraction value input output data payload response answer out meta sum product quotient power remainder factorial negation; do
  echo "$RESP" | jq -e --arg k "$K" 'has($k) | not' > /dev/null || { echo "FAIL: response 含禁用字段 $K"; kill $SPID; exit 1; }
done

# operation 字面字符串严格相等，禁用变体
echo "$RESP" | jq -e '.operation == "decrement"' || { echo "FAIL: operation 必须字面 \"decrement\""; kill $SPID; exit 1; }
for V in dec decr decremented decrementation minus_one sub_one subtract_one pred predecessor prev previous; do
  echo "$RESP" | jq -e --arg v "$V" '.operation != $v' > /dev/null || { echo "FAIL: operation 不应是变体 $V"; kill $SPID; exit 1; }
done

kill $SPID
echo OK
```

**硬阈值**: 24 项禁用字段名反向 has() 全 false + 10 项 operation 变体反向相等全 false。

---

### Step 8: 8 路由回归（不破坏既有路由）

**可观测行为**: 8 条既有路由各 1 条 happy 用例仍 200。

**验证命令**:
```bash
PLAYGROUND_PORT=3107 node server.js & SPID=$!
sleep 2

curl -fs "localhost:3107/health" | jq -e '.ok == true' || { echo "FAIL: /health 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/sum?a=3&b=4" | jq -e '.sum == 7' || { echo "FAIL: /sum 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/multiply?a=3&b=4" | jq -e '.product == 12' || { echo "FAIL: /multiply 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/divide?a=12&b=4" | jq -e '.quotient == 3' || { echo "FAIL: /divide 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/power?a=2&b=10" | jq -e '.power == 1024' || { echo "FAIL: /power 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/modulo?a=10&b=3" | jq -e '.remainder == 1' || { echo "FAIL: /modulo 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/factorial?n=5" | jq -e '.factorial == 120' || { echo "FAIL: /factorial 回归"; kill $SPID; exit 1; }
curl -fs "localhost:3107/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { echo "FAIL: /increment 回归"; kill $SPID; exit 1; }

kill $SPID
echo OK
```

**硬阈值**: 8 项 happy 全 200 + jq -e 断言全过。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:

```bash
#!/bin/bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/playground"

# 1. 装依赖（如未装）
[ -d node_modules ] || npm ci --silent

# 2. 单测必须全过（vitest 含 Step 2~8 所有断言对应的 it() 块）
NODE_ENV=test npx vitest run tests/server.test.js --reporter=verbose

# 3. 真起 server 跑 Step 1~8 全部 manual:bash 验证
PLAYGROUND_PORT=3199 node server.js &
SPID=$!
trap "kill $SPID 2>/dev/null || true" EXIT
sleep 2

# Step 1: /health + /decrement 路由已注册
curl -fs "localhost:3199/health" | jq -e '.ok == true'
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3199/decrement")
[ "$CODE" = "400" ]

# Step 2: 中段 + off-by-one + 负侧
curl -fs "localhost:3199/decrement?value=5" | jq -e '.result == 4 and .operation == "decrement"'
curl -fs "localhost:3199/decrement?value=0" | jq -e '.result == -1'
curl -fs "localhost:3199/decrement?value=1" | jq -e '.result == 0'
curl -fs "localhost:3199/decrement?value=-5" | jq -e '.result == -6'

# Step 3: 上下界 happy
curl -fs "localhost:3199/decrement?value=9007199254740990" | jq -e '.result == 9007199254740989'
curl -fs "localhost:3199/decrement?value=-9007199254740990" | jq -e '.result == -9007199254740991'

# Step 4: 上下界拒 + 错误体 schema
for V in "9007199254740991" "-9007199254740991" "99999999999999999999"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --get --data-urlencode "value=$V" "localhost:3199/decrement")
  [ "$CODE" = "400" ]
done
RESP=$(curl -s "localhost:3199/decrement?value=9007199254740991")
echo "$RESP" | jq -e 'keys | sort == ["error"]'
echo "$RESP" | jq -e 'has("result") | not'
echo "$RESP" | jq -e 'has("operation") | not'

# Step 5: strict 拒
for V in "1.5" "1.0" "+5" "--5" "5-" "1e2" "0xff" "1,000" "1 000" "" "abc" "Infinity" "NaN" "-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --get --data-urlencode "value=$V" "localhost:3199/decrement")
  [ "$CODE" = "400" ]
done

# Step 6: 错 query 名 + 缺参 + 前导 0
[ "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:3199/decrement')" = "400" ]
[ "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:3199/decrement?n=5')" = "400" ]
[ "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:3199/decrement?a=5')" = "400" ]
curl -fs "localhost:3199/decrement?value=01" | jq -e '.result == 0 and .operation == "decrement"'
curl -fs "localhost:3199/decrement?value=-01" | jq -e '.result == -2'

# Step 7: 禁用字段反向
RESP=$(curl -fs "localhost:3199/decrement?value=5")
for K in decremented previous prev predecessor n_minus_one minus_one pred dec decr decrementation subtraction value input output data payload response answer out meta sum product quotient power remainder factorial negation; do
  echo "$RESP" | jq -e --arg k "$K" 'has($k) | not' > /dev/null
done

# Step 8: 8 路由回归
curl -fs "localhost:3199/sum?a=3&b=4" | jq -e '.sum == 7'
curl -fs "localhost:3199/multiply?a=3&b=4" | jq -e '.product == 12'
curl -fs "localhost:3199/divide?a=12&b=4" | jq -e '.quotient == 3'
curl -fs "localhost:3199/power?a=2&b=10" | jq -e '.power == 1024'
curl -fs "localhost:3199/modulo?a=10&b=3" | jq -e '.remainder == 1'
curl -fs "localhost:3199/factorial?n=5" | jq -e '.factorial == 120'
curl -fs "localhost:3199/increment?value=5" | jq -e '.result == 6 and .operation == "increment"'

echo "✅ W36 /decrement Golden Path 全 8 步验证通过"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground GET /decrement endpoint + 单测 + README

**范围**: 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /decrement` 路由（query 名 `value`，strict-schema `^-?\d+$`，`|Number(value)| > 9007199254740990` 显式拒，`Number(value) - 1` 算术，返回 `{result, operation: "decrement"}`）；在 `playground/tests/server.test.js` 新增 `describe('GET /decrement', ...)` 块；在 `playground/README.md` 加 `/decrement` 段（happy / 上下界拒 / strict 拒 至少 6 个示例）。零依赖，不动既有 8 条路由。

**大小**: M（约 60~90 行新增：server.js ~15 行、tests ~60 行、README ~15 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/decrement.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/decrement.test.ts` | 路由存在、值复算、off-by-one、上下界精度 happy、上下界拒、strict-schema 拒、错 query 名、缺参、前导 0、禁用字段反向、operation 字面字符串、错误体 schema 完整性、8 路由回归 | WS1 → N failures（generator 实现前 `/decrement` 不存在，所有断言失败）|

