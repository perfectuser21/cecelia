# Sprint Contract Draft (Round 1)

## Golden Path

[入口 GET /choose?n=5&k=2] → [strict-schema 校验 n,k（^\d+$）] → [范围校验 n≤20, k≤n] → [迭代计算 C(5,2)=10] → [出口 HTTP 200 {"choose":10}]

---

### Step 1: 客户端发起 GET /choose?n=5&k=2 请求，server 接收并返回 HTTP 200

**可观测行为**: playground server 在配置端口接受带 n/k query 参数的 GET 请求，返回 HTTP 200 + JSON body

**验证命令**:
```bash
cd /workspace/playground && PLAYGROUND_PORT=3011 node server.js &
SPID=$!
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=5&k=2")
kill $SPID 2>/dev/null; wait $SPID 2>/dev/null
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: 期望 200，got $HTTP_CODE"; exit 1; }
echo "PASS: HTTP 200"
```

**硬阈值**: HTTP 200，耗时 < 2s

---

### Step 2: strict-schema 校验 n, k（正向：^\d+$，反向：非法输入拒 400）

**可观测行为**: n 或 k 缺失 / 匹配不到 `^\d+$`（负号、小数、字母、科学计数法等）→ HTTP 400 + `{"error":"..."}`

**验证命令**:
```bash
# 缺 k 参数
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=5")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 k 应 400，got $CODE"; exit 1; }

# n 含负号（违反 ^\d+$）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=-1&k=0")
[ "$CODE" = "400" ] || { echo "FAIL: n=-1 应 400，got $CODE"; exit 1; }

# k 是小数
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=5&k=1.5")
[ "$CODE" = "400" ] || { echo "FAIL: k=1.5 应 400，got $CODE"; exit 1; }

echo "PASS: strict-schema 校验"
```

**硬阈值**: 非法输入 → HTTP 400

---

### Step 3: 范围校验（n>20 拒，k>n 拒）

**可观测行为**: n=21 → 400；k > n → 400；即使数值合法也拒绝越界

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=21&k=0")
[ "$CODE" = "400" ] || { echo "FAIL: n=21 应 400，got $CODE"; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=3&k=5")
[ "$CODE" = "400" ] || { echo "FAIL: k>n 应 400，got $CODE"; exit 1; }

echo "PASS: 范围校验"
```

**硬阈值**: 越界输入 → HTTP 400

---

### Step 4: 核心计算 + Response Schema 严格验证（含 W41 0! 基底 oracle）

**可观测行为**:
- `GET /choose?n=5&k=2` → `{"choose": 10}`（happy path）
- `GET /choose?n=5&k=0` → `{"choose": 1}`（**W41 核心 oracle**，依赖 0!=1，round 1 generator 极易在此失败）
- `GET /choose?n=0&k=0` → `{"choose": 1}`（C(0,0)=1，0! 基底最小边界）
- `GET /choose?n=20&k=0` → `{"choose": 1}`（C(20,0)=1，同依赖 0!=1）
- `GET /choose?n=5&k=5` → `{"choose": 1}`（k=n 对称，分母含 0!）
- `GET /choose?n=20&k=10` → `{"choose": 184756}`（精度上界）
- Response 顶层 keys 完全等于 `["choose"]`，不允许多余字段

**验证命令**:
```bash
# Happy path
RESP=$(curl -fs "localhost:3011/choose?n=5&k=2")
echo "$RESP" | jq -e '.choose == 10' || { echo "FAIL: choose(5,2) 应为 10"; exit 1; }

# Schema 完整性 — keys 精确等于 ["choose"]
echo "$RESP" | jq -e 'keys == ["choose"]' || { echo "FAIL: keys 不是 [\"choose\"]"; exit 1; }

# W41 核心 oracle：k=0 基底（round 1 预期失败点）
RESP0=$(curl -fs "localhost:3011/choose?n=5&k=0")
echo "$RESP0" | jq -e '.choose == 1' || { echo "FAIL: choose(5,0) 应为 1（0! 基底）"; exit 1; }

RESP00=$(curl -fs "localhost:3011/choose?n=0&k=0")
echo "$RESP00" | jq -e '.choose == 1' || { echo "FAIL: choose(0,0) 应为 1"; exit 1; }

RESP200=$(curl -fs "localhost:3011/choose?n=20&k=0")
echo "$RESP200" | jq -e '.choose == 1' || { echo "FAIL: choose(20,0) 应为 1"; exit 1; }

# k=n 对称
RESP55=$(curl -fs "localhost:3011/choose?n=5&k=5")
echo "$RESP55" | jq -e '.choose == 1' || { echo "FAIL: choose(5,5) 应为 1"; exit 1; }

# 精度上界
RESP2010=$(curl -fs "localhost:3011/choose?n=20&k=10")
echo "$RESP2010" | jq -e '.choose == 184756' || { echo "FAIL: choose(20,10) 应为 184756"; exit 1; }

# 禁用字段反向检查
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("answer") | not' || { echo "FAIL: 禁用字段 answer 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("c") | not' || { echo "FAIL: 禁用字段 c 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("cnk") | not' || { echo "FAIL: 禁用字段 cnk 漏网"; exit 1; }

echo "PASS: 核心计算 + Schema 验证"
```

**硬阈值**: choose(5,0)=1, choose(0,0)=1, choose(20,0)=1, keys=["choose"]，禁用字段不存在

---

### Step 5: Error Response Schema 验证

**可观测行为**: 非法输入 → HTTP 400 + `{"error": "<非空 string>"}` + error body keys 精确等于 `["error"]`

**验证命令**:
```bash
ERESP=$(curl -s "localhost:3011/choose?n=21&k=0")
echo "$ERESP" | jq -e '.error | type == "string"' || { echo "FAIL: error 应为 string"; exit 1; }
echo "$ERESP" | jq -e '.error | length > 0' || { echo "FAIL: error 不能为空字符串"; exit 1; }
echo "$ERESP" | jq -e 'keys == ["error"]' || { echo "FAIL: error body keys 不是 [\"error\"]"; exit 1; }
echo "$ERESP" | jq -e 'has("choose") | not' || { echo "FAIL: error body 含 choose 字段"; exit 1; }

echo "PASS: Error Response Schema"
```

**硬阈值**: error 字段为非空 string，keys 精确等于 `["error"]`，不含 `choose`

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# 启动 playground server（独立端口）
cd /workspace/playground
PLAYGROUND_PORT=3011 node server.js &
SPID=$!
sleep 2

cleanup() { kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; }
trap cleanup EXIT

# ─── Happy path ───
RESP=$(curl -fs "localhost:3011/choose?n=5&k=2")
echo "$RESP" | jq -e '.choose == 10' || { echo "FAIL: choose(5,2)"; exit 1; }
echo "$RESP" | jq -e 'keys == ["choose"]' || { echo "FAIL: schema keys"; exit 1; }

# ─── W41 核心 oracle：k=0 基底（round 1 预期失败点）───
echo "$RESP0" 2>/dev/null || true
RESP=$(curl -fs "localhost:3011/choose?n=5&k=0")
echo "$RESP" | jq -e '.choose == 1' || { echo "FAIL: choose(5,0) 0! 基底"; exit 1; }

RESP=$(curl -fs "localhost:3011/choose?n=0&k=0")
echo "$RESP" | jq -e '.choose == 1' || { echo "FAIL: choose(0,0)"; exit 1; }

RESP=$(curl -fs "localhost:3011/choose?n=20&k=0")
echo "$RESP" | jq -e '.choose == 1' || { echo "FAIL: choose(20,0)"; exit 1; }

RESP=$(curl -fs "localhost:3011/choose?n=5&k=5")
echo "$RESP" | jq -e '.choose == 1' || { echo "FAIL: choose(5,5) k=n 对称"; exit 1; }

RESP=$(curl -fs "localhost:3011/choose?n=20&k=10")
echo "$RESP" | jq -e '.choose == 184756' || { echo "FAIL: choose(20,10) 精度上界"; exit 1; }

RESP=$(curl -fs "localhost:3011/choose?n=10&k=3")
echo "$RESP" | jq -e '.choose == 120' || { echo "FAIL: choose(10,3)"; exit 1; }

# ─── 禁用字段反向检查 ───
RESP=$(curl -fs "localhost:3011/choose?n=5&k=2")
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result"; exit 1; }
echo "$RESP" | jq -e 'has("answer") | not' || { echo "FAIL: 禁用字段 answer"; exit 1; }
echo "$RESP" | jq -e 'has("c") | not' || { echo "FAIL: 禁用字段 c"; exit 1; }
echo "$RESP" | jq -e 'has("cnk") | not' || { echo "FAIL: 禁用字段 cnk"; exit 1; }
echo "$RESP" | jq -e 'has("combination") | not' || { echo "FAIL: 禁用字段 combination"; exit 1; }
echo "$RESP" | jq -e 'has("binomial") | not' || { echo "FAIL: 禁用字段 binomial"; exit 1; }

# ─── Error path ───
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=5")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 k 应 400"; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?k=2")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 n 应 400"; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=21&k=0")
[ "$CODE" = "400" ] || { echo "FAIL: n=21 应 400"; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=3&k=5")
[ "$CODE" = "400" ] || { echo "FAIL: k>n 应 400"; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=-1&k=0")
[ "$CODE" = "400" ] || { echo "FAIL: n=-1 应 400"; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/choose?n=1.5&k=0")
[ "$CODE" = "400" ] || { echo "FAIL: n=1.5 应 400"; exit 1; }

# Error body schema
ERESP=$(curl -s "localhost:3011/choose?n=21&k=0")
echo "$ERESP" | jq -e '.error | type == "string"' || { echo "FAIL: error 应为 string"; exit 1; }
echo "$ERESP" | jq -e 'keys == ["error"]' || { echo "FAIL: error body keys"; exit 1; }

# ─── 回归检查 ───
curl -fs "localhost:3011/health" | jq -e '.ok == true' || { echo "FAIL: /health 回归"; exit 1; }

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 2

### Workstream 1: playground/server.js 新增 GET /choose 路由

**范围**: 在 `/factorial` 路由之后、`app.listen` 之前新增 `GET /choose` 路由。strict-schema 校验 `^\d+$`（n、k 各自独立）+ n>20 上界拒 + k>n 范围拒 + 迭代计算 C(n,k)（对称性 `Math.min(k, n-k)` + 乘法递推），≈ 20 行
**大小**: S(<100行)
**依赖**: 无

---

### Workstream 2: 单测 + README

**范围**: `playground/tests/server.test.js` 新增完整 `describe('GET /choose')` 块（happy 7+, k=0 oracle 3+, k=n 1+, 上界拒 2+, k>n 拒 2+, strict-schema 拒 6+, schema oracle 1+, 值 oracle 4+, 回归 5+）；`playground/README.md` 补 `/choose` 端点文档
**大小**: M(100-300行)
**依赖**: Workstream 1 完成后

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/w41-playground-choose/tests/ws1/choose-route.test.ts` | happy path / schema keys / 禁用字段 / error path | /choose 不存在时全 fail（404） |
| WS2 | `playground/tests/server.test.js` | 完整 describe('GET /choose')，含 k=0 oracle / k=n / 精度上界 / schema / 回归 | 合并 WS1 后由 vitest 全量验证 |
