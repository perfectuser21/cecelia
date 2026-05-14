# Sprint Contract Draft (Round 1)

> **Initiative**: W19 Walking Skeleton — playground 加 `GET /sum` endpoint
> **Source PRD**: `sprints/w19-playground-sum/sprint-prd.md`
> **journey_type**: autonomous

---

## §1 Golden Path

[HTTP 客户端发 `GET /sum?a=2&b=3`] → [playground server 解析 query 参数 a/b 并求和] → [客户端收到 HTTP 200，body 为 `{ "sum": 5 }`]

边界 / 副 path：
- 缺参 → 400 + 非空 `error` 字段，body 不含 `sum`
- 非数字 → 400 + 非空 `error` 字段，body 不含 `sum`
- 负数 / 零 / 小数 → 200 + 算术结果
- 现有 `GET /health` 行为不被破坏

---

## §2 journey_type

**autonomous** — playground 是独立 HTTP server 子项目，只动 `server.js` + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议。

---

## §3 Golden Path Steps

### Step 1: `GET /sum?a=2&b=3` → 200 + `{ "sum": 5 }`

**可观测行为**: playground server 对合法整数 query 返回 HTTP 200，body 含唯一字段 `sum`，值等于 a + b 算术结果（number 类型严格匹配）。

**验证命令**:
```bash
PORT=$(shuf -i 30000-40000 -n 1)
cd playground && PLAYGROUND_PORT=$PORT node server.js &
SPID=$!
trap "kill $SPID 2>/dev/null || true" EXIT
for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3")
echo "$RESP" | jq -e '.sum == 5'
echo "$RESP" | jq -e '.sum | type == "number"'
echo "$RESP" | jq -e 'keys == ["sum"]'
echo "$RESP" | jq -e 'has("error") | not'
```

**硬阈值**: HTTP 200 + `.sum === 5`（number 类型）+ `keys == ["sum"]`（不允许多余字段）

---

### Step 2: `GET /sum?a=2`（缺 b）→ 400 + 非空 `error`

**可观测行为**: 缺任一参数 → HTTP 400，body 含 `error` 字段（非空字符串），**不允许** 200 / `{sum:NaN}` / 500。

**验证命令**:
```bash
H=$(curl -s -o /tmp/sum-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=2")
[ "$H" = "400" ]
jq -e '.error | type == "string" and length > 0' /tmp/sum-miss.json
jq -e 'has("sum") | not' /tmp/sum-miss.json
```

**硬阈值**: HTTP 严格 400 + `.error` 非空字符串 + body 不含 `sum`

---

### Step 3: `GET /sum?a=abc&b=3`（非数字）→ 400 + error，body 不含 `sum`

**可观测行为**: 参数无法解析为 finite number → 400 + `error`，**不允许** `{"sum":NaN}` 或混合态。

**验证命令**:
```bash
H=$(curl -s -o /tmp/sum-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=abc&b=3")
[ "$H" = "400" ]
jq -e '.error | type == "string" and length > 0' /tmp/sum-nan.json
jq -e 'has("sum") | not' /tmp/sum-nan.json
```

**硬阈值**: HTTP 400 + `.error` 非空 + `has("sum") == false`

---

### Step 4: 边界数值（负数 / 零 / 小数）正常求和

**可观测行为**: 负数、零、小数均视为合法数字，server 返回 200 + 正确算术和。

**验证命令**:
```bash
curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1"    | jq -e '.sum == 0'
curl -fsS "http://127.0.0.1:$PORT/sum?a=1.5&b=2.5" | jq -e '.sum == 4'
curl -fsS "http://127.0.0.1:$PORT/sum?a=0&b=0"     | jq -e '.sum == 0'
```

**硬阈值**: 三条 jq -e 全 exit 0

---

### Step 5: `GET /health` 回归不破坏

**可观测行为**: 新增路由不影响已有 `/health` endpoint，仍返回 200 + `{ok:true}`。

**验证命令**:
```bash
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true'
```

**硬阈值**: HTTP 200 + `.ok === true`

---

### Step 6: 单测套件全绿（`npm test` 在 `playground/` 内）

**可观测行为**: `playground/tests/server.test.js` 含 `/sum` happy path + 至少一个 error case，全部 pass；`/health` 用例继续 pass。

**验证命令**:
```bash
cd playground && npm ci --silent && npm test -- --reporter=verbose 2>&1 | tee /tmp/playground-unit.log
grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log
! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log
grep -E "GET /sum.*200" /tmp/playground-unit.log
grep -Ei "GET /sum.*(400|missing|invalid|error)" /tmp/playground-unit.log
```

**硬阈值**: vitest exit 0 + 日志含 `/sum.*200` 与 `/sum.*(400|error)` 各 ≥ 1 行

---

## §4 E2E 验收脚本（Evaluator 直接跑）

```bash
#!/bin/bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/playground"

# 阶段 A: 单测
npm ci --silent || (echo "[R4] npm ci 重试..."; sleep 2; npm ci --silent)
npm test -- --reporter=verbose 2>&1 | tee /tmp/playground-unit.log
grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log
! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log
grep -E "GET /sum.*200" /tmp/playground-unit.log
grep -Ei "GET /sum.*(400|missing|invalid|error)" /tmp/playground-unit.log

# 阶段 B: 真 server spawn + HTTP 端到端
export PLAYGROUND_PORT="${PLAYGROUND_PORT:-$(shuf -i 30000-40000 -n 1)}"
PORT=$PLAYGROUND_PORT
echo "[R1] PORT=$PORT"

node server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true" EXIT

SPAWN_OK=0
for i in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && SPAWN_OK=1 && break
  sleep 0.5
done
[ "$SPAWN_OK" = "1" ] || { echo "[R2] server spawn 失败"; exit 1; }

# Happy path — schema 字段值 + 完整性 + 禁用字段反向
RESP=$(curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3")
echo "$RESP" | jq -e '.sum == 5' >/dev/null
echo "$RESP" | jq -e '.sum | type == "number"' >/dev/null
echo "$RESP" | jq -e 'keys == ["sum"]' >/dev/null
echo "$RESP" | jq -e 'has("error") | not' >/dev/null

# Error path: 缺参
H=$(curl -s -o /tmp/sum-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=2")
[ "$H" = "400" ]
jq -e '.error | type == "string" and length > 0' /tmp/sum-miss.json >/dev/null
jq -e 'has("sum") | not' /tmp/sum-miss.json >/dev/null

# Error path: 非数字
H=$(curl -s -o /tmp/sum-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=abc&b=3")
[ "$H" = "400" ]
jq -e '.error | type == "string" and length > 0' /tmp/sum-nan.json >/dev/null
jq -e 'has("sum") | not' /tmp/sum-nan.json >/dev/null

# 边界数值
curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1"    | jq -e '.sum == 0' >/dev/null
curl -fsS "http://127.0.0.1:$PORT/sum?a=1.5&b=2.5" | jq -e '.sum == 4' >/dev/null
curl -fsS "http://127.0.0.1:$PORT/sum?a=0&b=0"     | jq -e '.sum == 0' >/dev/null

# 回归
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null

echo "OK Golden Path 验证通过"
```

**通过标准**: 脚本 `set -e` 下 exit 0。

**造假防御**:
1. 所有 curl 带 `-f`：HTTP 非 2xx 自动退 22
2. 所有 JSON 断言用 `jq -e`：false / 解析失败即非 0
3. `.sum == 5` 严格相等，防字符串 `"5"` 作弊
4. `has("sum") | not` error path 反向检查，防 `{sum:NaN, error:"..."}` 混合态
5. 单测 `grep Tests N passed` + `! grep Tests N failed`，防 0-test 假绿

---

## §5 Workstreams

workstream_count: 1

### Workstream 1: 加 `GET /sum` 路由 + 单测 + README

- **范围**: `playground/server.js` 新增 `/sum` handler；`playground/tests/server.test.js` 新增 `/sum` 用例；`playground/README.md` 更新端点段
- **大小**: S（< 100 行净增，3 文件）
- **依赖**: 无
- **BEHAVIOR 覆盖测试文件**: `sprints/w19-playground-sum/tests/ws1/sum.test.js`

---

## §6 Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| WS1 | `tests/ws1/sum.test.js` | happy path / 缺参 / 双参缺 / 非数字 / 负数 / 小数 / 零 / /health 回归 | 7 failures（T1-T7 全 FAIL — 无 /sum 路由时返 404）|
