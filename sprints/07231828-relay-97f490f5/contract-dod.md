# Contract DoD — GET /sign（playground 第 13 个端点）

## 元信息

- **Sprint**: sprints/07231828-relay-97f490f5
- **Task ID**: 97f490f5-d3d0-499c-835b-b4558406e9d1
- **target_environment**: playground
- **执行方式**: vitest 单元测试 + bash 集成测试

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] 正整数符号函数返回 1

[BEHAVIOR] GET /sign?value=5 → HTTP 200 {result:1, operation:"sign"}；value=9007199254740991 → HTTP 200 {result:1}

**描述**: 当 value 为正整数时，GET /sign 返回 HTTP 200，body 为 `{result: 1, operation: "sign"}`。

**覆盖输入**:
- value=5 → {result:1, operation:"sign"}
- value=1 → {result:1, operation:"sign"}
- value=9007199254740991（Number.MAX_SAFE_INTEGER）→ {result:1, operation:"sign"}

**判定点**:
- HTTP 状态码 === 200
- body.result === 1（number 类型，严格等于）
- body.operation === "sign"（string 类型，字面严等）
- body 顶层 keys 排序后严格等于 ["operation", "result"]

---

### [BEHAVIOR-2] 零的符号函数返回 0

[BEHAVIOR] GET /sign?value=0 → HTTP 200 {result:0, operation:"sign"}；Object.is(result, -0) === false

**描述**: 当 value=0 时，GET /sign 返回 HTTP 200，body 为 `{result: 0, operation: "sign"}`。零是特殊边界，不同于正负数路径。

**覆盖输入**:
- value=0 → {result:0, operation:"sign"}

**判定点**:
- HTTP 状态码 === 200
- body.result === 0（number 类型，区分 -0 vs 0：Object.is(result, 0) 为 true，Object.is(result, -0) 为 false）
- body.operation === "sign"
- body.result !== 1 且 body.result !== -1

---

### [BEHAVIOR-3] 负整数符号函数返回 -1

[BEHAVIOR] GET /sign?value=-3 → HTTP 200 {result:-1, operation:"sign"}；value=-9007199254740991 → HTTP 200 {result:-1}

**描述**: 当 value 为负整数时，GET /sign 返回 HTTP 200，body 为 `{result: -1, operation: "sign"}`。

**覆盖输入**:
- value=-3 → {result:-1, operation:"sign"}
- value=-1 → {result:-1, operation:"sign"}
- value=-9007199254740991（-Number.MAX_SAFE_INTEGER）→ {result:-1, operation:"sign"}

**判定点**:
- HTTP 状态码 === 200
- body.result === -1（number 类型，严格等于）
- body.operation === "sign"（字面严等）
- body 顶层 keys 排序后严格等于 ["operation", "result"]

---

### [BEHAVIOR-4] value 缺失或非法格式 → HTTP 400 + 非空 error

[BEHAVIOR] GET /sign（缺 value）→ HTTP 400 {error:"<非空>"}；value=3.14/abc/1e3/Infinity/NaN/9007199254740992 → HTTP 400

**描述**: 当 value query 参数缺失，或格式不匹配 `^-?\d+$`（含小数、前导 +、科学计数法、十六进制、空串、Infinity、NaN、"-0" 等），或超出 `|value| ≤ 9007199254740991` 范围时，返回 HTTP 400，body 含非空 error 字符串。

**覆盖输入**:
- value 缺失 → 400
- value=3.14（小数）→ 400
- value=abc（字母）→ 400
- value=9007199254740992（超 MAX_SAFE_INTEGER）→ 400
- value=1e3（科学计数法）→ 400
- value=+5（前导正号）→ 400
- value=（空串）→ 400
- value=Infinity → 400
- value=NaN → 400
- value=-0 → 400（"-0" 不匹配 `^-?\d+$` 要求非空数字部分）

**判定点**:
- HTTP 状态码 === 400
- body.error 类型为 string
- body.error.length > 0（非空）
- body 不含 result 字段
- body 不含 operation 字段

---

### [BEHAVIOR-5] 成功响应 schema 完整性

**描述**: 成功响应（HTTP 200）的 body 顶层 keys 严格等于 `["operation", "result"]`，不包含任何其他字段。result 字段值必须是 -1、0 或 1 三者之一（number 类型），operation 字段值必须是字面字符串 "sign"。

**判定点**:
- Object.keys(body).sort() 严格等于 ['operation', 'result']
- [-1, 0, 1].includes(body.result) === true
- typeof body.result === 'number'
- body.operation === "sign"
- body 不含禁用同义字段：sign/signum/symbol/value/input/output/data/payload/answer/sum/product/quotient/power/remainder/factorial/negation

---

### [BEHAVIOR-6] operation 字段字面值锁定为 "sign"

**描述**: 任何合法输入下的成功响应，operation 字段必须是字面字符串 "sign"，不允许变体形式。

**判定点**:
- body.operation === "sign"
- body.operation !== "signum"
- body.operation !== "sign_function"
- body.operation !== "Symbol"
- body.operation !== "sgn"

---

## manual:bash 验收命令

```bash
#!/usr/bin/env bash
# manual:bash — GET /sign E2E 集成验收
# 用法：PLAYGROUND_PORT=3001 bash <this_script>

set -euo pipefail

PORT=${PLAYGROUND_PORT:-3001}
BASE="http://localhost:${PORT}"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local url="$2"
  local expected_status="$3"
  local expected_body="$4"

  local actual
  actual=$(curl -s -o /tmp/sign_body -w "%{http_code}" "${url}")
  local body
  body=$(cat /tmp/sign_body)

  if [ "$actual" != "$expected_status" ]; then
    echo "FAIL [status] ${desc}: expected ${expected_status}, got ${actual}; body=${body}"
    FAIL=$((FAIL+1))
    return
  fi

  if [ -n "$expected_body" ]; then
    if ! echo "$body" | grep -qF "$expected_body"; then
      echo "FAIL [body]   ${desc}: expected to contain '${expected_body}', got '${body}'"
      FAIL=$((FAIL+1))
      return
    fi
  fi

  echo "PASS          ${desc}"
  PASS=$((PASS+1))
}

# 启动 playground（若未运行则临时启动）
PLAYGROUND_PID=""
if ! curl -sf "${BASE}/health" > /dev/null 2>&1; then
  NODE_ENV=production PLAYGROUND_PORT=${PORT} node /workspace/playground/server.js &
  PLAYGROUND_PID=$!
  sleep 1
fi

# [BEHAVIOR-1] 正整数 → result:1
check "[B1] value=5 → 200 result:1"               "${BASE}/sign?value=5"               "200" '"result":1'
check "[B1] value=1 → 200 result:1"               "${BASE}/sign?value=1"               "200" '"result":1'
check "[B1] value=MAX_SAFE_INT → 200 result:1"    "${BASE}/sign?value=9007199254740991" "200" '"result":1'

# [BEHAVIOR-2] 零 → result:0
check "[B2] value=0 → 200 result:0"               "${BASE}/sign?value=0"               "200" '"result":0'

# [BEHAVIOR-3] 负整数 → result:-1
check "[B3] value=-3 → 200 result:-1"             "${BASE}/sign?value=-3"              "200" '"result":-1'
check "[B3] value=-1 → 200 result:-1"             "${BASE}/sign?value=-1"              "200" '"result":-1'

# operation 字段
check "[B6] operation 字段 === sign"              "${BASE}/sign?value=5"               "200" '"operation":"sign"'

# [BEHAVIOR-4] 非法输入 → 400
check "[B4] value 缺失 → 400"                     "${BASE}/sign"                       "400" '"error"'
check "[B4] value=3.14 → 400（小数）"              "${BASE}/sign?value=3.14"            "400" '"error"'
check "[B4] value=abc → 400（字母）"               "${BASE}/sign?value=abc"             "400" '"error"'
check "[B4] value=9007199254740992 → 400（超界）" "${BASE}/sign?value=9007199254740992" "400" '"error"'
check "[B4] value=1e3 → 400（科学计数法）"         "${BASE}/sign?value=1e3"             "400" '"error"'
check "[B4] value=%2B5 → 400（前导正号）"          "${BASE}/sign?value=%2B5"            "400" '"error"'
check "[B4] value= → 400（空串）"                  "${BASE}/sign?value="                "400" '"error"'
check "[B4] value=Infinity → 400"                  "${BASE}/sign?value=Infinity"        "400" '"error"'
check "[B4] value=NaN → 400"                       "${BASE}/sign?value=NaN"             "400" '"error"'

# 停止临时启动的 playground
if [ -n "$PLAYGROUND_PID" ]; then
  kill "$PLAYGROUND_PID" 2>/dev/null || true
fi

echo ""
echo "结果：PASS=${PASS}  FAIL=${FAIL}"
[ "$FAIL" -eq 0 ] && echo "ALL PASS" && exit 0 || exit 1
```

---

## 判定点登记表

| ID | 描述 | 类型 | 判定条件 |
|----|------|------|----------|
| DP-1 | 正整数 happy path | 功能 | GET /sign?value=5 → HTTP 200 + body.result===1 + body.operation==="sign" |
| DP-2 | 零 happy path | 边界 | GET /sign?value=0 → HTTP 200 + body.result===0（非 -0）|
| DP-3 | 负整数 happy path | 功能 | GET /sign?value=-3 → HTTP 200 + body.result===-1 + body.operation==="sign" |
| DP-4 | MAX_SAFE_INTEGER 边界 | 边界 | GET /sign?value=9007199254740991 → HTTP 200 + result===1 |
| DP-5 | MAX_SAFE_INTEGER+1 拒 | 边界 | GET /sign?value=9007199254740992 → HTTP 400 + error 非空 |
| DP-6 | value 缺失拒 | 参数校验 | GET /sign（无 query）→ HTTP 400 + error 非空 |
| DP-7 | 小数拒 | 参数校验 | GET /sign?value=3.14 → HTTP 400 + error 非空 |
| DP-8 | 字母拒 | 参数校验 | GET /sign?value=abc → HTTP 400 + error 非空 |
| DP-9 | schema 完整性 | schema | 成功响应 Object.keys(body).sort() === ['operation','result'] |
| DP-10 | operation 字面锁定 | schema | body.operation === "sign"（严格字面，禁 signum/sgn 等变体）|
| DP-11 | result 值域约束 | schema | body.result ∈ {-1, 0, 1}（number 类型）|
| DP-12 | 错误响应 schema | schema | 400 响应 Object.keys(body) === ['error'] 且 typeof error === 'string' |
| DP-13 | 禁用字段反向断言 | schema | 成功响应不含 sign/signum/symbol/value 等非规范字段 |

---

## 受影响文件

- `playground/server.js`：新增 GET /sign 路由
- `playground/tests/server.test.js`：新增 `describe('GET /sign')` 测试块
- `sprints/07231828-relay-97f490f5/tests/sign.test.js`：sprint 级合同测试文件
