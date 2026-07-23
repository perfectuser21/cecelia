# Contract Draft — GET /sign（playground 第 13 个端点）

## 元信息

- **Sprint**: sprints/07231828-relay-97f490f5
- **Task ID**: 97f490f5-d3d0-499c-835b-b4558406e9d1
- **目标文件**: playground/server.js（新增路由）
- **测试文件**: playground/tests/server.test.js（新增 describe 块）
- **target_environment**: playground（vitest 单元测试 + bash 集成测试）
- **轮次**: 首轮，无 reviewer feedback

---

## 功能描述

实现数学符号函数（signum）：`GET /sign?value=<整数>`，返回 value 的符号值（-1、0、1）。

---

## Response Schema

```
GET /sign?value=<整数>
→ 200 OK
{
  "result": -1 | 0 | 1,   // 符号值，number 类型
  "operation": "sign"      // 字面值固定，string 类型
}
```

错误响应：
```
→ 400 Bad Request
{
  "error": "<非空字符串>"  // 拒绝原因，string 类型
}
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| GET /sign 完整覆盖（B1-B4+B5-B6） | `../../tests/regression/relay-97f490f5/sign.test.js` | value=5 → 200, value=0 → 200, value=-3 → 200, value 缺失, 成功响应顶层 keys, operation 字段字面值 | → 实现前全部 FAIL（Green commit 才通过） |

---

## 验收规则汇总

| 输入 | 期望 HTTP | 期望 body |
|------|-----------|-----------|
| value=5 | 200 | {result:1, operation:"sign"} |
| value=-3 | 200 | {result:-1, operation:"sign"} |
| value=0 | 200 | {result:0, operation:"sign"} |
| value=9007199254740991 | 200 | {result:1, operation:"sign"} |
| value=9007199254740992 | 400 | {error: 非空字符串} |
| value 缺失 | 400 | {error: 非空字符串} |
| value=3.14 | 400 | {error: 非空字符串} |
| value=abc | 400 | {error: 非空字符串} |
| value=-0 | 400 | {error: 非空字符串}（"-0" 不匹配 ^-?\d+$ 中要求的非空数字部分） |

---

## 参数校验规则

- query 名必须是 `value`（唯一 query 参数）
- value 必须匹配正则 `^-?\d+$`（仅整数，拒绝小数、前导 +、科学计数法、十六进制、千分位、空串、Infinity、NaN 等）
- `Number(value)` 必须满足 `|Number(value)| ≤ 9007199254740991`（Number.MAX_SAFE_INTEGER）

---

## 符号判定规则

- `Number(value) > 0` → result = 1
- `Number(value) === 0` → result = 0
- `Number(value) < 0` → result = -1

---

## E2E 验收

### vitest 单元测试

运行命令：
```bash
cd /workspace/playground && npx vitest run tests/server.test.js --reporter verbose 2>&1 | grep -E "sign|PASS|FAIL|✓|×"
```

### manual:bash 验收命令

```bash
#!/usr/bin/env bash
# E2E 集成验收：GET /sign endpoint
# 前置：playground server 运行中（PLAYGROUND_PORT=3001）

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
    echo "FAIL [status] ${desc}: expected ${expected_status}, got ${actual}"
    FAIL=$((FAIL+1))
    return
  fi

  if [ -n "$expected_body" ]; then
    if ! echo "$body" | grep -qF "$expected_body"; then
      echo "FAIL [body]   ${desc}: expected body to contain '${expected_body}', got '${body}'"
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

# 正常路径
check "value=5 → 200 {result:1}"               "${BASE}/sign?value=5"               "200" '"result":1'
check "value=-3 → 200 {result:-1}"              "${BASE}/sign?value=-3"              "200" '"result":-1'
check "value=0 → 200 {result:0}"                "${BASE}/sign?value=0"               "200" '"result":0'
check "value=9007199254740991 → 200 {result:1}" "${BASE}/sign?value=9007199254740991" "200" '"result":1'

# operation 字段校验
check "operation 字段 === 'sign'"               "${BASE}/sign?value=5"               "200" '"operation":"sign"'

# 边界：超出 MAX_SAFE_INTEGER
check "value=9007199254740992 → 400"            "${BASE}/sign?value=9007199254740992" "400" '"error"'

# 缺参
check "value 缺失 → 400"                        "${BASE}/sign"                        "400" '"error"'

# 格式非法
check "value=3.14 → 400（小数）"                "${BASE}/sign?value=3.14"            "400" '"error"'
check "value=abc → 400（字母）"                  "${BASE}/sign?value=abc"             "400" '"error"'
check "value=1e3 → 400（科学计数法）"            "${BASE}/sign?value=1e3"             "400" '"error"'
check "value=+5 → 400（前导正号）"               "${BASE}/sign?value=%2B5"            "400" '"error"'
check "value= → 400（空串）"                     "${BASE}/sign?value="                "400" '"error"'

# 停止临时启动的 playground
if [ -n "$PLAYGROUND_PID" ]; then
  kill "$PLAYGROUND_PID" 2>/dev/null || true
fi

echo ""
echo "结果：PASS=${PASS}  FAIL=${FAIL}"
[ "$FAIL" -eq 0 ] && echo "ALL PASS" && exit 0 || exit 1
```
