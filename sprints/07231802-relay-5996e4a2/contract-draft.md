# Contract Draft — playground GET /square 端点

## 技术规范

### 端点定义

- **路径**: `GET /square`
- **实现文件**: `playground/server.js`
- **参数验证正则**: `STRICT_NUMBER = /^-?\d+(\.\d+)?$/`（与 /abs、/multiply 等端点一致）

### 请求参数

| 参数 | 类型 | 必填 | 格式约束 |
|------|------|------|----------|
| `n`  | query string | 是 | 匹配 `^-?\d+(\.\d+)?$`（禁止科学计数法、Infinity、前导+、十六进制） |

### 响应规范

**成功（HTTP 200）**:
```json
{ "square": <number> }
```
- `square` 字段类型为 number
- 计算逻辑：`Number(n) ** 2`
- `-0` 规范化：`(-0)² = 0`，不得返回 `-0`（`Object.is(res.body.square, -0)` 必须为 false）

**错误（HTTP 400）**:
```json
{ "error": "<string>" }
```

### 错误场景映射

| 场景 | HTTP 状态 | 响应 body |
|------|-----------|-----------|
| 缺失参数 n | 400 | `{ "error": "n 是必填 query 参数" }` |
| 格式非法（abc, 1e5, +3, 0x1A） | 400 | `{ "error": "n 必须匹配 ..." }` |
| 结果溢出（n=1e308，计算结果非有限数） | 400 | `{ "error": "计算结果非有限数..." }` |

---

## E2E 验收

```bash
#!/usr/bin/env bash
# E2E 验收脚本 — playground GET /square
# 使用 localhost:${PLAYGROUND_PORT:-3001}，不得调用 Brain 端口 5221

set -euo pipefail
PORT=${PLAYGROUND_PORT:-3001}
BASE="http://localhost:$PORT"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local actual_status="$2"
  local actual_body="$3"
  local expected_status="$4"
  local expected_key="$5"
  local expected_value="$6"

  if [ "$actual_status" != "$expected_status" ]; then
    echo "FAIL [$desc]: 期望 HTTP $expected_status，实际 $actual_status"
    FAIL=$((FAIL+1))
    return
  fi

  local got
  got=$(echo "$actual_body" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const o=JSON.parse(d); process.stdout.write(String(o['$expected_key']));")
  if [ "$got" != "$expected_value" ]; then
    echo "FAIL [$desc]: 期望 .$expected_key=$expected_value，实际 $got"
    FAIL=$((FAIL+1))
  else
    echo "PASS [$desc]"
    PASS=$((PASS+1))
  fi
}

# 启动 playground server
cd /workspace/playground
PLAYGROUND_PORT=$PORT node server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# 等待 server 就绪
for i in {1..15}; do
  if curl -sf "$BASE/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

echo "=== E2E: GET /square ==="

# 1. 正常数字：n=5 → square=25
RES=$(curl -s -o /tmp/body.json -w "%{http_code}" "$BASE/square?n=5")
check "n=5 → square=25" "$RES" "$(cat /tmp/body.json)" "200" "square" "25"

# 2. 负数：n=-3 → square=9
RES=$(curl -s -o /tmp/body.json -w "%{http_code}" "$BASE/square?n=-3")
check "n=-3 → square=9" "$RES" "$(cat /tmp/body.json)" "200" "square" "9"

# 3. 零：n=0 → square=0
RES=$(curl -s -o /tmp/body.json -w "%{http_code}" "$BASE/square?n=0")
check "n=0 → square=0" "$RES" "$(cat /tmp/body.json)" "200" "square" "0"

# 4. 小数：n=1.5 → square=2.25
RES=$(curl -s -o /tmp/body.json -w "%{http_code}" "$BASE/square?n=1.5")
check "n=1.5 → square=2.25" "$RES" "$(cat /tmp/body.json)" "200" "square" "2.25"

# 5. 缺失参数 → HTTP 400
STATUS=$(curl -s -o /tmp/body.json -w "%{http_code}" "$BASE/square")
if [ "$STATUS" = "400" ]; then
  echo "PASS [缺参数 → 400]"
  PASS=$((PASS+1))
else
  echo "FAIL [缺参数]: 期望 400，实际 $STATUS"
  FAIL=$((FAIL+1))
fi

# 6. 非法格式 abc → HTTP 400
STATUS=$(curl -s -o /tmp/body.json -w "%{http_code}" "$BASE/square?n=abc")
if [ "$STATUS" = "400" ]; then
  echo "PASS [n=abc → 400]"
  PASS=$((PASS+1))
else
  echo "FAIL [n=abc]: 期望 400，实际 $STATUS"
  FAIL=$((FAIL+1))
fi

# 7. 科学计数法 n=1e5 → HTTP 400
STATUS=$(curl -s -o /tmp/body.json -w "%{http_code}" --get --data-urlencode "n=1e5" "$BASE/square")
if [ "$STATUS" = "400" ]; then
  echo "PASS [n=1e5 → 400]"
  PASS=$((PASS+1))
else
  echo "FAIL [n=1e5]: 期望 400，实际 $STATUS"
  FAIL=$((FAIL+1))
fi

# 8. 溢出 n=1e308 → HTTP 400（STRICT_NUMBER 本身拒绝科学计数法，此测试确认行为一致）
STATUS=$(curl -s -o /tmp/body.json -w "%{http_code}" --get --data-urlencode "n=1e308" "$BASE/square")
if [ "$STATUS" = "400" ]; then
  echo "PASS [n=1e308 → 400]"
  PASS=$((PASS+1))
else
  echo "FAIL [n=1e308]: 期望 400，实际 $STATUS"
  FAIL=$((FAIL+1))
fi

# 9. -0 规范化：n=-0 输入（-0 不匹配 STRICT_NUMBER，应 400；若匹配则 square 不得是 -0）
# STRICT_NUMBER = ^-?\d+(\.\d+)?$ → "-0" 实际匹配（负号 + 0），行为确认：
STATUS=$(curl -s -o /tmp/body.json -w "%{http_code}" "$BASE/square?n=-0")
BODY=$(cat /tmp/body.json)
if [ "$STATUS" = "200" ]; then
  # 确认 square 为 0 且非 -0
  IS_NEG_ZERO=$(echo "$BODY" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const o=JSON.parse(d); process.stdout.write(String(Object.is(o.square,-0)));")
  if [ "$IS_NEG_ZERO" = "false" ]; then
    echo "PASS [n=-0 → square=0 非 -0]"
    PASS=$((PASS+1))
  else
    echo "FAIL [n=-0]: square 为 -0，违反规范"
    FAIL=$((FAIL+1))
  fi
elif [ "$STATUS" = "400" ]; then
  echo "PASS [n=-0 → 400（视为非法输入）]"
  PASS=$((PASS+1))
else
  echo "FAIL [n=-0]: 期望 200 或 400，实际 $STATUS"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=== 结果: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ] && echo "E2E PASSED" && exit 0
echo "E2E FAILED" && exit 1
```

---

## 未覆盖真实链路清单

| 编号 | 链路 / 场景 | 未覆盖原因 |
|------|-------------|------------|
| UC-1 | 并发多请求（高并发下 `-0` 规范化竞态） | playground 是训练沙箱，无并发压测要求 |
| UC-2 | 超大整数字符串（如 9999999999999999999 超过 MAX_SAFE_INTEGER 但仍匹配 STRICT_NUMBER） | STRICT_NUMBER 允许任意位数整数，结果可能精度损失但 Number.isFinite 为 true，未做上界保护 |
| UC-3 | 前导零输入（如 `n=007`）匹配 STRICT_NUMBER 的行为 | `007` 匹配正则，`Number("007")=7`，结果 49；E2E 未覆盖此边界 |
| UC-4 | URL 编码参数（`n=%2D3` 即 `-3` 的编码形式） | Express 自动解码，行为与直接 `-3` 一致，未显式测试 |
| UC-5 | 空字符串参数 `n=`（空串不匹配 STRICT_NUMBER，应 400） | E2E 脚本未覆盖空串边界 |
| UC-6 | `/square` 端点的回归保护（确保已有 /abs 等端点不受影响） | 未做完整回归扫描（现有 CI 已覆盖，不在本 sprint scope） |
