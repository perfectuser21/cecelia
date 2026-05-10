# Sprint Contract Draft (Round 1)

> **Initiative**: W19 Walking Skeleton — playground 加 `GET /sum` endpoint
> **Task ID**: eaf2a56f-695e-46bb-ab2f-04387f8427f4
> **Source PRD**: `sprints/w19-playground-sum/sprint-prd.md`
> **journey_type**: autonomous

---

## Golden Path

[HTTP 客户端发 `GET /sum?a=2&b=3`] → [playground server 解析 query 求和] → [客户端收到 HTTP 200 + body `{ "sum": 5 }`]

边界 / 副 Path（同一 endpoint 上的非 happy 路径，必须同样验证）：
- 缺参 → 400 + `error` 字段
- 非数字 → 400 + `error` 字段
- 负数 / 零 / 小数 → 200 + 算术结果
- 现有 `GET /health` 行为不被破坏

---

### Step 1: 客户端发 `GET /sum?a=2&b=3`，收到 200 + `{ "sum": 5 }`

**可观测行为**：playground server（默认 :3000）对合法整数 query 返回 HTTP 200，body 是含 `sum` 字段的 JSON，值等于算术和。

**验证命令**（evaluator 在 spawn `npm start` 后执行）：
```bash
# 已 spawn server 监听在 $PORT（默认 3000）后
RESP=$(curl -fsS "http://127.0.0.1:${PORT:-3000}/sum?a=2&b=3")
# 期望：HTTP 200（curl -f 已保证），body 形如 {"sum":5}
echo "$RESP" | jq -e '.sum == 5' >/dev/null
# exit 0 即通过
```

**硬阈值**：
- HTTP status = 200（`curl -f` 在非 2xx 时退出 22）
- response body 是合法 JSON（`jq -e` 解析失败退出非 0）
- `.sum == 5` 严格等于（数值类型，非字符串 "5"）

---

### Step 2: 客户端发 `GET /sum?a=2`（缺 b），收到 400 + `error` 字段

**可观测行为**：缺任一参数时 server 返回 HTTP 400，body 是 JSON 且含非空 `error` 字段。**不允许**返回 200 + `{"sum":NaN}` 或返回 500。

**验证命令**：
```bash
HTTP_CODE=$(curl -s -o /tmp/sum-miss.json -w '%{http_code}' "http://127.0.0.1:${PORT:-3000}/sum?a=2")
[ "$HTTP_CODE" = "400" ] || { echo "expected 400 got $HTTP_CODE"; exit 1; }
jq -e '.error | type == "string" and length > 0' /tmp/sum-miss.json >/dev/null
```

**硬阈值**：
- HTTP status 严格 = 400
- body 是 JSON
- `.error` 是非空字符串（`type=="string" and length>0` 防御 `{"error":null}` / `{"error":""}`）

---

### Step 3: 客户端发 `GET /sum?a=abc&b=3`（非数字），收到 400 + `error` 字段

**可观测行为**：任一参数无法解析为数字时返回 400 + JSON `error`，**不允许** `{"sum": NaN}` 或 200。

**验证命令**：
```bash
HTTP_CODE=$(curl -s -o /tmp/sum-nan.json -w '%{http_code}' "http://127.0.0.1:${PORT:-3000}/sum?a=abc&b=3")
[ "$HTTP_CODE" = "400" ] || { echo "expected 400 got $HTTP_CODE"; exit 1; }
jq -e '.error | type == "string" and length > 0' /tmp/sum-nan.json >/dev/null
# 防御"sum:NaN 也算通过"——不允许 body 含 sum 字段（应当是 error 路径）
jq -e 'has("sum") | not' /tmp/sum-nan.json >/dev/null
```

**硬阈值**：
- HTTP status = 400
- `.error` 非空字符串
- body 不含 `sum` 字段（防止实现为 `{"sum":NaN,"error":"..."}` 这种模糊态）

---

### Step 4: 边界数值（负数 / 零 / 小数）正常求和

**可观测行为**：负数、零、小数都视作合法数字，server 返回 200 + 正确算术和。

**验证命令**：
```bash
# 负数 + 正数 = 0
curl -fsS "http://127.0.0.1:${PORT:-3000}/sum?a=-1&b=1" | jq -e '.sum == 0' >/dev/null
# 小数
curl -fsS "http://127.0.0.1:${PORT:-3000}/sum?a=1.5&b=2.5" | jq -e '.sum == 4' >/dev/null
# 双零
curl -fsS "http://127.0.0.1:${PORT:-3000}/sum?a=0&b=0" | jq -e '.sum == 0' >/dev/null
```

**硬阈值**：三条命令全部 exit 0（`-f` + `jq -e` 串联，HTTP 非 2xx 或 JSON 断言失败任一即整体失败）。

---

### Step 5: 现有 `GET /health` 不被破坏

**可观测行为**：`/health` 仍然返回 200 + `{"ok":true}`。

**验证命令**：
```bash
curl -fsS "http://127.0.0.1:${PORT:-3000}/health" | jq -e '.ok == true' >/dev/null
```

**硬阈值**：HTTP 200 且 body 严格等于 `{"ok":true}` 中的 `ok==true` 断言。

---

### Step 6: 单测套件全绿（`npm test` 在 playground/ 内）

**可观测行为**：`playground/tests/server.test.js` 含 `/sum` happy path + 至少一个 error case，且全部 pass；`/health` 测试不动仍 pass。

**验证命令**：
```bash
cd playground
npm ci --silent
npm test -- --reporter=verbose 2>&1 | tee /tmp/playground-test.log
# 必须有 /sum happy + /sum error 至少 2 条 pass
grep -E "GET /sum.*200" /tmp/playground-test.log
grep -Ei "GET /sum.*(400|missing|invalid|error)" /tmp/playground-test.log
# 防御 0-test 假绿：vitest 输出必须含 "Tests" 行且失败数 = 0
grep -E "Test Files\s+[0-9]+ passed" /tmp/playground-test.log
grep -E "Tests\s+[0-9]+ passed" /tmp/playground-test.log
! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-test.log
```

**硬阈值**：
- vitest 退出 0
- 日志中能 grep 到至少一条 `/sum` 200 用例 + 至少一条 `/sum` 400/error 用例
- 输出含 `Test Files N passed` 和 `Tests N passed`，**不含** `Tests N failed`

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous（HTTP server 单子项目，无 UI / 无 brain tick / 无远端 agent）

**完整验证脚本**（evaluator 直接拷贝执行）：

```bash
#!/bin/bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/playground"

# 1. 装依赖 + 单测先过（覆盖 contract Step 6）
npm ci --silent
npm test -- --reporter=verbose 2>&1 | tee /tmp/playground-unit.log
grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log
! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log

# 2. spawn 真 server，端口随机避开冲突
export PLAYGROUND_PORT=${PLAYGROUND_PORT:-3789}
PORT=$PLAYGROUND_PORT
NODE_ENV=production node server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# 等 server 起来（最多 10s 探活）
for i in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null

# 3. Step 1：happy path
curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null

# 4. Step 2：缺参
HTTP=$(curl -s -o /tmp/sum-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=2")
[ "$HTTP" = "400" ]
jq -e '.error | type == "string" and length > 0' /tmp/sum-miss.json >/dev/null

# 5. Step 3：非数字
HTTP=$(curl -s -o /tmp/sum-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=abc&b=3")
[ "$HTTP" = "400" ]
jq -e '.error | type == "string" and length > 0' /tmp/sum-nan.json >/dev/null
jq -e 'has("sum") | not' /tmp/sum-nan.json >/dev/null

# 6. Step 4：负数 / 小数 / 零
curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1"   | jq -e '.sum == 0' >/dev/null
curl -fsS "http://127.0.0.1:$PORT/sum?a=1.5&b=2.5" | jq -e '.sum == 4' >/dev/null
curl -fsS "http://127.0.0.1:$PORT/sum?a=0&b=0"     | jq -e '.sum == 0' >/dev/null

# 7. Step 5：/health 不破坏（已在 step 2 起活时验过，再 explicit 一次）
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null

echo "OK Golden Path 验证通过"
```

**通过标准**：脚本 `set -e` 下 exit 0。

**造假防御已写入**：
- 所有 `curl` 带 `-f`：HTTP 非 2xx 自动失败（防 "404 也算通过"）
- 所有 JSON 断言用 `jq -e`：解析失败 / 表达式 false 即非 0 退出（防 "返回 HTML 也算通过"）
- happy path `.sum == 5` 严格相等（防 `{"sum":"5"}` 字符串作弊）
- error 用例显式断言 `has("sum") | not`（防 `{"sum":NaN,"error":"..."}` 模糊实现）
- 单测日志双重 grep（既要 passed N 又要 not failed N，防 0-test 跳过）
- server spawn 随机端口 + 起活探测，避免端口被占致假阴

---

## Workstreams

workstream_count: 1

### Workstream 1: 加 `GET /sum` 路由 + 单测 + README

**范围**：
- `playground/server.js`：在 `/health` 路由之后、`app.listen` 之前新增 `GET /sum` handler，处理 happy / 缺参 / 非数字 / 负数 / 小数 / 零，返回 JSON。
- `playground/tests/server.test.js`：保留现有 `/health` 用例不动，新增 `/sum` happy + 至少 2 个 error case。
- `playground/README.md`：把"端点"段把 `/sum` 从"不在 bootstrap 范围"改为已实现，给一个示例 curl + 响应。

**大小**：S（< 100 行净增）

**依赖**：无（单一 workstream）

**BEHAVIOR 覆盖测试文件**：`tests/ws1/sum.test.js`（sprint dir 内 TDD Red 证据；Generator 阶段把这些 it/test 块原样合并到 `playground/tests/server.test.js`）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/w19-playground-sum/tests/ws1/sum.test.js` | (1) GET `/sum?a=2&b=3` → 200 + `{sum:5}`<br>(2) 缺 b → 400 + error<br>(3) `a=abc` → 400 + error 且 body 不含 sum<br>(4) `a=-1&b=1` → `{sum:0}`<br>(5) `a=1.5&b=2.5` → `{sum:4}`<br>(6) `/health` 不破坏 | 5 failures（5 个 `/sum` 用例失败；`/health` 用例继续 pass） |

**Red 证据采集命令**（Proposer 自验，commit 前必须看到 FAIL）：
```bash
cd playground
# 把 sprint 红测试临时丢进 playground/tests 跑（不 commit），看 vitest Red
cp ../sprints/w19-playground-sum/tests/ws1/sum.test.js tests/_sum_red_probe.test.js
npx vitest run --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || true
rm -f tests/_sum_red_probe.test.js
grep -E "FAIL|failed" /tmp/ws1-red.log
```

期望日志含 `FAIL` 且 failed 计数 ≥ 5（每条 `/sum` 行为各 1 个失败）。
