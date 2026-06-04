# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD 字面 + 现有 `packages/brain/migrations/279_initiative_run_events.sql` 表结构）

> 现有 schema（migration 279，是当前生产实际）：
> ```
> id BIGSERIAL PRIMARY KEY, initiative_id UUID, node TEXT,
> status TEXT CHECK (status IN ('running','done','failed')),
> attempt INT, ts BIGINT  -- Unix 秒
> ```
> 本 sprint 给该表加 3 列（`ts_end BIGINT` / `cost_usd NUMERIC(10,4)` / `model TEXT`）+ 把 `'completed'` 加入 status CHECK 枚举（兼容现有 `'done'|'failed'`，不删除老值）。
> PK 字面是 `id`（BIGSERIAL），不是旧 migration 010 的 `event_id UUID`。所有 jq / SQL 必须用 `id`。

---

### Endpoint: POST /api/brain/harness/phase-event
**Request body**:
```json
{"initiative_id": "<uuid>", "node": "<string>", "status": "running", "model": "<string|null>"}
```
- `initiative_id` (uuid 字符串, 必填)
- `node` (string, 必填) — `planner|proposer|reviewer|generator|evaluator|reporter` 任一
- `status` (string, 必填) — POST 阶段固定 `"running"`
- `model` (string 或缺省, 可选) — skill 自报；可缺；缺则后端写 NULL

**Success (HTTP 200 OR 201)**:
```json
{"id": <number-or-numeric-string>, "initiative_id": "<uuid>", "node": "<string>", "status": "running", "model": "<string|null>", "ts": <number>}
```
- `id` (number 或 numeric-string, 必填) — 来源 PRD E2E 第 1 步 `jq -r '.id'` 字面要求；BIGSERIAL 经 node-pg 返回时为字符串形式的整数（node-pg 默认 bigint→string 防精度丢失），jq `-r` 也兼容
- `initiative_id` (uuid string, 必填) — 回显请求体
- `node` (string, 必填) — 回显请求体
- `status` (string, 必填) — 必须等于 `"running"`
- `model` (string 或 null, 必填字段位 — 值可 null) — 回显请求 model；缺省时为 null
- `ts` (number, 必填) — Unix 秒，后端 `EXTRACT(EPOCH FROM NOW())` 默认填入

**禁用字段名**（不得出现在 response 顶层 keys）:
- `event_id`（旧 migration 010 PK 名，不是当前 schema 279 字段）
- `phase`（与 `initiative_runs.phase` 字段重名概念混淆）
- `model_id`（PRD 字面是 `model`）
- `cost` / `usdCost` / `cost_amount`（PRD 字面是 `cost_usd`）
- `created_at`（当前 schema 没这列，时间列是 `ts` BIGINT）

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```
- `error` (string, 必填) — 非法 uuid、缺字段、未知 node 等

---

### Endpoint: PATCH /api/brain/harness/phase-event/:id
**Path param**: `:id` (BIGSERIAL 数字字符串，对应 POST 返回的 `id`)
**Request body**:
```json
{"status": "completed", "ts_end": <number>, "cost_usd": <number>}
```
- `status` (string, 必填) — 通常 `"completed"`；migration 必须扩 CHECK 接受
- `ts_end` (number, 必填) — Unix 毫秒（PRD E2E 用 `date +%s%3N`）；落库到 BIGINT 列
- `cost_usd` (number, 必填) — NUMERIC(10,4)；skill 自估，精度 ±30% 可接受

**Success (HTTP 200)**:
```json
{"id": <number-or-string>, "status": "completed", "ts_end": <number>, "cost_usd": <number>, "model": "<string|null>"}
```
- `id` (必填) — 同 POST 返回的 id
- `status` (string, 必填) — 回显请求体（通常 `"completed"`）
- `ts_end` (number, 必填) — 回显；`jq -e '.ts_end and .cost_usd'` PRD 字面要求 truthy
- `cost_usd` (number, 必填) — 回显；同上 truthy
- `model` (string or null, 必填字段位) — 回显 row 上原值（PATCH 不改 model）

> **⚠️ 时间列单位（v8.5 内部一致性修复）**: `ts` 列 = Unix **秒**（migration 279 `DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT`）；`ts_end` 列由客户端 `date +%s%3N` 写入 = Unix **毫秒**。两列单位不同，直接 `ts_end - ts` 误差 1000 倍。Reporter Step 6 计算 duration **必须**用 `(ts_end / 1000.0 - ts)` 秒；Generator 实现 SKILL.md Step 6 渲染公式时须采用此公式。

**禁用字段名**（PATCH response 同 POST 禁用清单完整对齐）:
- `endTs` / `end_ts` / `tsEnd`（PRD 字面 snake_case `ts_end`）
- `cost` / `usdCost` / `cost_amount`（PRD 字面 `cost_usd`）
- `event_id`（旧 migration 010 PK 名）
- `created_at`（当前 schema 无此列）

**Error (HTTP 404)**:
```json
{"error": "<string>"}
```
- 不存在的 `:id` → 404 + error 字段是字符串（防止 silent 0-row UPDATE 假绿）

---

## Golden Path
[运维点火 harness sprint] → [Migration 应用，schema 长出 3 列 + CHECK 扩 'completed'] → [phase 启动写 running 事件含 model（POST）] → [phase 结束写 completed 事件含 ts_end+cost_usd（PATCH）] → [Reporter 读 events 渲染 harness-report.md / index.html Phase 表格] → [Phase 表格显示真实数字]

---

### Step 1: Migration 293 应用 — initiative_run_events 长出 3 列 + status CHECK 允许 'completed'
**来源**: `[FROM_PRD]` — PRD「范围限定 → 在范围内」第 1 行字面 `ts_end BIGINT / cost_usd NUMERIC(10,4) / model TEXT`；status='completed' 来自 PRD Golden Path 第 2 步 + E2E DB 查询隐含

**可观测行为**: 新 migration 文件存在；`packages/brain/src/selfcheck.js` `EXPECTED_SCHEMA_VERSION` 从 `'292'` bump 到 `'293'`；migration 同时 (1) ADD COLUMN 3 列 (2) 扩 status CHECK 允许 `'completed'`（保留现有 `'running'|'done'|'failed'`，不能删除老枚举值）

**验证命令**:
```bash
# 1.1 新 migration 文件存在且含 3 列 ALTER + status CHECK 含 'completed'
MIG=packages/brain/migrations/293_initiative_run_events_phase_metrics.sql
test -f "$MIG" || { echo "FAIL: migration 293 文件不存在"; exit 1; }
grep -qE "ADD COLUMN.*ts_end.*BIGINT" "$MIG" || { echo "FAIL: 缺 ts_end BIGINT"; exit 1; }
grep -qE "ADD COLUMN.*cost_usd.*NUMERIC" "$MIG" || { echo "FAIL: 缺 cost_usd NUMERIC"; exit 1; }
grep -qE "ADD COLUMN.*model.*TEXT" "$MIG" || { echo "FAIL: 缺 model TEXT"; exit 1; }
grep -qE "CHECK.*completed|status.*IN.*completed" "$MIG" || { echo "FAIL: status CHECK 未含 'completed'"; exit 1; }
echo OK
```
**硬阈值**: 5 个 grep 全命中

```bash
# 1.2 selfcheck EXPECTED_SCHEMA_VERSION 字面 bump 到 '293'
grep -q "EXPECTED_SCHEMA_VERSION = '293'" packages/brain/src/selfcheck.js || { echo "FAIL: selfcheck 未 bump 到 293"; exit 1; }
echo OK
```

```bash
# 1.3 DB 三列实际存在（migration 已 apply）
COLS=$(psql cecelia -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='initiative_run_events' AND column_name IN ('ts_end','cost_usd','model')")
[ "$COLS" = "3" ] || { echo "FAIL: DB 三列不齐 got=$COLS"; exit 1; }
# CHECK 接受 'completed' — 试插再回滚
psql cecelia -tAc "BEGIN; INSERT INTO initiative_run_events (initiative_id, node, status) VALUES (gen_random_uuid(), 'planner', 'completed') RETURNING 1; ROLLBACK;" | grep -q '^1$' || { echo "FAIL: status='completed' 被 CHECK 拒"; exit 1; }
echo OK
```

---

### Step 2: POST /api/brain/harness/phase-event 接 model，落表
**来源**: `[FROM_PRD]` — PRD 范围限定第 2 行 `POST phase-event 接 model` + E2E 第 1 步字面

**可观测行为**: POST 请求体 `{initiative_id, node, status:"running", model}` → 返回 HTTP 2xx + JSON body 含 `id`；DB `initiative_run_events` 写入一行，`model` 列 = 请求传入值；`ts_end / cost_usd` 此时为 NULL

**验证命令**:
```bash
INIT_ID=$(uuidgen)
RESP=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event \
  -H 'Content-Type: application/json' \
  -d "{\"initiative_id\":\"$INIT_ID\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}")

# Schema 字段
echo "$RESP" | jq -e '.id' >/dev/null || { echo "FAIL: 缺 id"; exit 1; }
echo "$RESP" | jq -e '.model == "claude-opus-4-7"' >/dev/null || { echo "FAIL: model 未回显"; exit 1; }
echo "$RESP" | jq -e '.status == "running"' >/dev/null || { echo "FAIL: status 不对"; exit 1; }

# Schema 完整性 — 顶层 keys 含 id/initiative_id/node/status/model/ts
echo "$RESP" | jq -e 'has("id") and has("initiative_id") and has("node") and has("status") and has("model") and has("ts")' >/dev/null || { echo "FAIL: schema 不全"; exit 1; }

# 禁用字段反向检查
echo "$RESP" | jq -e '(has("event_id") | not) and (has("phase") | not) and (has("model_id") | not) and (has("cost") | not) and (has("created_at") | not)' >/dev/null || { echo "FAIL: 出现禁用字段"; exit 1; }

# DB 落库 — id 是 BIGSERIAL，用 PK 列名 'id' 查
EVENT_ID=$(echo "$RESP" | jq -r '.id')
MODEL_DB=$(psql cecelia -tAc "SELECT model FROM initiative_run_events WHERE id=$EVENT_ID" | tr -d ' ')
[ "$MODEL_DB" = "claude-opus-4-7" ] || { echo "FAIL: DB model 列未写入 got='$MODEL_DB'"; exit 1; }
NULLS=$(psql cecelia -tAc "SELECT count(*) FROM initiative_run_events WHERE id=$EVENT_ID AND ts_end IS NULL AND cost_usd IS NULL")
[ "$NULLS" = "1" ] || { echo "FAIL: POST 阶段 ts_end/cost_usd 应当为 NULL"; exit 1; }

echo OK
```
**硬阈值**: 5 个 jq -e 全过；DB model 列字面匹配；ts_end/cost_usd POST 时为 NULL

---

### Step 2.5: 同一 phase 重复 POST → 最后一次 model 覆盖（PRD 边界情况3）
**来源**: `[FROM_PRD]` — PRD「边界情况 → 同一 phase 重复 start：以最后一次为准（覆盖 ts / model）」字面

**可观测行为**: 同一 `{initiative_id, node}` 连续 POST 两次、第二次 `model` = `'claude-sonnet-4-6'`，第二次 POST 返回有效数字 id，DB 该行 `model` = `'claude-sonnet-4-6'`；实现可以是 UPSERT (ON CONFLICT) 或允许重复 INSERT（PRD 不限定实现方式，但结果语义必须是"最后一次 model 为准"）

**验证命令**:
```bash
INIT_ID=$(uuidgen)
# 第一次 POST — model=claude-opus-4-7
curl -fsS -X POST localhost:5221/api/brain/harness/phase-event \
  -H 'Content-Type: application/json' \
  -d "{\"initiative_id\":\"$INIT_ID\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" >/dev/null

# 第二次 POST — 同 initiative_id+node，不同 model
EID2=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event \
  -H 'Content-Type: application/json' \
  -d "{\"initiative_id\":\"$INIT_ID\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-sonnet-4-6\"}" \
  | jq -r '.id')
[[ "$EID2" =~ ^[0-9]+$ ]] || { echo "FAIL: 第二次 POST 返回 id 非数字 '$EID2'"; exit 1; }

# DB model 必须是第二次传入值
MODEL_FINAL=$(psql cecelia -tAc "SELECT model FROM initiative_run_events WHERE id=$EID2" | tr -d ' ')
[ "$MODEL_FINAL" = "claude-sonnet-4-6" ] || { echo "FAIL: 重复 POST 后 DB model 未覆盖 got='$MODEL_FINAL'"; exit 1; }
echo OK
```

**硬阈值**: DB `id=$EID2` 行 `model` 字面 = `'claude-sonnet-4-6'`（第二次传入值生效）

---

### Step 3: PATCH /api/brain/harness/phase-event/:id 接 ts_end + cost_usd
**来源**: `[FROM_PRD]` — PRD 范围限定第 2 行 `新增 PATCH phase-event/:id 接 ts_end + cost_usd` + E2E 第 2 步字面

**可观测行为**: 已存在的 event id，PATCH body `{status:"completed", ts_end, cost_usd}` → HTTP 200 + JSON 含 `ts_end / cost_usd / status="completed"`；DB 行三字段全部写入

**验证命令**:
```bash
INIT_ID=$(uuidgen)
EVENT_ID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event \
  -H 'Content-Type: application/json' \
  -d "{\"initiative_id\":\"$INIT_ID\",\"node\":\"generator\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" \
  | jq -r '.id')
[ -n "$EVENT_ID" ] && [ "$EVENT_ID" != "null" ] || { echo "FAIL: POST 未返 id"; exit 1; }

TS_END_MS=$(date +%s%3N)
PATCH_RESP=$(curl -fsS -X PATCH "localhost:5221/api/brain/harness/phase-event/$EVENT_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"status\":\"completed\",\"ts_end\":$TS_END_MS,\"cost_usd\":0.42}")

# PRD 字面 truthy 断言
echo "$PATCH_RESP" | jq -e '.ts_end and .cost_usd' >/dev/null || { echo "FAIL: PRD 字面 .ts_end and .cost_usd 失败"; exit 1; }

# 字段类型
echo "$PATCH_RESP" | jq -e '.ts_end | type == "number"' >/dev/null || { echo "FAIL: ts_end 非 number"; exit 1; }
echo "$PATCH_RESP" | jq -e '.cost_usd | type == "number"' >/dev/null || { echo "FAIL: cost_usd 非 number"; exit 1; }

# Status 翻 completed
echo "$PATCH_RESP" | jq -e '.status == "completed"' >/dev/null || { echo "FAIL: status 未翻 completed"; exit 1; }

# PATCH response 含 model 字段（Reviewer R4 — oracle completeness）
echo "$PATCH_RESP" | jq -e 'has("model")' >/dev/null || { echo "FAIL: PATCH response 缺 model 字段"; exit 1; }

# PATCH schema 完整性（id/status/ts_end/cost_usd/model 五必填字段）
echo "$PATCH_RESP" | jq -e 'has("id") and has("status") and has("ts_end") and has("cost_usd") and has("model")' >/dev/null || { echo "FAIL: PATCH schema 不全"; exit 1; }

# 禁用字段反向（含 event_id/created_at — 与 POST 禁用清单完整对齐）
echo "$PATCH_RESP" | jq -e '(has("endTs") | not) and (has("end_ts") | not) and (has("cost") | not) and (has("usdCost") | not) and (has("event_id") | not) and (has("created_at") | not)' >/dev/null || { echo "FAIL: 出现禁用字段"; exit 1; }

echo OK
```
**硬阈值**: 8 个 jq -e 全过；ts_end / cost_usd 是 number；status='completed'；model 字段存在

---

### Step 4: DB 三列均非 NULL（带时间窗口防造假）
**来源**: `[FROM_PRD]` — PRD E2E 第 3 步 `psql ... WHERE id='$EVENT_ID' AND ts_end IS NOT NULL AND cost_usd IS NOT NULL AND model IS NOT NULL`
**加 [AI_ADDED]**: 时间窗口 `AND ts > EXTRACT(EPOCH FROM NOW() - interval '5 minutes')::BIGINT` — 防止 generator 复用历史 event 假绿（B50 防造假最低线）

**可观测行为**: POST + PATCH 一气呵成后，DB 同一行 `ts_end / cost_usd / model` 均非 NULL；`ts`（POST 时填）落在最近 5 分钟内

**验证命令**:
```bash
INIT_ID=$(uuidgen)
EVENT_ID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event \
  -H 'Content-Type: application/json' \
  -d "{\"initiative_id\":\"$INIT_ID\",\"node\":\"evaluator\",\"status\":\"running\",\"model\":\"claude-sonnet-4-6\"}" \
  | jq -r '.id')
curl -fsS -X PATCH "localhost:5221/api/brain/harness/phase-event/$EVENT_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"status\":\"completed\",\"ts_end\":$(date +%s%3N),\"cost_usd\":0.55}" >/dev/null

FOUND=$(psql cecelia -tAc \
  "SELECT 1 FROM initiative_run_events
   WHERE id=$EVENT_ID
     AND ts_end IS NOT NULL
     AND cost_usd IS NOT NULL
     AND model IS NOT NULL
     AND ts > EXTRACT(EPOCH FROM NOW() - interval '5 minutes')::BIGINT")
[ "$FOUND" = "1" ] || { echo "FAIL: DB 三列写入不全或 ts 不在 5min 窗口"; exit 1; }
echo OK
```
**硬阈值**: psql 返回 `1`（带时间窗口）

---

### Step 5: Phase-event 写失败不阻断 pipeline + 5 个 skill 首尾各加调用
**来源**: `[FROM_PRD]` — PRD「边界情况 → phase-event 写失败：吞错继续」+ PRD 范围限定第 3 行「5 个 harness skill 首尾各加 phase-start / phase-end 调用」（PRD 字面 5 个：Planner/Proposer/Generator/Evaluator/Reporter，**不含 Reviewer**）

**可观测行为**: (1) `executor.js` 现有 `writeInitiativeRunEvent` 调用站点保持 try/catch 包裹（已存在，回归保护）；(2) 5 个 harness skill SKILL.md 首尾含 POST/PATCH phase-event 的 curl 片段（harness-planner / harness-contract-proposer / harness-generator / harness-evaluator / harness-report）；(3) 每个 skill 调用都用 `|| true` / `2>/dev/null` / `set +e` 形态吞错

**验证命令**:
```bash
# 5.1 executor 现有非致命 warn 字符串保留（回归保护）
grep -q "writeInitiativeRunEvent failed (non-fatal)" packages/brain/src/executor.js || { echo "FAIL: executor 非致命 warn 被删"; exit 1; }
echo OK
```

```bash
# 5.2 5 个 harness skill SKILL.md 全部含 phase-event 调用且带吞错兜底
SKILLS="harness-planner harness-contract-proposer harness-generator harness-evaluator harness-report"
for S in $SKILLS; do
  F="packages/workflows/skills/$S/SKILL.md"
  test -f "$F" || { echo "FAIL: $F 不存在"; exit 1; }
  grep -q "phase-event" "$F" || { echo "FAIL: $S 缺 phase-event 调用"; exit 1; }
  # 吞错兜底：phase-event 同行或下一行含 || true / 2>/dev/null / set +e / 注释 non-fatal
  grep -A3 'phase-event' "$F" | grep -qE '\|\| *true|2>/dev/null|set \+e|non-fatal' || { echo "FAIL: $S phase-event 调用无吞错兜底"; exit 1; }
done
echo OK
```
**硬阈值**: executor 关键字保留 + 5 个 skill 文件全部含 phase-event + 吞错兜底命中

---

### Step 6: Reporter Step 6 使用真实 events 数据
**来源**: `[FROM_PRD]` — PRD 范围限定第 4 行 `harness-report Step 6 改为从 initiative_run_events 读 Phase 维度数据`；PRD 范围限定第 5 行 `index.html 同步替换占位符`；E2E 第 4 步 `! grep -E '^\| *Reporter *\| *- ' harness-report.md`

**可观测行为**: `packages/workflows/skills/harness-report/SKILL.md` Step 6 包含从 `initiative_run_events` 读取 `node / ts_end - ts / cost_usd / model` 的逻辑（curl Brain API 或直查 DB）；模板引用 `cost_usd` / `model` / `ts_end` 关键字段；`index.html` 模板同步含字段占位符

**验证命令**:
```bash
REPORT_SKILL=packages/workflows/skills/harness-report/SKILL.md
test -f "$REPORT_SKILL" || { echo "FAIL: harness-report SKILL 不存在"; exit 1; }
grep -q "initiative_run_events" "$REPORT_SKILL" || { echo "FAIL: Step 6 未读 initiative_run_events"; exit 1; }
grep -qE "ts_end|duration|耗时" "$REPORT_SKILL" || { echo "FAIL: 模板缺耗时列"; exit 1; }
grep -qE "cost_usd|成本" "$REPORT_SKILL" || { echo "FAIL: 模板缺成本列"; exit 1; }
grep -qE "model|模型" "$REPORT_SKILL" || { echo "FAIL: 模板缺模型列"; exit 1; }
echo OK
```

```bash
# index.html 同步替换占位符
INDEX=$(find packages/workflows/skills/harness-report -name "index.html" 2>/dev/null | head -1)
[ -n "$INDEX" ] || { echo "FAIL: index.html 模板未找到"; exit 1; }
grep -qE "cost_usd|model|duration|ts_end" "$INDEX" || { echo "FAIL: index.html 未引用 phase 指标字段"; exit 1; }
echo OK
```

```bash
# 6.x duration 单位 sanity（Reviewer R1 — 修复 ts 秒/ts_end 毫秒 1000 倍误差）
# duration_secs = ts_end(ms) / 1000 - ts(s)；Reporter Step 6 必须用此公式
# 本检查验证 SKILL.md 含 "/1000" 或 "/ 1000" 或 "ms" 等单位处理关键字（静态检查）
REPORT_SKILL=packages/workflows/skills/harness-report/SKILL.md
grep -qE "ts_end\s*/\s*1000|ts_end.*1000|duration.*1000|1000\s*\.\s*0|1000\.0" "$REPORT_SKILL" \
  || { echo "FAIL: harness-report SKILL Step 6 缺 ts_end/1000 单位转换（ts=秒, ts_end=毫秒，直接相减误差1000倍）"; exit 1; }
echo OK
```
**硬阈值**: SKILL.md 4 个 grep + index.html 1 个 grep + duration 单位转换关键字全过

---

### Step 7: cost_usd NULL 时 Reporter 该行显示 '-'（PRD 边界情况 #2）
**来源**: `[FROM_PRD]` — PRD「边界情况 → cost_usd 缺失：后端写 NULL，Report 显示 '-'」字面要求

**可观测行为**: POST 一个 running 事件（不执行 PATCH），该行 `cost_usd` 列为 NULL；harness-report SKILL.md 含对 NULL cost_usd 的检查，输出 `-`（而非 `null`/`0`/`undefined`）

**验证命令**:
```bash
# harness-report SKILL.md 含 NULL cost_usd → '-' 守卫逻辑（静态检查）
REPORT_SKILL=packages/workflows/skills/harness-report/SKILL.md
grep -qE "cost_usd.*null|cost_usd.*IS NULL|cost_usd.*\\?.*-|cost_usd.*:-|null.*cost_usd|cost_usd.*'\\-'|cost_usd.*\"-\"" "$REPORT_SKILL" \
  || { echo "FAIL: harness-report SKILL 无 NULL cost_usd → '-' 处理逻辑"; exit 1; }
echo OK
```

```bash
# DB 验证：仅 POST（不 PATCH）的行 cost_usd 为 NULL
INIT_ID=$(uuidgen)
EID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event \
  -H 'Content-Type: application/json' \
  -d "{\"initiative_id\":\"$INIT_ID\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" | jq -r '.id')
[[ "$EID" =~ ^[0-9]+$ ]] || { echo "FAIL: POST 未返数字 id got='$EID'"; exit 1; }
NULL_CHECK=$(psql cecelia -tAc "SELECT 1 FROM initiative_run_events WHERE id=$EID AND cost_usd IS NULL" | tr -d ' ')
[ "$NULL_CHECK" = "1" ] || { echo "FAIL: POST 后 cost_usd 应为 NULL got='$NULL_CHECK'"; exit 1; }
echo OK
```
**硬阈值**: SKILL.md grep 命中 + DB cost_usd IS NULL（仅 POST 未 PATCH 的行）

---

### Step 8: Error path — PATCH 不存在的 event id 返 404 + error 字段
**来源**: `[AI_ADDED]` — PRD 没明写但 evaluator/reviewer 强制要求 error path 覆盖；不验则 generator 可以让 PATCH 静默对 0 行 UPDATE 假绿

**可观测行为**: PATCH 一个超大不可能存在的 BIGINT id → HTTP 404 + `{error: "<string>"}`

**验证命令**:
```bash
CODE=$(curl -s -o /tmp/_patch_err.json -w "%{http_code}" \
  -X PATCH "localhost:5221/api/brain/harness/phase-event/99999999999999" \
  -H 'Content-Type: application/json' \
  -d '{"status":"completed","ts_end":1,"cost_usd":0}')
[ "$CODE" = "404" ] || { echo "FAIL: 期望 404 实际 $CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/_patch_err.json >/dev/null || { echo "FAIL: 404 响应缺 error 字符串"; exit 1; }
echo OK
```
**硬阈值**: HTTP 404 + `.error` 是字符串

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
# Final E2E — sprint 收尾时跑，验证 Golden Path 全程
set -e

# 前置：localhost:5221 Brain 已起，cecelia DB 已 apply migration 293
curl -fsS localhost:5221/api/brain/health | jq -e '.ok == true' >/dev/null \
  || { echo "FAIL: Brain 不健康"; exit 1; }

INIT_ID=$(uuidgen)

# 1. POST phase-start（含 model）→ 拿 event id（PRD E2E 第 1 步字面）
EVENT_ID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event \
  -H 'Content-Type: application/json' \
  -d "{\"initiative_id\":\"$INIT_ID\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" \
  | jq -r '.id')
[ -n "$EVENT_ID" ] && [ "$EVENT_ID" != "null" ] || { echo "FAIL: POST 未返 id"; exit 1; }
echo "  ✓ POST id=$EVENT_ID"

# 2. PATCH phase-end（含 ts_end + cost_usd）（PRD E2E 第 2 步字面）
curl -fsS -X PATCH "localhost:5221/api/brain/harness/phase-event/$EVENT_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"status\":\"completed\",\"ts_end\":$(date +%s%3N),\"cost_usd\":0.42}" \
  | jq -e '.ts_end and .cost_usd' >/dev/null \
  || { echo "FAIL: PATCH response 缺字段"; exit 1; }
echo "  ✓ PATCH ts_end + cost_usd written"

# 3. DB 三列均非 NULL（PRD E2E 第 3 步，但用正确 PK 列名 id 而不是 event_id；加 5min 时间窗口防造假）
FOUND=$(psql cecelia -tAc \
  "SELECT 1 FROM initiative_run_events
   WHERE id=$EVENT_ID
     AND ts_end IS NOT NULL
     AND cost_usd IS NOT NULL
     AND model IS NOT NULL
     AND ts > EXTRACT(EPOCH FROM NOW() - interval '5 minutes')::BIGINT")
[ "$FOUND" = "1" ] || { echo "FAIL: DB 三列写入不全"; exit 1; }
echo "  ✓ DB three columns non-NULL within 5min window"

# 4. Error path — PATCH 不存在 id → 404 + error
CODE=$(curl -s -o /tmp/_e.json -w "%{http_code}" \
  -X PATCH "localhost:5221/api/brain/harness/phase-event/99999999999999" \
  -H 'Content-Type: application/json' -d '{"status":"completed","ts_end":1,"cost_usd":0}')
[ "$CODE" = "404" ] || { echo "FAIL: 期望 404 实际 $CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/_e.json >/dev/null || { echo "FAIL: 404 缺 error 字段"; exit 1; }
echo "  ✓ Error path PATCH /nonexistent → 404"

# 5. Reporter SKILL Step 6 已切换到读 events 表（静态检查，不实跑 Reporter）
grep -q "initiative_run_events" packages/workflows/skills/harness-report/SKILL.md \
  || { echo "FAIL: Reporter SKILL Step 6 未读 events 表"; exit 1; }
echo "  ✓ Reporter SKILL references initiative_run_events"

# 6. 5 个 skill 首尾各含 phase-event 调用（PRD 字面 5 个，不含 Reviewer）
for S in harness-planner harness-contract-proposer harness-generator harness-evaluator harness-report; do
  grep -q "phase-event" "packages/workflows/skills/$S/SKILL.md" \
    || { echo "FAIL: $S 缺 phase-event 调用"; exit 1; }
done
echo "  ✓ 5 skill SKILL.md include phase-event calls"

# 7. PRD 验收第 4 条 — Reporter 行无占位符（如果 sprint dir 含 harness-report.md）
SPRINT_REPORT="${SPRINT_DIR:-.}/harness-report.md"
if [ -f "$SPRINT_REPORT" ]; then
  ! grep -E '^\| *Reporter *\| *- ' "$SPRINT_REPORT" \
    || { echo "FAIL: Reporter 行仍有占位符"; exit 1; }
  echo "  ✓ harness-report.md Reporter 行无占位符"
fi

echo "✅ harness phase metrics e2e 通过"
```

**通过标准**: 脚本 exit 0

---

## Risks

| # | 风险 | 概率 | 影响 | Mitigation |
|---|---|---|---|---|
| R1 | **DDL LOCK** — `initiative_run_events` 在 Brain 运行期 `ADD COLUMN` 持排他锁；若并发写事务等待超时，pipeline 节点会 hang | 低（dev 低流量）| 中（pipeline hang）| migration 使用 `ADD COLUMN ... IF NOT EXISTS`；deploy 时先停 Brain → apply migration → 重启（标准流程）；本 sprint 不部署生产，仅 PR 内 schema 文件 + local selfcheck |
| R2 | **initiative_id 注入缺失** — 老版 Brain 派发路径若未向 skill prompt 注入 `initiative_id`，skill 调用 POST phase-event 会缺字段，接口返 400 | 中（依赖 prompt 注入格式）| 低（吞错不阻断）| skill 调用 phase-event 必须带 `\|\| true` 兜底（Step 5 合同已验证）；Generator 在 skill 首行加 `INITIATIVE_ID="${INITIATIVE_ID:-}"` 空值检测，缺则 skip（不报错） |
| R3 | **Migration 序号抢占** — 并行 PR 可能已使用 293，导致两个 PR 的 migration 号冲突 | 中（多人并行开发）| 低（migration 失败早发现）| Generator 写 migration 文件前先 `ls packages/brain/migrations/29*.sql` 确认 292 当前最大值；若 293 已存在则改用 294 并同步 selfcheck |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| migration 293 + selfcheck | `tests/migration-293.test.ts` | 文件含 3 ADD COLUMN + status CHECK 'completed'；selfcheck = '293' | 文件不存在 / grep miss → FAIL |
| POST phase-event 接 model | `tests/post-phase-event.test.ts` | POST body 4 字段 → response 含 id/model/status；禁用字段不暴露；DB model 列字面命中 | 路由未注册 / writeInitiativeRunEvent 不接 model → 404/500 FAIL |
| PATCH phase-event ts_end/cost_usd | `tests/patch-phase-event.test.ts` | PATCH body → response 含 ts_end/cost_usd 是 number + status='completed'；DB 三列非 NULL；不存在 id → 404 | PATCH 路由未注册 → 404/405 全 FAIL |
| 5 skill phase-event 调用 + 吞错 | `tests/skill-phase-event-calls.test.ts` | 5 个 SKILL.md grep phase-event + 吞错兜底字面（PRD 字面：planner/proposer/generator/evaluator/reporter，不含 reviewer） | 当前 SKILL.md 没这段 → grep 全 FAIL |
| Reporter Step 6 引用 events | `tests/report-step6-refs-events.test.ts` | harness-report SKILL.md 含 'initiative_run_events' 字面 + 三列关键字 | 当前 Step 6 硬编码 `-` → grep FAIL |
| 重复 POST 最后 model 覆盖 | `tests/harness-phase-event.test.ts` | harness.js 有 POST 路由 + initiativeRunEvents.js 含 model 参数（边界情况3 静态红） | 路由未注册 / model 参数缺失 → FAIL |
