# Sprint Contract Draft (Round 2)

> **Round 2 变更**: 基于 Round 1 评审反馈（verdict: APPROVED）合并以下补充：
> - [MINOR-1] 新增 BEHAVIOR「runs 按 created_at DESC 排序」的单元测试（第 13 条）
> - [MINOR-2] 在 Risks/Generator 执行摘要中强化 `cost_usd::float8` cast 说明
> - [NOTICE] 路由顺序（GET /initiative-runs 位于 GET /initiative-runs/:id 之前）保持原有约定

## Golden Path

操作员调用 `GET /api/brain/harness/initiative-runs` →  
Brain API 查询 `initiative_runs` 表 →  
返回最近 N 条 run 记录，含 phase/timing/failure_reason/journey_type。

---

### Step 1: GET /initiative-runs 无过滤返回默认 50 条

**来源**: `[FROM_PRD]` — PRD「Golden Path」段第 1 条

**可观测行为**: GET /api/brain/harness/initiative-runs 响应 HTTP 200，body 顶层 keys 精确为 `["runs","total"]`，runs 是数组，total 是 number

**验证命令**:
```bash
RESP=$(curl -sf localhost:5221/api/brain/harness/initiative-runs)
echo "$RESP" | jq -e 'keys == ["runs","total"]' || { echo "FAIL: 顶层 keys 不符"; exit 1; }
echo "$RESP" | jq -e '.runs | type == "array"' || { echo "FAIL: runs 不是数组"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 不是 number"; exit 1; }
echo "$RESP" | jq -e '.total == (.runs | length)' || { echo "FAIL: total != runs 数组长度"; exit 1; }
echo "✅ Step 1 验证通过"
```

**硬阈值**: HTTP 200；顶层 keys 精确等于 `["runs","total"]`；total == runs 数组长度

---

### Step 2: phase 过滤 — runs 中每条 phase 均匹配查询值

**来源**: `[FROM_PRD]` — PRD「Golden Path」段第 2 条 + Response Schema

**可观测行为**: GET /api/brain/harness/initiative-runs?phase=done 返回的 runs 数组中每条记录的 phase 字段均为 `"done"`

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?phase=done")
echo "$RESP" | jq -e '[.runs[].phase == "done"] | all' || { echo "FAIL: runs 中存在 phase != done 的记录"; exit 1; }
echo "✅ Step 2 验证通过"
```

**硬阈值**: runs 数组每条记录 phase == "done"（可以是空数组，但不得混入其他 phase）

---

### Step 3: journey_id 过滤 — 返回仅含指定 journey_id 的 run

**来源**: `[FROM_PRD]` — PRD「Golden Path」段第 3 条

**可观测行为**: GET /api/brain/harness/initiative-runs?journey_id=\<uuid\> 返回的 runs 数组中每条记录的 journey_id 字段均等于查询值

**验证命令**:
```bash
# 取第一条有 journey_id 的 run；无则跳过
JID=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs" | jq -r '[.runs[] | select(.journey_id != null)] | .[0].journey_id // empty')
[ -z "$JID" ] && { echo "SKIP: 无带 journey_id 的 run"; exit 0; }
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?journey_id=$JID")
echo "$RESP" | jq -e --arg jid "$JID" '[.runs[].journey_id == $jid] | all' || { echo "FAIL: runs 中存在 journey_id 不匹配的记录"; exit 1; }
echo "✅ Step 3 验证通过"
```

**硬阈值**: runs 每条 journey_id 等于请求参数值

---

### Step 4: run 记录字段集合符合 Schema

**来源**: `[FROM_PRD]` — PRD「Response Schema」段字段完整列表

**可观测行为**: runs 中每条记录含 id/initiative_id/phase/journey_type/journey_id/created_at/completed_at/deadline_at/failure_reason/cost_usd，不含 contract_id/current_task_id/merged_task_ids

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?limit=1")
RUN_COUNT=$(echo "$RESP" | jq '.runs | length')

if [ "$RUN_COUNT" -gt 0 ]; then
  # 必须包含的字段
  for FIELD in id initiative_id phase journey_type journey_id created_at completed_at deadline_at failure_reason cost_usd; do
    echo "$RESP" | jq -e ".runs[0] | has(\"$FIELD\")" || { echo "FAIL: 缺少字段 $FIELD"; exit 1; }
  done

  # 禁止包含的字段
  for BANNED in contract_id current_task_id merged_task_ids; do
    echo "$RESP" | jq -e ".runs[0] | has(\"$BANNED\") | not" || { echo "FAIL: 禁用字段 $BANNED 存在"; exit 1; }
  done
fi

echo "✅ Step 4 验证通过"
```

**硬阈值**: 必须含全部 10 个字段；禁用字段 contract_id/current_task_id/merged_task_ids 不得出现

---

### Step 5: limit 非整数或超出 1-100 返回 HTTP 400

**来源**: `[FROM_PRD]` — PRD「边界情况」+ Error Schema

**可观测行为**: limit=abc 和 limit=0 和 limit=101 均返回 HTTP 400，body 含 `error` 字段，描述 "invalid limit: must be integer 1-100"

**验证命令**:
```bash
for BADLIMIT in abc 0 101 -1; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative-runs?limit=$BADLIMIT")
  [ "$CODE" = "400" ] || { echo "FAIL: limit=$BADLIMIT 期望 400，实际 $CODE"; exit 1; }
  ERR=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?limit=$BADLIMIT" || curl -s "localhost:5221/api/brain/harness/initiative-runs?limit=$BADLIMIT")
  echo "$ERR" | jq -e '.error | test("invalid limit")' || { echo "FAIL: limit=$BADLIMIT error 字段不符 ($ERR)"; exit 1; }
done
echo "✅ Step 5 验证通过"
```

**硬阈值**: limit=abc/0/101/-1 均返回 HTTP 400；error 字段含 "invalid limit"

---

### Step 6: journey_id 不是合法 UUID 返回 HTTP 400

**来源**: `[FROM_PRD]` — PRD「边界情况」+ Error Schema

**可观测行为**: journey_id=not-a-uuid 返回 HTTP 400，body `{"error":"invalid journey_id: must be a UUID"}`

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative-runs?journey_id=not-a-uuid")
[ "$CODE" = "400" ] || { echo "FAIL: 期望 400，实际 $CODE"; exit 1; }
ERR=$(curl -s "localhost:5221/api/brain/harness/initiative-runs?journey_id=not-a-uuid")
echo "$ERR" | jq -e '.error == "invalid journey_id: must be a UUID"' || { echo "FAIL: error 字段不符: $ERR"; exit 1; }
echo "✅ Step 6 验证通过"
```

**硬阈值**: HTTP 400；error == "invalid journey_id: must be a UUID"

---

### Step 7: phase 为空字符串时忽略过滤（等价无 phase 参数）

**来源**: `[FROM_PRD]` — PRD「边界情况」段

**可观测行为**: `?phase=` 等价于不带 phase 参数，返回全部 phase 的 runs，无 400 错误

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative-runs?phase=")
[ "$CODE" = "200" ] || { echo "FAIL: phase= 期望 200，实际 $CODE"; exit 1; }
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?phase=")
echo "$RESP" | jq -e '.runs | type == "array"' || { echo "FAIL: runs 不是数组"; exit 1; }
echo "✅ Step 7 验证通过"
```

**硬阈值**: HTTP 200；runs 是数组

---

### Step 8: 空结果时 runs=[] total=0（不返回 404）

**来源**: `[FROM_PRD]` — PRD「边界情况」段

**可观测行为**: 使用一个不可能存在的 phase 值查询，返回 HTTP 200，body 为 `{"runs":[],"total":0}`

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative-runs?phase=nonexistent_phase_xyz")
echo "$RESP" | jq -e '.runs == [] and .total == 0' || { echo "FAIL: 空结果不符: $RESP"; exit 1; }
echo "✅ Step 8 验证通过"
```

**硬阈值**: HTTP 200；runs == []；total == 0

---

## Risks

### Risk 1: initiative_runs 表中 cost_usd 字段为 NUMERIC 类型，JSON 序列化可能返回字符串而非 number

**场景**: PostgreSQL NUMERIC 类型在 node-postgres 中默认序列化为字符串（不是 JavaScript number），导致 cost_usd 类型不符合 PRD 中 `number or null` 的要求。

**影响**: 调用方（前端/脚本）对 cost_usd 做数值运算时得到 NaN 或字符串拼接，误报数据。

**Mitigation**: Generator 必须在 SELECT 语句中用 `cost_usd::float` 强制转换，或用 `CAST(cost_usd AS float8)` 确保 JSON 序列化为 number 而非字符串。

### Risk 2: limit 默认值为 50 与最大值 100 的边界，若未校验 limit=100 将错误返回 400

**场景**: 边界校验条件写成 `limit > 100` 与 `limit >= 100` 容易混淆，导致 limit=100 被拒绝。

**影响**: 合法请求被拒，运维操作受阻。

**Mitigation**: 校验条件明确为 `limit < 1 || limit > 100`（即 100 合法），测试用例覆盖 limit=100 成功返回 200。

---

## E2E 验收（final-e2e — target_environment = brain）

**journey_type**: autonomous
**target_environment**: brain

```bash
#!/usr/bin/env bash
# final-e2e: GET /api/brain/harness/initiative-runs 端点验收
set -e

BASE="localhost:5221/api/brain/harness/initiative-runs"

echo "=== E2E 1: 默认请求返回 200 + runs 数组 + total number ==="
RESP=$(curl -sf "$BASE")
echo "$RESP" | jq -e 'keys == ["runs","total"]' || { echo "FAIL E2E 1a: 顶层 keys 不符"; exit 1; }
echo "$RESP" | jq -e '.runs | type == "array"' || { echo "FAIL E2E 1b: runs 不是数组"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL E2E 1c: total 不是 number"; exit 1; }
echo "$RESP" | jq -e '.total == (.runs | length)' || { echo "FAIL E2E 1d: total != runs 长度"; exit 1; }
echo "✅ E2E 1 通过"

echo "=== E2E 2: phase=done 过滤 ==="
RESP=$(curl -sf "$BASE?phase=done")
echo "$RESP" | jq -e '[.runs[].phase == "done"] | all' || { echo "FAIL E2E 2: 存在非 done phase"; exit 1; }
echo "✅ E2E 2 通过"

echo "=== E2E 3: limit=abc 返回 400 ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE?limit=abc")
[ "$CODE" = "400" ] || { echo "FAIL E2E 3: 期望 400，实际 $CODE"; exit 1; }
echo "✅ E2E 3 通过"

echo "=== E2E 4: journey_id=not-a-uuid 返回 400 ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE?journey_id=not-a-uuid")
[ "$CODE" = "400" ] || { echo "FAIL E2E 4: 期望 400，实际 $CODE"; exit 1; }
ERR=$(curl -s "$BASE?journey_id=not-a-uuid")
echo "$ERR" | jq -e '.error == "invalid journey_id: must be a UUID"' || { echo "FAIL E2E 4b: error 字段不符"; exit 1; }
echo "✅ E2E 4 通过"

echo "=== E2E 5: 空结果时 runs=[] total=0 ==="
RESP=$(curl -sf "$BASE?phase=nonexistent_phase_xyz")
echo "$RESP" | jq -e '.runs == [] and .total == 0' || { echo "FAIL E2E 5: 空结果不符"; exit 1; }
echo "✅ E2E 5 通过"

echo "✅ 所有 E2E 验收通过"
```

**通过标准**: 脚本 exit 0；所有 5 条断言均输出 "通过"

---

## Workstreams

workstream_count: 1

### Workstream 1: Brain API — GET /initiative-runs 列表端点

**范围**: `packages/brain/src/routes/harness.js` 在现有 `GET /initiative-runs/:id` 之前新增 `GET /initiative-runs` 路由（无路径参数），查询 `initiative_runs` 表，支持 phase/journey_id/limit 过滤

**大小**: S (<80 行)

**依赖**: 无

**BEHAVIOR**:
- [ ] [BEHAVIOR] GET /initiative-runs 无参数返回 HTTP 200，顶层 keys 精确等于 `["runs","total"]`
- [ ] [BEHAVIOR] total 等于 runs 数组实际长度
- [ ] [BEHAVIOR] runs 按 created_at DESC 排序（路由不破坏 DB 返回顺序；SQL ORDER BY 正确性由 E2E 验证）
- [ ] [BEHAVIOR] runs 每条含 id/initiative_id/phase/journey_type/journey_id/created_at/completed_at/deadline_at/failure_reason/cost_usd 共 10 个字段
- [ ] [BEHAVIOR] runs 每条不含 contract_id/current_task_id/merged_task_ids
- [ ] [BEHAVIOR] cost_usd 序列化为 number 或 null（不是字符串；Generator 须用 `cost_usd::float8`）
- [ ] [BEHAVIOR] limit 默认 50，最大 100；limit=100 成功返回 200
- [ ] [BEHAVIOR] limit 非整数、<1 或 >100 → HTTP 400，error 含 "invalid limit: must be integer 1-100"
- [ ] [BEHAVIOR] journey_id 不是合法 UUID → HTTP 400，error == "invalid journey_id: must be a UUID"
- [ ] [BEHAVIOR] phase 为空字符串 → 忽略过滤，正常返回 200
- [ ] [BEHAVIOR] 空结果 → HTTP 200，`{"runs":[],"total":0}`
- [ ] [BEHAVIOR] 路由不破坏 DB 返回的 created_at 顺序（newer 在前）

**对应合同 Step**: Step 1~8（排序测试对应 Workstream BEHAVIOR 第 12 条，单元层验证路由不打乱顺序）

---

## Workstreams 切分自查

- WS1: ~70 行 (≤ 200 ✅)，1 文件 (≤ 3 ✅)
- 总净增: ~70 行（单 WS 合理，PRD 范围限定 1 文件 1 路由）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（机检命令） |
|---|---|---|---|
| WS1 | `sprints/cecelia-harness-runs-api/tests/ws1/harness-runs-list.test.js` | 全部 12 条 BEHAVIOR（含排序） | `npx vitest run sprints/cecelia-harness-runs-api/tests/ws1/harness-runs-list.test.js 2>&1` |

---

## Generator 执行摘要（必读）

1. 在 `packages/brain/src/routes/harness.js` 中，在 `router.get('/initiative-runs/:id', ...)` **之前**新增 `router.get('/initiative-runs', ...)`
2. SQL SELECT 必须：`cost_usd::float8 AS cost_usd`，并 `ORDER BY created_at DESC`，默认 `LIMIT 50`
3. SQL SELECT 不含 `contract_id`、`current_task_id`、`merged_task_ids`
4. 运行 `npx vitest run sprints/cecelia-harness-runs-api/tests/ws1/harness-runs-list.test.js` 确认 **13/13 全绿**（第 13 条为新增排序测试）后提 PR
