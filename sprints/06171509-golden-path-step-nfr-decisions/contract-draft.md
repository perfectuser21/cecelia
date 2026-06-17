# Sprint Contract Draft (Round 1)

## 范围
重塑 `golden_path` 表为唯一正模型（`owner_task_id` / `order_no` / `feature_id` / `note`），
重写 3 个 golden_path 端点，给 `POST /decisions` 补 `target_type=golden_path` 存在性校验，
新增 2 个决策读回视图（按步 / 按 task 整条 golden path）。纯 Brain 后端，无 UI。

## 已知约束（来自回归测试）

- [packages/brain/src/routes/__tests__/abilities.test.js] → `GET /golden_path 返回数组（按 order_no）`
- [packages/brain/src/routes/__tests__/abilities.test.js] → `POST /golden_path 缺字段返回 400`
- [packages/brain/src/routes/__tests__/abilities.test.js] → `POST /abilities 查 journey_features 而非 abilities（kind 字段必须存在）`
- [packages/brain/src/routes/__tests__/abilities.test.js] → `POST /decisions level 校验`（DECISION_LEVELS = area/ability/feature/step）

> ⚠️ 旧 golden_path 回归用例断言旧模型字段（`scope_type` / `ability_id`），本 sprint 重塑表后
> 这些旧用例必须同步重写为 `owner_task_id` / `feature_id`，不能保留对已删除列的断言（否则回归红）。
> [ASSUMPTION] golden_path 表 0 行，可直接 DROP 旧列重建，无数据迁移。

## Response Schema（推导来源: api_registry 推导 — 复用 abilities.js 现有 `INSERT ... RETURNING *` 行返回风格）

### Endpoint: POST /api/brain/golden_path
**Success (HTTP 201)**:
```json
{"id": "<uuid>", "owner_task_id": "<uuid>", "order_no": 1, "feature_id": "<uuid>", "note": null, "created_at": "<ts>"}
```
- `id` (uuid, 必填): 该 golden_path 步的主键 — 来源 INSERT RETURNING（对齐现有 POST /golden_path 返回整行）
- `owner_task_id` (uuid, 必填): FK→tasks.id — 来源 PRD Golden Path Step 1 字面
- `order_no` (integer, 必填): 该 task 内步骤序号 — 来源 PRD 范围限定（index `(owner_task_id, order_no)`）
- `feature_id` (uuid, 必填): FK→journey_features.id — 来源 PRD Golden Path Step 1 字面
- `note` (string|null, 选填): 步骤说明 — 来源 PRD 范围限定 `note` 列
**禁用字段名**（旧错模型遗留，contract 任何正向断言严禁出现）: `scope_type`, `scope_id`, `ability_id`
**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

### Endpoint: POST /api/brain/decisions （本 sprint 仅补 golden_path 校验分支，复用现有写入）
**Success (HTTP 201)**:
```json
{"id": "<uuid>", "category": "nfr", "topic": "前后台", "decision": "后台静默", "level": "step", "target_type": "golden_path", "target_id": "<uuid>", "scope": "v1", "created_at": "<ts>"}
```
- `id` (uuid, 必填): 决策主键 — 来源现有 decisions INSERT RETURNING
- `level` (string, 必填): 字面 `"step"` — 来源 PRD Golden Path Step 2（decisions_level_chk 已允许 'step'）
- `target_type` (string, 必填): 字面 `"golden_path"` — 来源 PRD Step 2（decisions_target_type_chk 已允许 'golden_path'）
- `target_id` (uuid, 必填): 指向 golden_path.id — 来源 PRD Step 2
- `scope` (string, 选填): 字面 `"v1"` — 来源 PRD Step 2（decisions_scope_chk 已允许 'v1'）
**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

### Endpoint: GET /api/brain/golden_path/:id/decisions?scope=v1
**Success (HTTP 200)**: 决策行数组（无匹配返回 `[]`，不报错）
```json
[{"id": "<uuid>", "level": "step", "target_type": "golden_path", "target_id": "<step_id>", "scope": "v1", "category": "nfr", "topic": "前后台", "decision": "后台静默"}]
```

### Endpoint: GET /api/brain/tasks/:id/golden-path-decisions?category=nfr&scope=v1
**Success (HTTP 200)**: 该 task 整条 golden path（按 owner_task_id join）所有步骤决策数组（无匹配返回 `[]`）
```json
[{"id": "<uuid>", "level": "step", "target_type": "golden_path", "target_id": "<step_id>", "scope": "v1", "category": "nfr", "topic": "前后台", "decision": "后台静默", "order_no": 1}]
```
- 每行附 `order_no`（来自 join 的 golden_path.order_no），便于按步骤顺序读 NFR 验收单

---

## Golden Path
[migration 303 应用] → [POST /golden_path 建步] → [POST /decisions 挂 NFR 到步] → [GET 按步读回] → [GET 按 task 整条读回 NFR 验收单]

### Step 0: migration 303 重塑 golden_path 表
**来源**: `[FROM_PRD]` — PRD「范围限定·在范围内」第 1 项 + 「预期受影响文件」`migrations/303_*.sql`

**可观测行为**: migration 303 应用后，`golden_path` 表含 `owner_task_id`(FK tasks) / `order_no` / `feature_id`(FK journey_features) / `note`，旧 `scope_type` / `scope_id` / `ability_id` 列已移除，存在 index `(owner_task_id, order_no)`。

**验证命令**:
gate-allow: domain/db-no-time-window 本节 count(*) 查的是 information_schema.columns（schema 结构内省，无 created_at，不存在历史数据冒充），非业务数据聚合，时间窗不适用
```bash
psql "$DB_URL" < packages/brain/migrations/303_*.sql
# 新列存在
psql "$DB_URL" -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name IN ('owner_task_id','feature_id')" | tr -d ' ' | grep -qx 2 || { echo "FAIL: 新列缺失"; exit 1; }
# 旧列已移除
psql "$DB_URL" -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name IN ('scope_type','scope_id','ability_id')" | tr -d ' ' | grep -qx 0 || { echo "FAIL: 旧列残留"; exit 1; }
echo OK
```

**硬阈值**: 新列计数 = 2 且旧列计数 = 0
**验证命令**: 见上（两条 `grep -qx` 直接驱动 exit code）

---

### Step 1: 用户 POST /golden_path 建一条 golden path 步（含 task 存在性校验）
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」具体步骤 1：`POST /api/brain/golden_path` 带 `{owner_task_id, order_no:1, feature_id}` → 校验 task 存在 → 写入 → 返回步 id

**可观测行为**: 传真实 `owner_task_id` + `order_no` + `feature_id` → 201 且返回体含 `id` / `owner_task_id` / `feature_id`；`owner_task_id` 不存在 → 400 + `error`(string)；`owner_task_id` 非法 uuid → 400（不可 500）。

**验证命令**:
```bash
# happy：建 task + feature 夹具，POST 建步
TASK_ID=$(psql "$DB_URL" -t -c "INSERT INTO tasks (title) VALUES ('gp-smoke-task') RETURNING id" | tr -d ' ')
FEATURE_ID=$(psql "$DB_URL" -t -c "INSERT INTO journey_features (name) VALUES ('gp-smoke-feature') RETURNING id" | tr -d ' ')
STEP=$(curl -sf -X POST localhost:5221/api/brain/golden_path -H 'Content-Type: application/json' \
  -d "{\"owner_task_id\":\"$TASK_ID\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}")
echo "$STEP" | jq -e '.owner_task_id and .feature_id and (.order_no == 1)' || { echo "FAIL: POST schema"; exit 1; }
STEP_ID=$(echo "$STEP" | jq -r '.id')
# 禁用字段反向：新模型不得回吐旧列
echo "$STEP" | jq -e 'has("scope_type") | not' || { echo "FAIL: 旧列 scope_type 漏网"; exit 1; }
echo "$STEP" | jq -e 'has("ability_id") | not' || { echo "FAIL: 旧列 ability_id 漏网"; exit 1; }
# owner_task_id 不存在 → 400
C1=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/golden_path -H 'Content-Type: application/json' \
  -d "{\"owner_task_id\":\"00000000-0000-0000-0000-000000000000\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}")
[ "$C1" = "400" ] || { echo "FAIL: 悬空 owner_task_id 应 400, got $C1"; exit 1; }
# 非法 uuid → 400（不可 500）
C2=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/golden_path -H 'Content-Type: application/json' \
  -d "{\"owner_task_id\":\"not-a-uuid\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}")
[ "$C2" = "400" ] || { echo "FAIL: 非法 uuid 应 400, got $C2"; exit 1; }
echo OK
```

**硬阈值**: happy=201 且返回含新模型字段、无旧列；悬空/非法 owner_task_id 均=400
**验证命令**: 见上

---

### Step 2: 用户 POST /decisions 把 NFR 挂到该步（golden_path target 存在性校验）
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」具体步骤 2：`POST /api/brain/decisions` 带 `{category:'nfr', topic:'前后台', decision:'后台静默', level:'step', target_type:'golden_path', target_id:<上一步 id>, scope:'v1'}` → 校验该 golden_path 存在 → 写入 → 返回决策 id；PRD「边界情况」前 2 项（target_id 不存在 / 非法 uuid → 400）

**可观测行为**: 传真实步 id → 201 且返回 `level=step` / `target_type=golden_path` / `target_id` 匹配；`target_id` 不存在 → 400 + `error`(string)；`target_id` 非法 uuid → 400（不可 500）。

**验证命令**:
```bash
DEC=$(curl -sf -X POST localhost:5221/api/brain/decisions -H 'Content-Type: application/json' \
  -d "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"step\",\"target_type\":\"golden_path\",\"target_id\":\"$STEP_ID\",\"scope\":\"v1\"}")
echo "$DEC" | jq -e '.level == "step"' || { echo "FAIL: level"; exit 1; }
echo "$DEC" | jq -e '.target_type == "golden_path"' || { echo "FAIL: target_type"; exit 1; }
echo "$DEC" | jq -e --arg s "$STEP_ID" '.target_id == $s' || { echo "FAIL: target_id 不匹配"; exit 1; }
# 悬空 target_id → 400
C3=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H 'Content-Type: application/json' \
  -d '{"category":"nfr","level":"step","target_type":"golden_path","target_id":"00000000-0000-0000-0000-000000000000","scope":"v1"}')
[ "$C3" = "400" ] || { echo "FAIL: 悬空 target_id 应 400, got $C3"; exit 1; }
# 非法 uuid → 400（不可 500）
C4=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H 'Content-Type: application/json' \
  -d '{"category":"nfr","level":"step","target_type":"golden_path","target_id":"not-a-uuid","scope":"v1"}')
[ "$C4" = "400" ] || { echo "FAIL: 非法 uuid target 应 400, got $C4"; exit 1; }
echo OK
```

**硬阈值**: happy=201 且字段匹配；悬空/非法 target_id 均=400（非 500）
**验证命令**: 见上

---

### Step 3: 用户 GET /golden_path/:id/decisions?scope=v1 读回该步决策
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」具体步骤 3：`GET /api/brain/golden_path/<step_id>/decisions?scope=v1` → 拿回该步 v1 决策（含刚写那条）；PRD「边界情况」第 4 项（无匹配返回空清单 200）

**可观测行为**: 含刚写那条决策（`target_id == step_id` 且 `scope == v1`）；不存在的步 id → 返回空数组 `[]`（200，不报错）。

**验证命令**:
```bash
LIST=$(curl -sf "localhost:5221/api/brain/golden_path/$STEP_ID/decisions?scope=v1")
echo "$LIST" | jq -e --arg s "$STEP_ID" 'any(.[]; .target_id == $s and .scope == "v1")' || { echo "FAIL: 读回缺刚写决策"; exit 1; }
# 空清单：不存在的步 → 200 + []
EMPTY=$(curl -sf "localhost:5221/api/brain/golden_path/00000000-0000-0000-0000-000000000000/decisions?scope=v1")
echo "$EMPTY" | jq -e 'type == "array" and length == 0' || { echo "FAIL: 无匹配应返回空数组"; exit 1; }
echo OK
```

**硬阈值**: 命中刚写决策；无匹配返回 `[]`（200）
**验证命令**: 见上

---

### Step 4: 用户 GET /tasks/:id/golden-path-decisions 拉整条 golden path 的 NFR 验收单
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」具体步骤 4：`GET /api/brain/tasks/<task_id>/golden-path-decisions?category=nfr&scope=v1` → 拿回该 task 整条 golden path 的 NFR 验收单（按 owner_task_id join 出整条 golden path 的步骤决策）

**可观测行为**: 按 `owner_task_id` join 出该 task 所有 golden_path 步骤上挂的决策，按 `category=nfr&scope=v1` 过滤 → 含刚写那条（`target_id == step_id`）；不存在的 task id → 返回空数组 `[]`（200）。

**验证命令**:
```bash
SHEET=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID/golden-path-decisions?category=nfr&scope=v1")
echo "$SHEET" | jq -e --arg s "$STEP_ID" 'any(.[]; .target_id == $s and .category == "nfr" and .scope == "v1")' || { echo "FAIL: 验收单缺刚写决策"; exit 1; }
# 空清单：不存在的 task → 200 + []
EMPTY2=$(curl -sf "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000000/golden-path-decisions?category=nfr&scope=v1")
echo "$EMPTY2" | jq -e 'type == "array" and length == 0' || { echo "FAIL: 无匹配 task 应返回空数组"; exit 1; }
echo OK
```

**硬阈值**: 验收单含刚写决策；无匹配 task 返回 `[]`（200）
**验证命令**: 见上

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

> 选模板规则：PRD 末尾 `target_environment: local_api` → curl localhost:5221 + psql 全程链路，evaluator 本地执行。

```bash
#!/bin/bash
set -e
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"

# 0. 应用 migration 303（重塑 golden_path 表）
psql "$DB_URL" < packages/brain/migrations/303_*.sql

# 0a. schema 断言：新列在、旧列移除
NEWCOLS=$(psql "$DB_URL" -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name IN ('owner_task_id','feature_id')" | tr -d ' ')
[ "$NEWCOLS" = "2" ] || { echo "FAIL: 新列缺失 NEWCOLS=$NEWCOLS"; exit 1; }
OLDCOLS=$(psql "$DB_URL" -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name IN ('scope_type','scope_id','ability_id')" | tr -d ' ')
[ "$OLDCOLS" = "0" ] || { echo "FAIL: 旧列残留 OLDCOLS=$OLDCOLS"; exit 1; }

# 1. 夹具：真实 task + feature
TASK_ID=$(psql "$DB_URL" -t -c "INSERT INTO tasks (title) VALUES ('gp-e2e-task') RETURNING id" | tr -d ' ')
FEATURE_ID=$(psql "$DB_URL" -t -c "INSERT INTO journey_features (name) VALUES ('gp-e2e-feature') RETURNING id" | tr -d ' ')

# 2. POST /golden_path 建步（task 存在性校验通过）
STEP=$(curl -sf -X POST localhost:5221/api/brain/golden_path -H 'Content-Type: application/json' \
  -d "{\"owner_task_id\":\"$TASK_ID\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}")
STEP_ID=$(echo "$STEP" | jq -r '.id')
echo "$STEP" | jq -e --arg t "$TASK_ID" '.owner_task_id == $t and (.order_no == 1)' || { echo "FAIL: 建步 schema"; exit 1; }

# 2a. 悬空 owner_task_id → 400
C1=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/golden_path -H 'Content-Type: application/json' \
  -d "{\"owner_task_id\":\"00000000-0000-0000-0000-000000000000\",\"order_no\":2,\"feature_id\":\"$FEATURE_ID\"}")
[ "$C1" = "400" ] || { echo "FAIL: 悬空 owner_task_id 应 400 got $C1"; exit 1; }

# 3. POST /decisions 挂 NFR 到步（golden_path 存在性校验通过）
DEC=$(curl -sf -X POST localhost:5221/api/brain/decisions -H 'Content-Type: application/json' \
  -d "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"step\",\"target_type\":\"golden_path\",\"target_id\":\"$STEP_ID\",\"scope\":\"v1\"}")
echo "$DEC" | jq -e '.level == "step" and .target_type == "golden_path"' || { echo "FAIL: 决策 schema"; exit 1; }

# 3a. 悬空 target_id → 400；非法 uuid → 400（非 500）
C3=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H 'Content-Type: application/json' \
  -d '{"category":"nfr","level":"step","target_type":"golden_path","target_id":"00000000-0000-0000-0000-000000000000","scope":"v1"}')
[ "$C3" = "400" ] || { echo "FAIL: 悬空 target 应 400 got $C3"; exit 1; }
C4=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H 'Content-Type: application/json' \
  -d '{"category":"nfr","level":"step","target_type":"golden_path","target_id":"not-a-uuid","scope":"v1"}')
[ "$C4" = "400" ] || { echo "FAIL: 非法 uuid target 应 400（非 500） got $C4"; exit 1; }

# 4. DB 副作用确认（带时间窗防历史冒充）
DBCNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM decisions WHERE target_type='golden_path' AND target_id='$STEP_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$DBCNT" -ge 1 ] || { echo "FAIL: 决策未落库 DBCNT=$DBCNT"; exit 1; }

# 5. GET 按步读回
LIST=$(curl -sf "localhost:5221/api/brain/golden_path/$STEP_ID/decisions?scope=v1")
echo "$LIST" | jq -e --arg s "$STEP_ID" 'any(.[]; .target_id == $s and .scope == "v1")' || { echo "FAIL: 按步读回缺决策"; exit 1; }

# 6. GET 按 task 整条 golden path 读回 NFR 验收单
SHEET=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID/golden-path-decisions?category=nfr&scope=v1")
echo "$SHEET" | jq -e --arg s "$STEP_ID" 'any(.[]; .target_id == $s and .category == "nfr")' || { echo "FAIL: 验收单缺决策"; exit 1; }

# 7. 空清单边界：不存在 task → 200 + []
EMPTY=$(curl -sf "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000000/golden-path-decisions?category=nfr&scope=v1")
echo "$EMPTY" | jq -e 'type == "array" and length == 0' || { echo "FAIL: 空清单边界"; exit 1; }

echo "✅ Golden Path owner_task_id 模型 + step 级 NFR 决策读写 全链路验证通过"
```

**通过标准**: 脚本 exit 0

---

## GAN 来源标注表

| FROM_PRD 来源步骤 | AI_ADDED 步骤 + 理由 |
|---|---|
| Step 0 重塑表（范围限定第 1 项）| （本轮无 AI_ADDED 步骤；所有 Golden Path 步骤均 1:1 来自 PRD 核心场景 4 步 + migration）|
| Step 1 POST /golden_path（核心场景步 1）| 防造假断言 `has("scope_type")\|not` 等为 AI 加固，理由：确保旧错模型列被彻底移除、generator 不回退旧 schema |
| Step 2 POST /decisions（核心场景步 2 + 边界 1/2）| DB 时间窗 `created_at > NOW()-interval '5 minutes'` 为 AI 加固，理由：防 generator 用历史 decisions 行冒充本轮写入 |
| Step 3 GET 按步读回（核心场景步 3 + 边界 4）| — |
| Step 4 GET 按 task 读回（核心场景步 4 + 边界 4）| — |

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/golden-path-decisions.test.ts` | POST /golden_path 新模型 / task 校验 / POST /decisions golden_path 校验 / 2 读回视图 / 边界 | → N failures（端点未改前断言旧模型/缺读回视图即红）|
