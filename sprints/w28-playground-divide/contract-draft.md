# Sprint Contract Draft (Round 2) — W28 playground /divide 响应形态统一为 `{result, operation: "divide"}`（pre-merge gate 真验收）

> **Round 2 修订点**（响应 Reviewer round 1 REVISION 反馈）：
> - 错误路径 oracle 新增 PRD 错误响应禁用替代名（`message`/`msg`/`reason`/`detail`/`details`/`description`/`info`/`code`/`status`/`kind`）反向不存在断言，覆盖 b=0 拒（Step 3）+ strict 拒（Step 4）+ E2E 全脚本
> - 成功响应禁用字段反向断言补全 PRD 字面禁用清单：新增 `divisor_result` / `divide_result` / `numerator` / `denominator` / `input` / `response` / `out`

## Golden Path

```
[HTTP 客户端发 GET /divide?a=6&b=2]
  → [playground server: 缺参检查 → strict-schema `^-?\d+(\.\d+)?$` 校验 a/b → 显式判 Number(b)===0 → 计算 Number(a)/Number(b)]
  → [200 + body 字面 {result: 3, operation: "divide"}，顶层 keys 严格集合相等 ["operation","result"]，禁用字段 quotient/division/divided/div/value/dividend/divisor/ratio/share 全不存在]
```

---

### Step 1: 客户端发 `GET /divide?a=6&b=2`（happy path 触发）

**可观测行为**: 服务端在毫秒级（< 100 ms）返回 HTTP 200，body 是 JSON `{"result": 3, "operation": "divide"}`，且顶层 keys 集合（按字母序）**严格等于** `["operation","result"]`，没有任何其他附加字段（如 `quotient` / `dividend` / `divisor` / `value` 等）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3101 NODE_ENV=production node server.js & SPID=$!
sleep 1
RESP=$(curl -fs "localhost:3101/divide?a=6&b=2")
echo "$RESP" | jq -e '.result == 3'                         || { echo "FAIL: result≠3"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "divide"'               || { echo "FAIL: operation 不是字面 divide"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { echo "FAIL: keys 集合不等"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("quotient") | not'                || { echo "FAIL: 禁用字段 quotient 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("divisor_result") | not'          || { echo "FAIL: 禁用字段 divisor_result 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("divide_result") | not'           || { echo "FAIL: 禁用字段 divide_result 漏网"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 1 happy 通过"
```

**硬阈值**:
- HTTP 200
- `.result == 3`（严格相等，number 类型）
- `.operation == "divide"`（**字面**字符串严格相等，不许 `"div"` / `"division"`）
- `keys | sort == ["operation","result"]`（集合严格相等，不许多余字段）
- `has("quotient") | not`（W21 历史字段名必须消失）

---

### Step 2: strict-schema oracle — 不能整除浮点 + 负数 + 0/N + 小数

**可观测行为**: 服务端对合法浮点输入按 JS Number 原生除法返回，evaluator 用同表达式 `Number(a)/Number(b)` 独立复算 `toBe` 严格相等；负数 / 双负 / 零被除数都按算术规则正确返回；operation 始终字面 `"divide"`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3102 NODE_ENV=production node server.js & SPID=$!
sleep 1
# 不能整除浮点：1/3
curl -fs "localhost:3102/divide?a=1&b=3" | jq -e --argjson e "$(node -e 'process.stdout.write(String(1/3))')" '.result == $e and .operation == "divide"' \
  || { echo "FAIL: 1/3 oracle"; kill $SPID; exit 1; }
# 不能整除浮点：10/3
curl -fs "localhost:3102/divide?a=10&b=3" | jq -e --argjson e "$(node -e 'process.stdout.write(String(10/3))')" '.result == $e' \
  || { echo "FAIL: 10/3 oracle"; kill $SPID; exit 1; }
# 小数除小数
curl -fs "localhost:3102/divide?a=1.5&b=0.5" | jq -e '.result == 3 and .operation == "divide"' \
  || { echo "FAIL: 1.5/0.5"; kill $SPID; exit 1; }
# 负被除数
curl -fs "localhost:3102/divide?a=-6&b=2"  | jq -e '.result == -3 and .operation == "divide"' \
  || { echo "FAIL: -6/2"; kill $SPID; exit 1; }
# 负除数
curl -fs "localhost:3102/divide?a=6&b=-2"  | jq -e '.result == -3 and .operation == "divide"' \
  || { echo "FAIL: 6/-2"; kill $SPID; exit 1; }
# 双负
curl -fs "localhost:3102/divide?a=-6&b=-2" | jq -e '.result == 3  and .operation == "divide"' \
  || { echo "FAIL: -6/-2"; kill $SPID; exit 1; }
# 被除数 0
curl -fs "localhost:3102/divide?a=0&b=5"   | jq -e '.result == 0  and .operation == "divide"' \
  || { echo "FAIL: 0/5"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 2 strict-schema oracle 通过"
```

**硬阈值**:
- 全部 7 条 oracle 严格相等通过（独立 Node 复算 `Number(a)/Number(b)` 与 server 返回 `.result` 完全相等）
- 每条 happy 响应都满足 `.operation == "divide"` 字面值

---

### Step 3: b=0 除零拒（保留 W21 行为；body 不含 result / operation）

**可观测行为**: 当 `Number(b) === 0`（含 `b=0`、`b=0.0`、`b=-0`、`a=0&b=0`）服务端返回 HTTP 400 + body `{"error": <非空字符串>}`，顶层 keys 严格等于 `["error"]`，body **不含** `result` 字段，**不含** `operation` 字段。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3103 NODE_ENV=production node server.js & SPID=$!
sleep 1
for QUERY in "a=5&b=0" "a=0&b=0" "a=6&b=0.0" "a=6&b=-0"; do
  CODE=$(curl -s -o /tmp/divz.json -w "%{http_code}" "localhost:3103/divide?$QUERY")
  [ "$CODE" = "400" ] || { echo "FAIL: $QUERY → $CODE，期望 400"; kill $SPID; exit 1; }
  jq -e '.error | type == "string" and length > 0' /tmp/divz.json \
    || { echo "FAIL: $QUERY → error 不是非空 string"; kill $SPID; exit 1; }
  jq -e 'has("result") | not'    /tmp/divz.json || { echo "FAIL: $QUERY → 错误体含 result"; kill $SPID; exit 1; }
  jq -e 'has("operation") | not' /tmp/divz.json || { echo "FAIL: $QUERY → 错误体含 operation"; kill $SPID; exit 1; }
  jq -e 'keys | sort == ["error"]' /tmp/divz.json || { echo "FAIL: $QUERY → 错误 keys 集合不等"; kill $SPID; exit 1; }
  # Round 2 新增：PRD 错误响应禁用替代名反向不存在
  for K in message msg reason detail details description info code status kind; do
    jq -e --arg k "$K" 'has($k) | not' /tmp/divz.json \
      || { echo "FAIL: $QUERY → 错误 body 含 PRD 禁用替代名 $K"; kill $SPID; exit 1; }
  done
done
kill $SPID
echo "✅ Step 3 除零拒通过（4 种 b=0 变体全挡 + 10 种禁用替代名反向全过）"
```

**硬阈值**:
- 4 种 b=0 变体（`b=0` / `a=0&b=0` / `b=0.0` / `b=-0`）全部返回 HTTP 400
- 错误响应 `keys | sort == ["error"]`（不许多余字段）
- 错误响应不含 `result`，不含 `operation`
- 错误响应不含 PRD 错误响应禁用替代名（`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code` / `status` / `kind` 10 个）

---

### Step 4: strict-schema 拒（科学计数法 / Infinity / 前导 + / 十六进制 / 千分位 / 空串 / 缺参）

**可观测行为**: 服务端对**任何不完整匹配** `^-?\d+(\.\d+)?$` 的输入返回 HTTP 400 + `{"error": <非空字符串>}`，body 不含 `result` 也不含 `operation`。`Number()`/`parseFloat()` 假绿值（如 `1e3` 被 `Number()` 转 1000）必须被 regex 挡住。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3104 NODE_ENV=production node server.js & SPID=$!
sleep 1
# 科学计数法 / Infinity / 前导 + / 十六进制 / 千分位 / 空串 / 缺参 / 非数字 / 缺小数 / 缺整数
declare -a CASES=(
  "a=1e3&b=2"        # 科学计数法
  "a=Infinity&b=2"   # Infinity
  "a=6&b=NaN"        # NaN
  "a=%2B6&b=2"       # 前导 +6（URL 编码）
  "a=.5&b=2"         # 小数点缺整数部分
  "a=6.&b=2"         # 小数点缺小数部分
  "a=0xff&b=2"       # 十六进制
  "a=1%2C000&b=2"    # 千分位（URL 编码逗号）
  "a=&b=3"           # 空串
  "a=abc&b=3"        # 非数字
  "a=6"              # 缺 b
  "b=2"              # 缺 a
  ""                 # 双缺
)
for CASE in "${CASES[@]}"; do
  CODE=$(curl -s -o /tmp/divs.json -w "%{http_code}" "localhost:3104/divide?$CASE")
  [ "$CODE" = "400" ] || { echo "FAIL: '$CASE' → $CODE，期望 400"; kill $SPID; exit 1; }
  jq -e '.error | type == "string" and length > 0' /tmp/divs.json \
    || { echo "FAIL: '$CASE' → error 不是非空 string"; kill $SPID; exit 1; }
  jq -e 'has("result") | not'    /tmp/divs.json || { echo "FAIL: '$CASE' → 错误体含 result"; kill $SPID; exit 1; }
  jq -e 'has("operation") | not' /tmp/divs.json || { echo "FAIL: '$CASE' → 错误体含 operation"; kill $SPID; exit 1; }
  jq -e 'keys | sort == ["error"]' /tmp/divs.json || { echo "FAIL: '$CASE' → 错误 keys 集合不等"; kill $SPID; exit 1; }
  # Round 2 新增：PRD 错误响应禁用替代名反向不存在
  for K in message msg reason detail details description info code status kind; do
    jq -e --arg k "$K" 'has($k) | not' /tmp/divs.json \
      || { echo "FAIL: '$CASE' → 错误 body 含 PRD 禁用替代名 $K"; kill $SPID; exit 1; }
  done
done
kill $SPID
echo "✅ Step 4 strict-schema 拒 13 种变体全挡 + 10 种禁用替代名反向全过"
```

**硬阈值**:
- 全部 13 种非法输入返回 HTTP 400
- 全部错误响应满足 `error` 是非空 string + `keys | sort == ["error"]` + 不含 `result` + 不含 `operation`
- 全部错误响应不含 PRD 错误响应禁用替代名（`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code` / `status` / `kind` 10 个）

---

### Step 5: 回归不破坏 — `/health`、`/sum`、`/multiply`、`/power`、`/modulo`、`/factorial`、`/increment` 7 条端点保持原形态

**可观测行为**: 除 `/divide` 外其他 7 条端点的响应字段名与值**一字不变**。`/sum` 仍返 `{sum}`，`/multiply` 仍返 `{product}`，`/power` 仍返 `{power}`，`/modulo` 仍返 `{remainder}`，`/factorial` 仍返 `{factorial}`，`/increment` 仍返 `{result, operation: "increment"}`，`/health` 仍返 `{ok: true}`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3105 NODE_ENV=production node server.js & SPID=$!
sleep 1
curl -fs "localhost:3105/health"              | jq -e '.ok == true and (keys | sort == ["ok"])'                                  || { echo "FAIL /health"; kill $SPID; exit 1; }
curl -fs "localhost:3105/sum?a=2&b=3"         | jq -e '.sum == 5 and (keys | sort == ["sum"])'                                   || { echo "FAIL /sum"; kill $SPID; exit 1; }
curl -fs "localhost:3105/multiply?a=2&b=3"    | jq -e '.product == 6 and (keys | sort == ["product"])'                           || { echo "FAIL /multiply"; kill $SPID; exit 1; }
curl -fs "localhost:3105/power?a=2&b=3"       | jq -e '.power == 8 and (keys | sort == ["power"])'                               || { echo "FAIL /power"; kill $SPID; exit 1; }
curl -fs "localhost:3105/modulo?a=7&b=3"      | jq -e '.remainder == 1 and (keys | sort == ["remainder"])'                       || { echo "FAIL /modulo"; kill $SPID; exit 1; }
curl -fs "localhost:3105/factorial?n=5"       | jq -e '.factorial == 120 and (keys | sort == ["factorial"])'                     || { echo "FAIL /factorial"; kill $SPID; exit 1; }
curl -fs "localhost:3105/increment?value=5"   | jq -e '.result == 6 and .operation == "increment" and (keys | sort == ["operation","result"])' || { echo "FAIL /increment"; kill $SPID; exit 1; }
kill $SPID
echo "✅ Step 5 七端点回归全过"
```

**硬阈值**:
- 7 个端点的 happy 响应字段名 / 值 / keys 集合一字不变（任一漂移视为本 PR 误改了不该改的代码）

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: `autonomous`（playground 是独立 HTTP server，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议）

**完整验证脚本**:

```bash
#!/bin/bash
set -euo pipefail

# 1. cd 进入子项目并装依赖（如果没装）
cd playground
[ -d node_modules ] || npm ci --silent

# 2. 起独立端口的 playground server（避开 vitest 默认端口）
export PLAYGROUND_PORT=3199
export NODE_ENV=production
node server.js > /tmp/playground-w28.log 2>&1 &
SPID=$!
trap "kill $SPID 2>/dev/null || true" EXIT
sleep 2

BASE="localhost:${PLAYGROUND_PORT}"

# 3. happy + schema 完整性 + operation 字面 + 禁用字段反向（Round 2 补全 PRD 字面禁用清单）
RESP=$(curl -fs "$BASE/divide?a=6&b=2")
echo "$RESP" | jq -e '.result == 3'                         || exit 1
echo "$RESP" | jq -e '.operation == "divide"'               || exit 1
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || exit 1
for FORBIDDEN in quotient division divided divisor_result divide_result div ratio share value input output data payload response answer out meta dividend divisor numerator denominator sum product power remainder factorial; do
  echo "$RESP" | jq -e --arg k "$FORBIDDEN" 'has($k) | not' || { echo "FAIL: 禁用字段 $FORBIDDEN 漏网"; exit 1; }
done

# 4. oracle 复算 — 不能整除浮点
E13=$(node -e 'process.stdout.write(String(1/3))')
curl -fs "$BASE/divide?a=1&b=3" | jq -e --argjson e "$E13" '.result == $e and .operation == "divide"' || exit 1
E103=$(node -e 'process.stdout.write(String(10/3))')
curl -fs "$BASE/divide?a=10&b=3" | jq -e --argjson e "$E103" '.result == $e' || exit 1
curl -fs "$BASE/divide?a=1.5&b=0.5" | jq -e '.result == 3' || exit 1
curl -fs "$BASE/divide?a=-6&b=2"   | jq -e '.result == -3' || exit 1
curl -fs "$BASE/divide?a=6&b=-2"   | jq -e '.result == -3' || exit 1
curl -fs "$BASE/divide?a=-6&b=-2"  | jq -e '.result == 3'  || exit 1
curl -fs "$BASE/divide?a=0&b=5"    | jq -e '.result == 0'  || exit 1

# 5. b=0 除零拒（4 变体）+ PRD 错误禁用替代名反向（Round 2 新增）
for Q in "a=5&b=0" "a=0&b=0" "a=6&b=0.0" "a=6&b=-0"; do
  CODE=$(curl -s -o /tmp/e.json -w "%{http_code}" "$BASE/divide?$Q")
  [ "$CODE" = "400" ] || exit 1
  jq -e '.error | type == "string" and length > 0' /tmp/e.json || exit 1
  jq -e 'has("result") | not'    /tmp/e.json || exit 1
  jq -e 'has("operation") | not' /tmp/e.json || exit 1
  jq -e 'keys | sort == ["error"]' /tmp/e.json || exit 1
  for K in message msg reason detail details description info code status kind; do
    jq -e --arg k "$K" 'has($k) | not' /tmp/e.json || { echo "FAIL: $Q 错误 body 含 PRD 禁用替代名 $K"; exit 1; }
  done
done

# 6. strict-schema 拒（13 变体）+ PRD 错误禁用替代名反向（Round 2 新增）
for Q in "a=1e3&b=2" "a=Infinity&b=2" "a=6&b=NaN" "a=%2B6&b=2" "a=.5&b=2" "a=6.&b=2" "a=0xff&b=2" "a=1%2C000&b=2" "a=&b=3" "a=abc&b=3" "a=6" "b=2" ""; do
  CODE=$(curl -s -o /tmp/e.json -w "%{http_code}" "$BASE/divide?$Q")
  [ "$CODE" = "400" ] || exit 1
  jq -e '.error | type == "string" and length > 0' /tmp/e.json || exit 1
  jq -e 'has("result") | not'    /tmp/e.json || exit 1
  jq -e 'has("operation") | not' /tmp/e.json || exit 1
  jq -e 'keys | sort == ["error"]' /tmp/e.json || exit 1
  for K in message msg reason detail details description info code status kind; do
    jq -e --arg k "$K" 'has($k) | not' /tmp/e.json || { echo "FAIL: $Q 错误 body 含 PRD 禁用替代名 $K"; exit 1; }
  done
done

# 7. 回归 7 条端点
curl -fs "$BASE/health"            | jq -e '.ok == true'                                                                          || exit 1
curl -fs "$BASE/sum?a=2&b=3"       | jq -e '.sum == 5 and (keys | sort == ["sum"])'                                              || exit 1
curl -fs "$BASE/multiply?a=2&b=3"  | jq -e '.product == 6 and (keys | sort == ["product"])'                                      || exit 1
curl -fs "$BASE/power?a=2&b=3"     | jq -e '.power == 8 and (keys | sort == ["power"])'                                          || exit 1
curl -fs "$BASE/modulo?a=7&b=3"    | jq -e '.remainder == 1 and (keys | sort == ["remainder"])'                                  || exit 1
curl -fs "$BASE/factorial?n=5"     | jq -e '.factorial == 120 and (keys | sort == ["factorial"])'                                || exit 1
curl -fs "$BASE/increment?value=5" | jq -e '.result == 6 and .operation == "increment" and (keys | sort == ["operation","result"])' || exit 1

# 8. 单测全绿
npm test --silent

echo "✅ W28 Golden Path E2E 全部 oracle 通过 + 7 端点回归 + vitest 全绿"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: playground `/divide` 响应形态切换 + 单测 + README

**范围**:
- `playground/server.js`：仅改 `app.get('/divide', ...)` **成功响应**一行（`{quotient: Number(a)/Number(b)}` → `{result: Number(a)/Number(b), operation: 'divide'}`），路由其余代码（缺参 / strict / b=0 拒 / 错误响应）字面不动；其余 7 条路由（/health, /sum, /multiply, /power, /modulo, /factorial, /increment）一字不动
- `playground/tests/server.test.js`：仅改 `describe('GET /divide ...)` 块的全部断言（`res.body.quotient` → `res.body.result` + 新增 `res.body.operation` 字面断言 + 顶层 keys 集合断言 + 错误响应 keys 集合断言 + 错误响应不含 result/operation 断言）；其余 describe 块一字不动
- `playground/README.md`：仅改 `### GET /divide` 段示例响应（`{"quotient": 3}` → `{"result": 3, "operation": "divide"}`）；其余端点段一字不动

**大小**: S（< 100 行修改：server.js ≈ 1 行；test.js ≈ 30-50 行替换 + 新增 schema 断言；README ≈ 5 行）

**依赖**: 无（独立子项目，零新依赖）

**BEHAVIOR 覆盖测试文件**: `tests/ws1/divide.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/divide.test.js` | happy `{result, operation:"divide"}` schema 完整性 / oracle 复算 / b=0 拒错误 schema / strict 拒错误 schema / 禁用字段反向 / 7 端点回归 | 当前 server.js 仍返 `{quotient:3}` → 全部 `result`/`operation`/keys 集合断言 fail（≥ 15 条 expect 失败） |

