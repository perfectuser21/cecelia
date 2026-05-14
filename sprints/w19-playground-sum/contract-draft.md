# Sprint Contract Draft (Round 1)

> **Initiative**: W19 Walking Skeleton — playground 加 `GET /sum` endpoint
> **Source PRD**: `sprints/w19-playground-sum/sprint-prd.md`
> **journey_type**: autonomous

---

## §1 Golden Path

[HTTP 客户端发 `GET /sum?a=2&b=3`] → [playground server 解析 query a/b 求和] → [客户端收到 HTTP 200 + body `{ "sum": 5 }`]

边界副路径（同一 endpoint，必须同样验证）：
- 缺参（a 或 b 缺失） → 400 + 非空 `error` 字段，无 `sum`
- 非数字（`a=abc`） → 400 + 非空 `error` 且 body 不含 `sum`
- 负数 / 零 / 小数 → 200 + 算术结果
- 现有 `GET /health` 不被破坏

---

## §2 journey_type

**autonomous** — playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议。

---

## §3 ASSERT 目录（Single Source of Truth）

> 每条 ASSERT 是独立可执行的 bash 断言，预设 `$PORT` 已指向运行中的 playground server。
> 任一 ASSERT 命令以非 0 退出即视为该断言失败 → Evaluator FAIL。

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-SUM-HAPPY]` | happy path：a=2&b=3 → sum=5（字段值） | `curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" \| jq -e '.sum == 5' >/dev/null` | exit 0 |
| `[ASSERT-SUM-KEYS]` | schema 完整性：顶层 keys 恰好 `["sum"]` | `curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" \| jq -e 'keys == ["sum"]' >/dev/null` | exit 0 |
| `[ASSERT-SUM-NO-RESULT]` | 禁用字段 result 不存在（反向检查） | `curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" \| jq -e 'has("result") \| not' >/dev/null` | exit 0 |
| `[ASSERT-SUM-MISSING-B]` | 缺 b → 400 + 非空 error | `H=$(curl -s -o /tmp/sum-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/sum-miss.json >/dev/null` | exit 0 |
| `[ASSERT-SUM-NAN]` | a 非数字 → 400 + error 且无 sum | `H=$(curl -s -o /tmp/sum-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=abc&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/sum-nan.json >/dev/null && jq -e 'has("sum") \| not' /tmp/sum-nan.json >/dev/null` | exit 0 |
| `[ASSERT-SUM-NEG]` | 负数合法：a=-1&b=1 → sum=0 | `curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1" \| jq -e '.sum == 0' >/dev/null` | exit 0 |
| `[ASSERT-SUM-FLOAT]` | 小数合法：a=1.5&b=2.5 → sum=4 | `curl -fsS "http://127.0.0.1:$PORT/sum?a=1.5&b=2.5" \| jq -e '.sum == 4' >/dev/null` | exit 0 |
| `[ASSERT-HEALTH-INTACT]` | 回归：/health 仍 200 + {ok:true} | `curl -fsS "http://127.0.0.1:$PORT/health" \| jq -e '.ok == true' >/dev/null` | exit 0 |
| `[ASSERT-UNIT-PASSED]` | playground 单测套件全绿 | `cd playground && npm ci --silent && npm test -- --reporter=verbose 2>&1 \| tee /tmp/pg-unit.log; grep -E "Tests\s+[0-9]+ passed" /tmp/pg-unit.log && ! grep -E "Tests\s+[0-9]+ failed" /tmp/pg-unit.log` | exit 0 |

---

## §4 Golden Path Steps

### Step 1: 客户端发 `GET /sum?a=2&b=3`，收到 200 + `{ "sum": 5 }`

**可观测行为**：playground server 对合法数字 query 返回 HTTP 200，body 含 `sum` 字段（数字类型），值等于算术和，且无多余字段。

**验证命令**：
```bash
RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3")
echo "$RESP" | jq -e '.sum == 5' >/dev/null || { echo "FAIL [ASSERT-SUM-HAPPY]"; exit 1; }
echo "$RESP" | jq -e 'keys == ["sum"]' >/dev/null || { echo "FAIL [ASSERT-SUM-KEYS]"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' >/dev/null || { echo "FAIL [ASSERT-SUM-NO-RESULT]"; exit 1; }
```

**硬阈值**：HTTP 200 + `.sum === 5`（数值类型严格）+ `keys == ["sum"]`（无多余字段）

---

### Step 2: 缺参 → 400 + 非空 `error`

**可观测行为**：缺任一参数 → 400 + JSON `error`，不允许 200 + `{sum:NaN}` 或 500。

**验证命令**：
```bash
H=$(curl -s -o /tmp/sum-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=2")
[ "$H" = "400" ] || { echo "FAIL: 期望 400，得 $H"; exit 1; }
jq -e '.error | type == "string" and length > 0' /tmp/sum-miss.json >/dev/null || { echo "FAIL [ASSERT-SUM-MISSING-B]"; exit 1; }
```

**硬阈值**：HTTP 严格 400 + `.error` 是非空字符串

---

### Step 3: 非数字参数 → 400 + error 且 body 不含 `sum`

**可观测行为**：无法解析为数字 → 400 + JSON `error`，不允许 200 / `{sum:NaN}` / `{sum:NaN,error:...}`。

**验证命令**：
```bash
H=$(curl -s -o /tmp/sum-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=abc&b=3")
[ "$H" = "400" ] || { echo "FAIL: 期望 400，得 $H"; exit 1; }
jq -e '.error | type == "string" and length > 0' /tmp/sum-nan.json >/dev/null || { echo "FAIL: error 字段缺失"; exit 1; }
jq -e 'has("sum") | not' /tmp/sum-nan.json >/dev/null || { echo "FAIL: error body 不应含 sum"; exit 1; }
```

**硬阈值**：HTTP 400 + `.error` 非空 + `has("sum") == false`

---

### Step 4: 边界数值（负数 / 小数）正常求和

**可观测行为**：负数、零、小数视作合法数字，server 返回 200 + 正确算术和。

**验证命令**：
```bash
curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1" | jq -e '.sum == 0' >/dev/null || { echo "FAIL [ASSERT-SUM-NEG]"; exit 1; }
curl -fsS "http://127.0.0.1:$PORT/sum?a=1.5&b=2.5" | jq -e '.sum == 4' >/dev/null || { echo "FAIL [ASSERT-SUM-FLOAT]"; exit 1; }
```

**硬阈值**：两条断言全部 exit 0。

---

### Step 5: 现有 `GET /health` 不被破坏

**可观测行为**：`/health` 仍返回 200 + `{ok:true}`。

**验证命令**：
```bash
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null || { echo "FAIL [ASSERT-HEALTH-INTACT]"; exit 1; }
```

**硬阈值**：HTTP 200 + `.ok === true`

---

## §5 E2E 验收脚本（Evaluator 直接跑）

```bash
#!/bin/bash
set -e

# 随机端口防冲突
PORT=$(shuf -i 30000-40000 -n 1 2>/dev/null || python3 -c "import random; print(random.randint(30000,40000))")
export PORT

# spawn server + trap kill
cd playground
npm ci --silent 2>/dev/null || npm ci --silent
PLAYGROUND_PORT=$PORT node server.js &
SPID=$!
trap "kill $SPID 2>/dev/null" EXIT

# 起活探测
for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.3
done

# Step 1: happy path + schema completeness + forbidden field
RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3")
echo "$RESP" | jq -e '.sum == 5' >/dev/null || { echo "FAIL [ASSERT-SUM-HAPPY]"; exit 1; }
echo "$RESP" | jq -e 'keys == ["sum"]' >/dev/null || { echo "FAIL [ASSERT-SUM-KEYS]"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' >/dev/null || { echo "FAIL [ASSERT-SUM-NO-RESULT]"; exit 1; }

# Step 2: 缺参 → 400
H=$(curl -s -o /tmp/sum-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=2")
[ "$H" = "400" ] || { echo "FAIL [ASSERT-SUM-MISSING-B]: HTTP $H"; exit 1; }
jq -e '.error | type == "string" and length > 0' /tmp/sum-miss.json >/dev/null || { echo "FAIL: error 字段缺失"; exit 1; }

# Step 3: 非数字 → 400 + 无 sum
H=$(curl -s -o /tmp/sum-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=abc&b=3")
[ "$H" = "400" ] || { echo "FAIL [ASSERT-SUM-NAN]: HTTP $H"; exit 1; }
jq -e '.error | type == "string" and length > 0' /tmp/sum-nan.json >/dev/null || { echo "FAIL"; exit 1; }
jq -e 'has("sum") | not' /tmp/sum-nan.json >/dev/null || { echo "FAIL: error body 不应含 sum"; exit 1; }

# Step 4: 边界数值
curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1" | jq -e '.sum == 0' >/dev/null || { echo "FAIL [ASSERT-SUM-NEG]"; exit 1; }
curl -fsS "http://127.0.0.1:$PORT/sum?a=1.5&b=2.5" | jq -e '.sum == 4' >/dev/null || { echo "FAIL [ASSERT-SUM-FLOAT]"; exit 1; }

# Step 5: 回归
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null || { echo "FAIL [ASSERT-HEALTH-INTACT]"; exit 1; }

kill $SPID 2>/dev/null
echo "✅ Golden Path 全部验证通过"
```

**通过标准**：脚本 exit 0

---

## §6 Workstreams

**workstream_count**: 1

### Workstream 1: playground 加 GET /sum 路由 + 单测 + README

**范围**：
- `playground/server.js` 新增 `GET /sum` 路由（解析 a/b → 校验 → 200+sum 或 400+error）
- `playground/tests/server.test.js` 新增 /sum happy path + ≥ 1 error case
- `playground/README.md` 更新端点段，把 `/sum` 从"不在范围"改为已实现

**大小**：S（< 100 行净增）
**依赖**：无

---

## §7 Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| WS1 | `sprints/w19-playground-sum/tests/ws1/sum.test.js` | sum 字段值 + schema 完整性 + error path | supertest 未在根目录安装 → module not found |
