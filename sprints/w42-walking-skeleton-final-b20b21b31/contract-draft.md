# Sprint Contract Draft (Round 1)

## Golden Path

[Brain 接收 thin_prd] → [Generator 新增 /negate 路由+测试] → [CI npm test 通过] → [Evaluator curl 严验 schema] → [PR merge + task.status=completed]

---

### Step 1: Brain 调度 harness_initiative 任务

**可观测行为**: Brain 收到 PRD 后，在 tasks 表新建一条 `task_type=harness_initiative` 记录，status 从 queued → in_progress

**验证命令**:
```bash
psql $DB -t -c "SELECT status FROM tasks WHERE task_type='harness_initiative' AND payload::text LIKE '%negate%' ORDER BY created_at DESC LIMIT 1" | tr -d ' '
# 期望：in_progress 或 completed
```

**硬阈值**: tasks 表含对应记录，status ∈ {in_progress, completed}

---

### Step 2: Generator 新增 GET /negate 路由

**可观测行为**: `playground/server.js` 出现 `/negate` 路由代码；`GET /negate?value=5` 返回 `{"result":-5,"operation":"negate"}`

**验证命令**:
```bash
grep -q "negate" playground/server.js && echo ARTIFACT_OK
# 期望：ARTIFACT_OK
```

**硬阈值**: server.js 含 negate 关键字；路由响应 schema 严格合规（见 Step 4）

---

### Step 3: CI npm test 通过

**可观测行为**: `playground/tests/server.test.js` 新增 `describe('GET /negate')` 块；`npm test` 在 playground/ 内全通过

**验证命令**:
```bash
cd playground && npm test 2>&1 | tail -5
# 期望：包含 "passed" 且无 "failed"
```

**硬阈值**: npm test exit 0；无 failed 断言

---

### Step 4: Evaluator 严验 /negate schema（核心）

**可观测行为**: 独立进程 curl `GET /negate?value=5` 返回的 JSON 满足：
- `result` 字段值为 `-5`（number 类型）
- `operation` 字段值为字面量 `"negate"`
- 顶层 keys 完全等于 `["operation","result"]`，无多余字段
- 禁用字段 `negated`/`negative`/`value` 不存在
- `value=0` 返回 `result=0`（正零，非 `-0`）
- 非法输入返回 HTTP 400

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3091 node server.js &
SPID=$!
sleep 2

RESP=$(curl -fs "localhost:3091/negate?value=5")
echo "$RESP" | jq -e '.result == -5' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "negate"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["operation","result"]' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("negated") | not' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("negative") | not' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("value") | not' || { kill $SPID; exit 1; }

RESP0=$(curl -fs "localhost:3091/negate?value=0")
echo "$RESP0" | jq -e '.result == 0' || { kill $SPID; exit 1; }
echo "$RESP0" | jq -e '.result | tostring == "0"' || { kill $SPID; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3091/negate?value=foo")
[ "$CODE" = "400" ] || { kill $SPID; exit 1; }

kill $SPID
echo "✅ Evaluator schema 全过"
```

**硬阈值**: 所有 jq -e 断言 exit 0；错误路径返回 400

---

### Step 5: PR 合并 main，task.status=completed

**可观测行为**: Brain 触发 `gh pr merge --auto`；PR merged；tasks 表对应记录 status=completed

**验证命令**:
```bash
psql $DB -t -c "SELECT status FROM tasks WHERE task_type='harness_initiative' AND payload::text LIKE '%negate%' ORDER BY created_at DESC LIMIT 1" | tr -d ' '
# 期望：completed
```

**硬阈值**: status = completed；PR URL 在 dev_records 表有记录

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd /workspace/playground

# 启动 playground 服务
PLAYGROUND_PORT=3092 node server.js &
SPID=$!
sleep 2

cleanup() { kill $SPID 2>/dev/null || true; }
trap cleanup EXIT

BASE="localhost:3092"

# 1. success path: value=5 → {result:-5, operation:"negate"}
RESP=$(curl -fs "${BASE}/negate?value=5")
echo "$RESP" | jq -e '.result == -5' || { echo "FAIL: result != -5"; exit 1; }
echo "$RESP" | jq -e '.operation == "negate"' || { echo "FAIL: operation != negate"; exit 1; }

# 2. schema 完整性 — keys 恰好 ["operation","result"]
echo "$RESP" | jq -e 'keys == ["operation","result"]' || { echo "FAIL: schema keys 不匹配"; exit 1; }

# 3. 禁用字段反向检查
echo "$RESP" | jq -e 'has("negated") | not' || { echo "FAIL: 禁用字段 negated 存在"; exit 1; }
echo "$RESP" | jq -e 'has("negative") | not' || { echo "FAIL: 禁用字段 negative 存在"; exit 1; }
echo "$RESP" | jq -e 'has("value") | not' || { echo "FAIL: 禁用字段 value 存在"; exit 1; }
echo "$RESP" | jq -e 'has("answer") | not' || { echo "FAIL: 禁用字段 answer 存在"; exit 1; }

# 4. value=0 → result=0（正零，非 -0）
RESP0=$(curl -fs "${BASE}/negate?value=0")
echo "$RESP0" | jq -e '.result == 0' || { echo "FAIL: value=0 result != 0"; exit 1; }
echo "$RESP0" | jq -e '.result | tostring == "0"' || { echo "FAIL: value=0 返回了 -0"; exit 1; }

# 5. 负数取反
RESPN=$(curl -fs "${BASE}/negate?value=-7")
echo "$RESPN" | jq -e '.result == 7' || { echo "FAIL: value=-7 result != 7"; exit 1; }

# 6. error path: 非数字 → 400
CODE_FOO=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/negate?value=foo")
[ "$CODE_FOO" = "400" ] || { echo "FAIL: value=foo 返回 $CODE_FOO 非 400"; exit 1; }

# 7. error path: value 缺失 → 400
CODE_MISSING=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/negate")
[ "$CODE_MISSING" = "400" ] || { echo "FAIL: value 缺失返回 $CODE_MISSING 非 400"; exit 1; }

# 8. error path: value=1.5（小数）→ 400
CODE_FLOAT=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/negate?value=1.5")
[ "$CODE_FLOAT" = "400" ] || { echo "FAIL: value=1.5 返回 $CODE_FLOAT 非 400"; exit 1; }

# 9. error 响应 schema: error 字段为非空 string
ERR_RESP=$(curl -s "${BASE}/negate?value=foo")
echo "$ERR_RESP" | jq -e '.error | type == "string" and length > 0' || { echo "FAIL: error 字段不合规"; exit 1; }
echo "$ERR_RESP" | jq -e 'keys == ["error"]' || { echo "FAIL: error 响应 schema keys 不匹配"; exit 1; }
echo "$ERR_RESP" | jq -e 'has("message") | not' || { echo "FAIL: 禁用字段 message 存在"; exit 1; }

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /negate 路由 + 测试 + README

**范围**: `playground/server.js` 新增 /negate 路由；`playground/tests/server.test.js` 新增测试块；`playground/README.md` 补充说明
**大小**: S（净增 ≤ 35 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/negate.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/negate.test.ts` | schema 字段值 / keys 完整性 / 禁用字段反向 / error path | /negate 路由不存在 → 多条 404/undefined failure |
