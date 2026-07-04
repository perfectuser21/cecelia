# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面 + api_registry 推导（harness.js /runs 端点命名风格）+ NEW_PATTERN 字段）

### Endpoint: GET /api/brain/orchestrator/relay-runs

**Success (HTTP 200)**:
```json
[
  {
    "id": "<uuid>",
    "initiative_id": "<uuid>",
    "phase": "<string>",
    "orchestrator_heartbeat_at": "<timestamp|null>",
    "orchestrator_host": "<string|null>",
    "pr_url": "<string|null>",
    "started_at": "<timestamp>",
    "deadline_at": "<timestamp|null>"
  }
]
```

- `id` (string/uuid, 必填): 来源 — PRD Golden Path 明确列出
- `initiative_id` (string/uuid, 必填): 来源 — PRD Golden Path 明确列出；字段命名与 harness.js `/runs` 端点保持一致
- `phase` (string, 必填): 来源 — PRD Golden Path 明确列出
- `orchestrator_heartbeat_at` (string|null, 必填): 来源 — PRD Golden Path 明确列出；migration 312 新增列
- `orchestrator_host` (string|null, 必填): 来源 — PRD Golden Path 明确列出；migration 312 新增列
- `pr_url` (string|null): 来源 — PRD ASSUMPTION 说明可能缺列，仅在列存在时返回；[NEW_PATTERN: 条件性字段]
- `started_at` (string/timestamp, 必填): 来源 — PRD Golden Path 明确列出
- `deadline_at` (string|null, 必填): 来源 — PRD Golden Path 明确列出；migration 312 新增列

**无 v2 run 时**:
```json
[]
```

**禁用字段名**: `version`, `orchestratorVersion`, `relay_version`, `run_id`（勿与 `id` 混用）

**Error (HTTP 4xx/5xx)**:
```json
{"error": "<string>"}
```

---

## 已知约束（来自回归测试）

- [harness-skill-relay.test.js] → INSERT INTO initiative_runs 须含 orchestrator_version 列（migration 312）
- [harness-skill-relay.test.js] → initiative_runs phase=A_planning + orchestrator_version='v2'
- [migration-312-orchestrator.test.js] → initiative_runs 表新增列含 orchestrator_version TEXT NOT NULL DEFAULT 'v1'
- [migration-312-orchestrator.test.js] → orchestrator_version CHECK IN ('v1','v2')

---

## Golden Path

[运维者发 GET 请求] → [Brain 查 initiative_runs WHERE orchestrator_version='v2'] → [返回 JSON 数组]

---

### Step 1: 运维者调用 GET /api/brain/orchestrator/relay-runs

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步「运维者发送 GET /api/brain/orchestrator/relay-runs」

**可观测行为**: Brain 返回 HTTP 200，body 为 JSON 数组（可空）

**验证命令**:
```bash
# 端点返回 200 且 body 为 JSON 数组
RESP=$(curl -sf localhost:5221/api/brain/orchestrator/relay-runs) || { echo "FAIL: 端点未返回 200（路由未注册或服务异常）"; exit 1; }
echo "$RESP" | jq -e 'type == "array"' || { echo "FAIL: body 不是 JSON 数组"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200 + body 为 JSON 数组

---

### Step 2: Brain 查询 orchestrator_version='v2' 的 initiative_runs，按 started_at DESC 排序

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步「Brain 查询 initiative_runs WHERE orchestrator_version='v2'，按 started_at DESC 排序」

**可观测行为**: 返回的数组仅包含 orchestrator_version='v2' 的 run，每项含 PRD 指定字段；无 v2 run 时返回空数组

**验证命令**:
```bash
# 插入一条 v2 run 记录，验证端点能返回并包含该记录
START_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TEST_INIT_ID=$(psql "$DB" -t -c "INSERT INTO initiatives (id, task_id, journey_id, status) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'running') RETURNING id" 2>/dev/null | tr -d ' \n') || TEST_INIT_ID="00000000-0000-0000-0000-000000000001"
TEST_RUN_ID=$(psql "$DB" -t -c "INSERT INTO initiative_runs (initiative_id, phase, orchestrator_version, started_at) VALUES ('$TEST_INIT_ID', 'A_planning', 'v2', NOW()) RETURNING id" | tr -d ' \n')
[ -n "$TEST_RUN_ID" ] || { echo "FAIL: 无法插入测试 v2 run"; exit 1; }

RESP=$(curl -sf "localhost:5221/api/brain/orchestrator/relay-runs")
echo "$RESP" | jq -e --arg rid "$TEST_RUN_ID" 'map(.id) | index($rid) != null' || { echo "FAIL: 新插入的 v2 run 未出现在响应中"; psql "$DB" -c "DELETE FROM initiative_runs WHERE id='$TEST_RUN_ID'"; exit 1; }

# 验证每项含必填字段
echo "$RESP" | jq -e 'first | has("id") and has("initiative_id") and has("phase") and has("started_at")' || { echo "FAIL: 响应项缺少必填字段"; exit 1; }

# 清理测试数据
psql "$DB" -c "DELETE FROM initiative_runs WHERE id='$TEST_RUN_ID'" > /dev/null 2>&1 || true
echo OK
```

**硬阈值**: 新插入 v2 run 能在响应数组中找到；每项含 id/initiative_id/phase/started_at

---

### Step 3: ?limit=N 参数限制返回条数

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步「返回指定条数」 + 边界情况「?limit=N → 最多返回 N 条」

**可观测行为**: limit=1 时最多返回 1 条记录；默认（无 limit）返回最多 20 条

**验证命令**:
```bash
# 插入 3 条 v2 run，验证 limit=2 只返回 2 条
for i in 1 2 3; do
  psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase, orchestrator_version, started_at) VALUES (gen_random_uuid(), 'A_planning', 'v2', NOW() - interval '$((i*10)) seconds')" > /dev/null
done

COUNT=$(curl -sf "localhost:5221/api/brain/orchestrator/relay-runs?limit=2" | jq 'length')
[ "$COUNT" -le 2 ] || { echo "FAIL: limit=2 返回了 $COUNT 条"; exit 1; }
echo OK
```

**硬阈值**: 返回条数 ≤ limit 参数值

---

### Step 4: 无 v2 run 时返回空数组，HTTP 200

**来源**: `[FROM_PRD]` — PRD 边界情况「无 v2 run → 返回 []，HTTP 200，不报错」

**可观测行为**: 端点在无 v2 记录时返回 `[]`，HTTP 200

**验证命令**:
```bash
# 清空 v2 run（测试环境专用，需要 DB 权限）或直接在干净 DB 上验证
# 使用过滤断言：如果端点返回 200 且为数组，即使有数据也是合规的（空数组场景由单测覆盖）
RESP=$(curl -sf "localhost:5221/api/brain/orchestrator/relay-runs") || { echo "FAIL: 返回非 200"; exit 1; }
echo "$RESP" | jq -e 'type == "array"' || { echo "FAIL: 无 v2 run 时 body 不是数组"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200 + JSON 数组（含空数组 `[]`）

---

### Step 5: DB 查询失败返回 HTTP 500 + JSON error 字段

**来源**: `[FROM_PRD]` — PRD 边界情况「DB 查询失败 → HTTP 500 + {"error": "<message>"} JSON，不崩进程」

**可观测行为**: 当 DB 不可用时，端点返回 HTTP 500，body 为 `{"error": "..."}` JSON，不抛出未捕获异常

**验证命令**:
```bash
# DB 错误场景由单元测试覆盖（mock pool.query 抛错）
# E2E 层：验证 test 文件存在且覆盖 500 路径
node -e "
  const c = require('fs').readFileSync('packages/brain/src/__tests__/relay-runs.test.js', 'utf8');
  if (!c.includes('500') || !c.includes('error')) { process.exit(1); }
  console.log('OK: 单元测试覆盖 500 路径');
" || { echo "FAIL: relay-runs.test.js 未覆盖 500/error 路径"; exit 1; }
```

**硬阈值**: 单元测试覆盖 DB 错误 → 500 + error 字段路径

---

### Step 6: 端点返回字段完整性（keys 集合符合 PRD 定义）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止 generator 返回多余字段（如 orchestrator_version 泄露内部 flag）或遗漏 PRD 必填字段；schema drift 是常见假通过根因

**可观测行为**: 响应数组每项 keys 仅含 PRD 指定字段

**验证命令**:
```bash
# 如果有 v2 run，验证第一项 keys 集合是 PRD 所列字段的子集
RESP=$(curl -sf "localhost:5221/api/brain/orchestrator/relay-runs")
LEN=$(echo "$RESP" | jq 'length')
if [ "$LEN" -gt 0 ]; then
  UNEXPECTED=$(echo "$RESP" | jq -r 'first | keys[] | select(. != "id" and . != "initiative_id" and . != "phase" and . != "orchestrator_heartbeat_at" and . != "orchestrator_host" and . != "pr_url" and . != "started_at" and . != "deadline_at")')
  [ -z "$UNEXPECTED" ] || { echo "FAIL: 响应包含 PRD 未列字段: $UNEXPECTED"; exit 1; }
fi
echo OK
```

**硬阈值**: 响应项 keys ⊆ {id, initiative_id, phase, orchestrator_heartbeat_at, orchestrator_host, pr_url, started_at, deadline_at}

---

## 接缝清单

**本 sprint 接缝分析**：「这功能在哪几个点碰真实世界？」

| # | 接缝点 | 真实世界碰触 | 验证方式 | 状态 |
|---|---|---|---|---|
| 1 | `initiative_runs` 表的 `orchestrator_version` 列是否存在 | DB schema（migration 312） | 端点 curl 返回 200 而非 500 列不存在错误即可判断 | 逻辑断言（单测 mock）+ 接缝（live DB curl） |
| 2 | `pr_url` 列是否存在（PRD ASSUMPTION） | DB schema | 若列不存在 SELECT 会失败；端点应 fallback 去掉该字段 | `logic-done-pending`（需 Generator 处理 SELECT 列表） |

---

## E2E 验收

<!-- GOLDEN_SMOKE_ABILITY_SLUG: relay-runs-endpoint -->

**journey_type**: autonomous
**target_environment**: local_api

<!-- GOLDEN_SMOKE_SCENARIO: relay-runs-happy-path -->

```bash
#!/bin/bash
# final-e2e 验证脚本 — GET /api/brain/orchestrator/relay-runs（local_api）
# evaluator 在本机 localhost:5221 执行
set -e

DB="${DB:-postgresql://localhost/cecelia}"
BRAIN="localhost:5221"

echo "=== Step 1: 端点可达，返回 200 + JSON 数组 ==="
RESP=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs") || { echo "FAIL: 端点未返回 200（路由未注册）"; exit 1; }
echo "$RESP" | jq -e 'type == "array"' || { echo "FAIL: body 不是 JSON 数组"; exit 1; }
echo "PASS: 端点可达"

echo "=== Step 2: 插入 v2 run 并验证出现在响应中 ==="
SCRIPT_START=$(date -u +%s)

# 尝试插入测试 initiative（若 initiatives 表存在）
TEST_INIT_ID=$(psql "$DB" -t -c \
  "INSERT INTO initiatives (id, task_id, journey_id, status) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'running') RETURNING id" \
  2>/dev/null | tr -d ' \n') || true

if [ -z "$TEST_INIT_ID" ]; then
  # fallback：直接使用 random uuid（外键约束可能不存在）
  TEST_INIT_ID=$(psql "$DB" -t -c "SELECT gen_random_uuid()" | tr -d ' \n')
fi

TEST_RUN_ID=$(psql "$DB" -t -c \
  "INSERT INTO initiative_runs (initiative_id, phase, orchestrator_version, started_at)
   VALUES ('$TEST_INIT_ID', 'A_planning', 'v2', NOW())
   RETURNING id" | tr -d ' \n')
[ -n "$TEST_RUN_ID" ] || { echo "FAIL: 无法插入测试 v2 run（migration 312 是否已跑？）"; exit 1; }
echo "插入 test run: $TEST_RUN_ID"

RESP=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs")
echo "$RESP" | jq -e --arg rid "$TEST_RUN_ID" 'map(.id) | index($rid) != null' \
  || { echo "FAIL: 新插入的 v2 run 未出现在响应中"; psql "$DB" -c "DELETE FROM initiative_runs WHERE id='$TEST_RUN_ID'" > /dev/null 2>&1; exit 1; }
echo "PASS: v2 run 出现在响应数组中"

echo "=== Step 3: 每项含 PRD 必填字段 ==="
echo "$RESP" | jq -e 'first | has("id") and has("initiative_id") and has("phase") and has("started_at")' \
  || { echo "FAIL: 响应项缺少必填字段（id/initiative_id/phase/started_at）"; exit 1; }
echo "PASS: 必填字段存在"

echo "=== Step 4: limit 参数生效 ==="
LIMIT_RESP=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs?limit=1")
COUNT=$(echo "$LIMIT_RESP" | jq 'length')
[ "$COUNT" -le 1 ] || { echo "FAIL: limit=1 返回了 $COUNT 条"; exit 1; }
echo "PASS: limit 参数生效"

echo "=== Step 5: 无 v2 run 或有 v2 run 均返回 200 + 数组 ==="
RESP2=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs") || { echo "FAIL: 端点 500"; exit 1; }
echo "$RESP2" | jq -e 'type == "array"' || { echo "FAIL: body 不是数组"; exit 1; }
echo "PASS: 空/非空均返回数组"

# 清理
psql "$DB" -c "DELETE FROM initiative_runs WHERE id='$TEST_RUN_ID'" > /dev/null 2>&1 || true

echo "✅ relay-runs Golden Path 验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| relay-runs 端点 | `packages/brain/src/__tests__/relay-runs.test.js` | 正常返回 / limit / DB 错误 500 / 空结果 | → 4 failures（路由未注册时） |
