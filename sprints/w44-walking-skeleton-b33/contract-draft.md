# Sprint Contract Draft (Round 1)

## Golden Path
客户端 → `GET /negate?value=N` → playground strict-schema 整数校验 → 200 `{result:-N, operation:"negate"}`；违规 → 400 `{error:"..."}`

### Step 1: 客户端发 GET /negate?value=<整数>，返成功 schema

**可观测行为**: playground 返回 HTTP 200 + `{result: -N, operation: "negate"}`（result 是 number，operation 是字面 "negate"）

**验证命令**:
```bash
cd /workspace && PLAYGROUND_PORT=3001 node playground/server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3001/negate?value=5")
echo "$RESP" | jq -e '.result == -5' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "negate"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: result = -5（input=5），operation 字面 "negate"，HTTP 200

---

### Step 2: response schema 完整性（keys 恰为 ["operation","result"]）

**可观测行为**: response 顶层 keys 完全等于 `["operation","result"]`，不多不少

**验证命令**:
```bash
cd /workspace && PLAYGROUND_PORT=3002 node playground/server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3002/negate?value=5")
echo "$RESP" | jq -e 'keys == ["operation","result"]' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: `keys == ["operation","result"]`（字母序，jq keys 自动排序）

---

### Step 3: 禁用响应字段名反向验证

**可观测行为**: response 不含 `negated`/`negative`/`inverted`（generator 不许漂移到禁用字段名）

**验证命令**:
```bash
cd /workspace && PLAYGROUND_PORT=3003 node playground/server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3003/negate?value=5")
echo "$RESP" | jq -e 'has("negated") | not' || { echo "FAIL: 禁用字段 negated 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("negative") | not' || { echo "FAIL: 禁用字段 negative 漏网"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("inverted") | not' || { echo "FAIL: 禁用字段 inverted 漏网"; kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 禁用字段全部不存在

---

### Step 4: 非法 value（非整数）→ 400 + error 字段

**可观测行为**: `value=abc` → HTTP 400 + `{error: "<非空 string>"}`；error response keys 恰为 `["error"]`

**验证命令**:
```bash
cd /workspace && PLAYGROUND_PORT=3004 node playground/server.js & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3004/negate?value=abc")
[ "$CODE" = "400" ] || { echo "FAIL: abc 未返 400，实际 $CODE"; kill $SPID; exit 1; }
ERRRESP=$(curl -s "localhost:3004/negate?value=abc")
echo "$ERRRESP" | jq -e '.error | type == "string" and length > 0' || { echo "FAIL: error 字段缺失或为空"; kill $SPID; exit 1; }
echo "$ERRRESP" | jq -e 'keys == ["error"]' || { echo "FAIL: error response 多余 key"; kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: HTTP 400，error 为非空 string，error response `keys == ["error"]`

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd /workspace

PLAYGROUND_PORT=3011 node playground/server.js & SPID=$!
sleep 2

# 1. 正数 negate — result 字段值 + operation 字面值
RESP=$(curl -fs "localhost:3011/negate?value=5")
echo "$RESP" | jq -e '.result == -5' || { echo "FAIL: result != -5"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "negate"' || { echo "FAIL: operation != negate"; kill $SPID; exit 1; }

# 2. Schema 完整性
echo "$RESP" | jq -e 'keys == ["operation","result"]' || { echo "FAIL: keys 不完整"; kill $SPID; exit 1; }

# 3. 禁用字段反向
echo "$RESP" | jq -e 'has("negated") | not' || { echo "FAIL: 禁用字段 negated 出现"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("negative") | not' || { echo "FAIL: 禁用字段 negative 出现"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("inverted") | not' || { echo "FAIL: 禁用字段 inverted 出现"; kill $SPID; exit 1; }

# 4. 负数取反
RESP2=$(curl -fs "localhost:3011/negate?value=-5")
echo "$RESP2" | jq -e '.result == 5' || { echo "FAIL: negate(-5) != 5"; kill $SPID; exit 1; }
echo "$RESP2" | jq -e '.operation == "negate"' || { echo "FAIL: operation != negate for neg input"; kill $SPID; exit 1; }

# 5. Error path — 非整数
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/negate?value=abc")
[ "$CODE" = "400" ] || { echo "FAIL: abc 未返 400"; kill $SPID; exit 1; }
ERRRESP=$(curl -s "localhost:3011/negate?value=abc")
echo "$ERRRESP" | jq -e '.error | type == "string" and length > 0' || { echo "FAIL: error 字段缺失"; kill $SPID; exit 1; }
echo "$ERRRESP" | jq -e 'keys == ["error"]' || { echo "FAIL: error response 多余 key"; kill $SPID; exit 1; }

# 6. Error path — 禁用 query 名
CODE2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3011/negate?n=5")
[ "$CODE2" = "400" ] || { echo "FAIL: 禁用 query 名 n 未返 400"; kill $SPID; exit 1; }

kill $SPID
echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 GET /negate（路由 + 测试 + README）

**范围**: `playground/server.js` 加 GET /negate 路由（strict 整数校验 + schema）；`playground/tests/server.test.js` 加 `describe('GET /negate')`（6 场景）；`playground/README.md` 加 `/negate` 段
**大小**: S（三文件净增 ~90 行，< 200 行；≤ 3 文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/negate.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/negate.test.ts` | schema字段值/keys完整性/禁用字段反向/error-path-非整数/禁用query名/负数取反 | WS1 → 6 failures（/negate 路由尚不存在，均 404） |
