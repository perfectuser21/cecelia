# Sprint Contract Draft (Round 3)

> Harness Cockpit Phase 3 — 决策面板（让决策可见可改可点火）
> journey_type: dev_pipeline ｜ target_environment: mac_web

## 已知约束（来自回归测试）

- [packages/brain/src/routes/abilities.js POST /decisions] → 已存在 ability/golden_path 级决策写入端点，校验 `level ∈ {area,ability,feature,step}`，`target_type=journey_feature/golden_path` 时 `target_id` 必须真实存在；本刀新端点 `/dev/decisions` 是 **pipeline 级** 写入，target_id = harness_initiative pipeline 自身 uuid（非 journey_feature），不复用该强校验。
- [apps/dashboard/.../HarnessPipelineDetailPage.tsx PipelineLifecycleSection（Phase 2，#3400）] → docs tab 已 read-only 渲染「决策清单」分区，客户端按 `d.target != null && String(d.target).includes(pipelineId)` 过滤；本刀把该分区从 read-only 升级为可编辑/可标记/可再来一轮。
- [migration 302_decisions_level_target_scope.sql] → 仅含 `level/target_type/target_id/scope`，**不含** `verify_layer/round/generated_by/default_value`（PRD 假设这些字段已存在 = 错误事实，本刀补 migration 304）。
- [packages/brain/src/routes/task-tasks.js POST /tasks] → 既有 `INSERT INTO tasks (...task_type, status='queued', payload...)`，`harness_initiative` 缺 `payload.journey_id` 会让 initiative_run 游离（B51 warn）；`/dev/submit` 复用同款 INSERT 并要求 journey 标识。

## PRD 假设解析（关键事实纠偏 — Reviewer 重点核对）

| PRD 假设 | 实际事实 | 本刀处置 |
|---|---|---|
| `decisions` 表已含 `level/target/scope/verify_layer/round/generated_by`（#3391 已合） | #3391=migration 302 只加了 `level/target_type/target_id/scope`；`verify_layer/round/generated_by` 及 `默认值` 列**不存在** | 新增 **migration 304** 幂等补列（IF NOT EXISTS）；PRD「如缺字段需先补 migration」分支生效 |
| 决策面板接进 **TaskPrdPage** 扩展 | Phase 2 决策面板实际在 **HarnessPipelineDetailPage.tsx 的 PipelineLifecycleSection（docs tab）**；TaskPrdPage 只是单 task PRD markdown 视图 | 决策面板升级落在 **HarnessPipelineDetailPage.tsx**，不改 TaskPrdPage（否则改错文件，UI 不接 Phase 2） |
| PRD 概念字段名 `target` | 真实列是 `target_type` + `target_id`（UUID）；前端 `DecisionRow.target` 读 `target` | 端点响应把 `target_id AS target` 别名暴露（兼容前端 + honor PRD 措辞），DB 列仍写 `target_id` |

---

## Response Schema（推导来源: PRD 字面 + 既有 schema 列对齐 + `[NEW_PATTERN]` 新增列）

> PRD 无 `## Response Schema` 段，仅 Golden Path 概念字段；api_registry 当前不可达（Brain down），按 PRD 字面 + decisions 既有列 + REST 惯例推导，新增字段标 `[NEW_PATTERN]`。

### Endpoint: POST /api/brain/dev/decisions （写入 — append 或 update 指定行）

请求 body：
```json
{"id": "<uuid|缺省>", "topic": "<string>", "decision": "<string>", "default_value": "<string|null>",
 "level": "<area|ability|feature|step>", "target_id": "<uuid|null>", "target_type": "<string|null>",
 "scope": "<v1|backlog|null>", "verify_layer": "<string|null>", "round": "<int,缺省1>", "generated_by": "<string|null>"}
```
- 语义：body **无 `id`** → INSERT 追加新行（场景 A 写一轮 / 场景 C4 再来一轮 round+1）；body **有 `id`** → UPDATE 该指定行（场景 C3 编辑写回）。**永不覆盖历史 round 行**（append-or-update-specified-row）。

**Success (HTTP 201 append / 200 update)**:
```json
{"id": "<uuid>", "topic": "<string>", "decision": "<string>", "default_value": "<string|null>",
 "level": "<string>", "target": "<uuid|null>", "target_type": "<string|null>", "scope": "<string|null>",
 "verify_layer": "<string|null>", "round": "<int>", "generated_by": "<string|null>", "created_at": "<timestamp>"}
```
- `id` (uuid, 必填): 来源——既有 decisions 主键约定
- `topic` (string): 来源——PRD 场景 A 字面
- `decision` (string): 来源——PRD 场景 A 字面
- `default_value` (string|null): 来源——PRD「默认值」字面，`[NEW_PATTERN]` 新增列
- `level` (string): 来源——既有 migration 302 列，枚举 area/ability/feature/step
- `target` (uuid|null): 来源——PRD「target」字面，响应中 = `target_id` 列别名（DB 列名 target_id）
- `target_type` (string|null): 来源——既有 migration 302 列
- `scope` (string|null): 来源——既有 migration 302 列，枚举 v1/backlog
- `verify_layer` (string|null): 来源——PRD「verify_layer」字面，`[NEW_PATTERN]` 新增列
- `round` (int): 来源——PRD「round」字面，`[NEW_PATTERN]` 新增列，默认 1
- `generated_by` (string|null): 来源——PRD「generated_by」字面，`[NEW_PATTERN]` 新增列

**禁用字段名**（响应/写入严禁出现这些同义替换）: `decision_default`、`default`、`recommend`、`layer`、`verifyLayer`、`gen_by`、`author`、`iteration`、`round_no`、`target_ref`
**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```
- `level` 缺失/非法 → 400 `{error}`

### Endpoint: GET /api/brain/dev/decisions?target=<uuid> （读取 — 面板按 target 拉本 pipeline 决策）

**Success (HTTP 200)**: 数组，每项 schema 同上 success 行（含 `target` 别名）。
- `?target=<uuid>` → 返回 `target_id = <uuid>` 的全部行（含全部 round），按 `round` 升序、`created_at` 升序。
- `?target` 缺省 / 无匹配 → 返回 `[]`（HTTP 200 空数组，**不报错** — PRD 边界「空态不报错」）。

### Endpoint: POST /api/brain/dev/submit （点火 — 建 harness_initiative 任务）

请求 body：
```json
{"target_id": "<uuid，必填>", "journey_id": "<string|null>", "title": "<string|null>"}
```
**Success (HTTP 201)**:
```json
{"id": "<uuid>", "task_type": "harness_initiative", "status": "queued"}
```
- `id` (uuid): 新建任务主键
- `task_type` (string, 字面量 `"harness_initiative"`)
- `status` (string, 字面量 `"queued"`)

**禁用字段名**: `task_id`（应为 `id`）、`type`（应为 `task_type`）、`state`（应为 `status`）
**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```
- 缺 `target_id`（必填点火标识）→ 400，**不建脏任务**（PRD 边界）。

---

## Golden Path

[场景A POST /dev/decisions 落库] → [场景C 面板可见可改可再来一轮] → [场景B POST /dev/submit 点火建 harness_initiative]

### Step 1: 写一轮决策落库（场景 A — Brain 端点 append）
**来源**: `[FROM_PRD]` — PRD「Golden Path 场景 A」第 1-3 步直接定义

**可观测行为**: 调用方 POST 一条决策（topic/decision/default_value + level/target_id/scope/verify_layer/round/generated_by），系统 append 写入 `decisions` 表，DB 该行存在且字段值与请求一致。

**验证命令**:
```bash
TARGET_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
RESP=$(curl -sf -X POST localhost:5221/api/brain/dev/decisions \
  -H 'Content-Type: application/json' \
  -d "{\"topic\":\"用什么框架\",\"decision\":\"vitest\",\"default_value\":\"vitest\",\"level\":\"step\",\"target_id\":\"$TARGET_ID\",\"scope\":\"v1\",\"verify_layer\":\"unit\",\"round\":1,\"generated_by\":\"cockpit-user\"}")
echo "$RESP" | jq -e '.level == "step" and .verify_layer == "unit" and .round == 1 and .generated_by == "cockpit-user" and .target == "'"$TARGET_ID"'"' || { echo FAIL; exit 1; }
# schema 完整性卡：必含字段集存在
echo "$RESP" | jq -e 'has("topic") and has("decision") and has("default_value") and has("scope") and has("target_type") and has("created_at")' || { echo "FAIL: 缺必含字段"; exit 1; }
# 禁用字段名反向断言：同义替换不得出现
echo "$RESP" | jq -e '(.decision_default or .layer or .gen_by or .iteration) | not' || { echo "FAIL: 禁用字段名出现"; exit 1; }
NEWID=$(echo "$RESP" | jq -r '.id')
psql "$DB" -t -c "SELECT count(*) FROM decisions WHERE id='$NEWID' AND target_id='$TARGET_ID' AND verify_layer='unit' AND round=1 AND generated_by='cockpit-user' AND created_at > NOW() - interval '5 minutes'" | grep -q 1 || { echo FAIL; exit 1; }
```

**硬阈值**: HTTP 201；DB 行存在，6 个字段值匹配，5 分钟内写入。
**验证命令（硬阈值 codify）**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/dev/decisions -H 'Content-Type: application/json' -d "{\"topic\":\"t\",\"decision\":\"d\",\"level\":\"step\",\"target_id\":\"$TARGET_ID\"}"); [ "$CODE" = "201" ] || { echo "FAIL code=$CODE"; exit 1; }
```

---

### Step 2: 面板可见本 pipeline 决策（场景 C1 — GET 按 target 过滤）
**来源**: `[FROM_PRD]` — PRD「场景 C」第 1 步「决策面板查 decisions WHERE target=该 pipeline 的 ability/step」

**可观测行为**: GET `?target=<pipelineId>` 只返回该 pipeline 的决策行；target 无匹配返回空数组不报错。

**验证命令**:
```bash
ROWS=$(curl -sf "localhost:5221/api/brain/dev/decisions?target=$TARGET_ID")
echo "$ROWS" | jq -e 'type == "array" and length >= 1 and all(.[]; .target == "'"$TARGET_ID"'")' || { echo FAIL; exit 1; }
# 空态：随机 target 返回 [] 且 HTTP 200，不报错
EMPTY=$(curl -sf "localhost:5221/api/brain/dev/decisions?target=$(python3 -c "import uuid; print(uuid.uuid4())")")
echo "$EMPTY" | jq -e 'type == "array" and length == 0' || { echo "FAIL: 空态非 []"; exit 1; }
```

**硬阈值**: 命中行 `target` 全等于查询值；空态 = `[]` + HTTP 200。

---

### Step 3: 编辑一条决策写回（场景 C3 — update 指定行，不增历史）
**来源**: `[FROM_PRD]` — PRD「场景 C」第 3 步「用户改一条 → 写回 decisions 表，刷新可见新值」+ 边界「只追加或更新指定行」

**可观测行为**: 带 `id` POST 同一行新 decision 值，系统 UPDATE 该行（不新增行），刷新读到新值，行总数不变。

**验证命令**:
```bash
BEFORE=$(psql "$DB" -t -c "SELECT count(*) FROM decisions WHERE target_id='$TARGET_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
curl -sf -X POST localhost:5221/api/brain/dev/decisions -H 'Content-Type: application/json' \
  -d "{\"id\":\"$NEWID\",\"topic\":\"用什么框架\",\"decision\":\"jest\",\"level\":\"step\",\"target_id\":\"$TARGET_ID\"}" \
  | jq -e '.id == "'"$NEWID"'" and .decision == "jest"' || { echo FAIL; exit 1; }
AFTER=$(psql "$DB" -t -c "SELECT count(*) FROM decisions WHERE target_id='$TARGET_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: 编辑新增了行（应 update 不 append）"; exit 1; }
psql "$DB" -t -c "SELECT decision FROM decisions WHERE id='$NEWID'" | grep -q jest || { echo FAIL; exit 1; }
```

**硬阈值**: 行总数前后相等（不 append）；该行 decision = 新值。

---

### Step 4: 再来一轮追加 round+1（场景 C4 — append round+1 stub，历史不覆盖）
**来源**: `[FROM_PRD]` — PRD「场景 C」第 4 步「点再来一轮 → POST 一条 round+1 占位决策 → 面板可见 round 增长」+ 假设「本刀仅 POST 占位 round+1，不 spawn agent」

**可观测行为**: 对同 target append 一条 `round=2` 行，旧 `round=1` 行仍在（历史不覆盖），面板可见两 round。

**验证命令**:
```bash
curl -sf -X POST localhost:5221/api/brain/dev/decisions -H 'Content-Type: application/json' \
  -d "{\"topic\":\"用什么框架\",\"decision\":\"<占位>\",\"level\":\"step\",\"target_id\":\"$TARGET_ID\",\"round\":2,\"generated_by\":\"redteam-stub\"}" \
  | jq -e '.round == 2' || { echo FAIL; exit 1; }
# round 1 历史行仍在，round 2 新增 → 至少 2 个不同 round
psql "$DB" -t -c "SELECT count(DISTINCT round) FROM decisions WHERE target_id='$TARGET_ID' AND created_at > NOW() - interval '5 minutes'" | grep -q 2 || { echo "FAIL: round 历史被覆盖"; exit 1; }
```

**硬阈值**: 存在 round=1 与 round=2 两行（DISTINCT round ≥ 2），历史未被覆盖。

---

### Step 5: 确认后点火建 harness_initiative（场景 B — Brain 端点 submit）
**来源**: `[FROM_PRD]` — PRD「Golden Path 场景 B」第 1-3 步直接定义

**可观测行为**: POST `/dev/submit` 带点火标识，系统复用建任务逻辑创建 `task_type=harness_initiative` 任务；DB 新任务存在。

**验证命令**:
```bash
SUB=$(curl -sf -X POST localhost:5221/api/brain/dev/submit -H 'Content-Type: application/json' \
  -d "{\"target_id\":\"$TARGET_ID\",\"journey_id\":\"line-harness\",\"title\":\"phase3 e2e fire\"}")
echo "$SUB" | jq -e '.task_type == "harness_initiative" and .status == "queued"' || { echo FAIL; exit 1; }
# 禁用字段名反向断言：submit 响应不得用 task_id/type/state
echo "$SUB" | jq -e '(.task_id or .type or .state) | not' || { echo "FAIL: submit 禁用字段名出现"; exit 1; }
SUBID=$(echo "$SUB" | jq -r '.id')
psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE id='$SUBID' AND task_type='harness_initiative' AND created_at > NOW() - interval '5 minutes'" | grep -q 1 || { echo FAIL; exit 1; }
```

**硬阈值**: HTTP 201；tasks 表新 harness_initiative 行存在，5 分钟内创建。

---

### Step 6: submit 缺必填标识拒建脏任务（场景 B 边界）
**来源**: `[AI_ADDED]` — 理由：PRD 边界「submit 缺必填标识 → 返回 4xx，不建脏任务」需 codify 成反向断言，防 generator 用空 body 也建出游离 harness_initiative

**可观测行为**: 缺 `target_id` 的 submit 返回 4xx 且不新增任何 harness_initiative 任务。

**验证命令**:
```bash
N0=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/dev/submit -H 'Content-Type: application/json' -d '{}')
[ "$CODE" = "400" ] || { echo "FAIL: 缺标识未返 400, code=$CODE"; exit 1; }
N1=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$N0" = "$N1" ] || { echo "FAIL: 拒绝路径仍建出脏任务"; exit 1; }
```

**硬阈值**: HTTP 400；harness_initiative 任务计数前后不变。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=mac_web）

**journey_type**: dev_pipeline
**target_environment**: mac_web

> Brain 端点（场景 A/B）用 curl+psql 在同环境验证；决策面板交互（场景 C 编辑 + 再来一轮）用本机 Playwright 打开 localhost:5174 真实浏览器驱动。

### Part 1 — Brain 端点链路（bash，本机打 localhost:5221 + psql）

```bash
#!/bin/bash
set -e
DB="${DB_URL:-postgresql://localhost/cecelia}"

# 前置：migration 304 必须已应用（verify_layer/round/generated_by/default_value 列存在）
# 定点读 4 新列（WHERE id= 定点，列任一缺失则 SQL 报错 → 非零退出 → FAIL；不查历史无时间窗问题）
psql "$DB" -t -c "SELECT verify_layer, round, generated_by, default_value FROM decisions WHERE id='00000000-0000-0000-0000-000000000000' LIMIT 1" >/dev/null 2>&1 \
  || { echo "FAIL: migration 304 未应用，缺新列（4 列任一缺失则查询报错）"; exit 1; }

TARGET_ID=$(python3 -c "import uuid; print(uuid.uuid4())")

# 场景 A：append 写一轮
RESP=$(curl -sf -X POST localhost:5221/api/brain/dev/decisions -H 'Content-Type: application/json' \
  -d "{\"topic\":\"用什么框架\",\"decision\":\"vitest\",\"default_value\":\"vitest\",\"level\":\"step\",\"target_id\":\"$TARGET_ID\",\"scope\":\"v1\",\"verify_layer\":\"unit\",\"round\":1,\"generated_by\":\"cockpit-user\"}")
NEWID=$(echo "$RESP" | jq -r '.id')
echo "$RESP" | jq -e '.target == "'"$TARGET_ID"'" and .round == 1 and .verify_layer == "unit"' || { echo FAIL_A; exit 1; }
psql "$DB" -t -c "SELECT count(*) FROM decisions WHERE id='$NEWID' AND target_id='$TARGET_ID' AND generated_by='cockpit-user' AND created_at > NOW() - interval '5 minutes'" | grep -q 1 || { echo FAIL_A_DB; exit 1; }

# 场景 C3：编辑（update 指定行，不增行）
BEFORE=$(psql "$DB" -t -c "SELECT count(*) FROM decisions WHERE target_id='$TARGET_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
curl -sf -X POST localhost:5221/api/brain/dev/decisions -H 'Content-Type: application/json' \
  -d "{\"id\":\"$NEWID\",\"topic\":\"用什么框架\",\"decision\":\"jest\",\"level\":\"step\",\"target_id\":\"$TARGET_ID\"}" | jq -e '.decision == "jest"' || { echo FAIL_C3; exit 1; }
AFTER=$(psql "$DB" -t -c "SELECT count(*) FROM decisions WHERE target_id='$TARGET_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL_C3: 编辑 append 了行"; exit 1; }

# 场景 C4：再来一轮 round+1（历史不覆盖）
curl -sf -X POST localhost:5221/api/brain/dev/decisions -H 'Content-Type: application/json' \
  -d "{\"topic\":\"用什么框架\",\"decision\":\"<占位>\",\"level\":\"step\",\"target_id\":\"$TARGET_ID\",\"round\":2,\"generated_by\":\"redteam-stub\"}" | jq -e '.round == 2' || { echo FAIL_C4; exit 1; }
psql "$DB" -t -c "SELECT count(DISTINCT round) FROM decisions WHERE target_id='$TARGET_ID' AND created_at > NOW() - interval '5 minutes'" | grep -q 2 || { echo "FAIL_C4: round 历史被覆盖"; exit 1; }

# 场景 C1 空态
EMPTY=$(curl -sf "localhost:5221/api/brain/dev/decisions?target=$(python3 -c "import uuid; print(uuid.uuid4())")")
echo "$EMPTY" | jq -e 'type=="array" and length==0' || { echo FAIL_EMPTY; exit 1; }

# 场景 B：点火建 harness_initiative
SUB=$(curl -sf -X POST localhost:5221/api/brain/dev/submit -H 'Content-Type: application/json' \
  -d "{\"target_id\":\"$TARGET_ID\",\"journey_id\":\"line-harness\",\"title\":\"phase3 e2e fire\"}")
SUBID=$(echo "$SUB" | jq -r '.id')
echo "$SUB" | jq -e '.task_type == "harness_initiative" and .status == "queued"' || { echo FAIL_B; exit 1; }
psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE id='$SUBID' AND task_type='harness_initiative' AND created_at > NOW() - interval '5 minutes'" | grep -q 1 || { echo FAIL_B_DB; exit 1; }

# 场景 B 边界：缺标识拒建脏任务
N0=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/dev/submit -H 'Content-Type: application/json' -d '{}')
[ "$CODE" = "400" ] || { echo "FAIL_B_GUARD code=$CODE"; exit 1; }
N1=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type='harness_initiative' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$N0" = "$N1" ] || { echo "FAIL_B_GUARD: 建出脏任务"; exit 1; }

# R1 风险：target_id 非 UUID 须 400 非 5xx（不被 DB cast 错冒成 500）
RCODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/dev/decisions -H 'Content-Type: application/json' -d '{"topic":"t","decision":"d","level":"step","target_id":"not-a-uuid"}')
[ "$RCODE" = "400" ] || { echo "FAIL_R1: 非UUID target_id 应 400 非 $RCODE"; exit 1; }

echo "✅ Phase 3 Brain 端点链路验证通过 target=$TARGET_ID"
```

### Part 2 — 决策面板 UI（Playwright，本机 localhost:5174 真实浏览器）

```javascript
// final-e2e Playwright 脚本（Mac 本机执行；前置：Part 1 已对某 pipelineId 写入决策）
const { chromium, expect } = require('@playwright/test');

(async () => {
  // PIPELINE_ID = 一个已有决策的 harness_initiative pipeline id（= 决策的 target_id）
  const PIPELINE_ID = process.env.E2E_PIPELINE_ID;
  if (!PIPELINE_ID) { console.error('FAIL: 缺 E2E_PIPELINE_ID'); process.exit(1); }

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  // 1. 打开 Phase 2 pipeline 详情页 → 切到 docs tab → 决策面板
  // 路由 = App.tsx 实际 /pipeline/:id（非 /harness/pipeline）；tab testid = HarnessPipelineDetailPage.tsx:1046 现有 docs-tab（非 tab-docs）
  await page.goto(`http://localhost:5174/pipeline/${PIPELINE_ID}`);
  await page.waitForLoadState('networkidle');
  await page.click('[data-testid="docs-tab"]');
  await page.screenshot({ path: 'screenshots/01-initial.png' });

  // 2. 决策面板列出本 pipeline 决策（每条含 topic/decision/default_value/verify_layer/round）
  const panel = page.locator('[data-testid="decision-panel"]');
  await expect(panel).toBeVisible({ timeout: 10000 });
  const firstRow = page.locator('[data-testid^="decision-row-"]').first();
  await expect(firstRow).toBeVisible();

  // 3. 编辑一条决策 → 写回 → 刷新可见新值
  await firstRow.locator('[data-testid="decision-edit-input"]').fill('playwright-edited-value');
  await firstRow.locator('[data-testid="decision-save-btn"]').click();
  await page.screenshot({ path: 'screenshots/02-action.png' });
  await expect(firstRow.locator('[data-testid="decision-value"]')).toHaveText(/playwright-edited-value/, { timeout: 10000 });

  // 3b. 标记 v1/backlog
  await firstRow.locator('[data-testid="decision-scope-v1"]').click();
  await expect(firstRow.locator('[data-testid="decision-scope-badge"]')).toHaveText(/v1/);

  // 4. 点「再来一轮」→ 面板可见 round+1
  const roundsBefore = await page.locator('[data-testid^="decision-row-"]').count();
  await panel.locator('[data-testid="decision-next-round-btn"]').click();
  await page.waitForTimeout(1000);
  const roundsAfter = await page.locator('[data-testid^="decision-row-"]').count();
  if (roundsAfter <= roundsBefore) { console.error('FAIL: 再来一轮未新增 round 行'); process.exit(1); }
  await page.screenshot({ path: 'screenshots/03-result.png' });

  // 5. 交叉验证后端：编辑值真落库（前端不撒谎）
  const apiResp = await page.request.get(`http://localhost:5221/api/brain/dev/decisions?target=${PIPELINE_ID}`);
  const data = await apiResp.json();
  const edited = data.find((d) => String(d.decision).includes('playwright-edited-value'));
  if (!edited) { console.error('FAIL: 编辑值未落库', data); process.exit(1); }
  const hasRound2 = new Set(data.map((d) => d.round)).size >= 2;
  if (!hasRound2) { console.error('FAIL: 再来一轮 round 未落库'); process.exit(1); }

  await context.close();
  await browser.close();
  console.log('✅ Phase 3 决策面板 UI 验证通过');
})();
```

**通过标准**: Part 1 bash exit 0 且 Part 2 Playwright exit 0（含 3 张截图 + 后端交叉验证）。

---

## Risks

| # | 风险 | Mitigation（已 codify） |
|---|---|---|
| R1 | `target_id` 传非 UUID 字符串时端点可能抛 DB cast 错返 500（应是客户端错 400）| 端点先校验 UUID 格式，非法 → 400 + error；合同加反向断言「非 UUID → 400 非 5xx」（见 contract-dod error path BEHAVIOR）|
| R2 | migration 304 未应用 → `verify_layer/round/generated_by/default_value` 列缺失，所有写入静默失败 | E2E Part 1 起手定点读 4 新列（`SELECT verify_layer,round,generated_by,default_value ... WHERE id=...`），列任一缺失则 SQL 报错非零退出，直接 FAIL，不进后续断言 |
| R3 | 「再来一轮」并发追加同 target 多个 round 行 | 追加语义靠 `INSERT` 新行（不 UPDATE 历史行、不 read-modify-write），天然无竞态；DISTINCT round 断言只验历史不被覆盖 |

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| /dev/decisions + /dev/submit 端点 | `tests/dev-decision-endpoints.test.js` | append/update/target 过滤/空态/submit/缺标识 400 | → 404/未实现 failures |
| 决策面板 UI（编辑/标记/再来一轮） | `tests/decision-panel.test.tsx` | 面板渲染 + 可编辑控件 + 再来一轮按钮 | → 缺 testid failures |

## journey_type: dev_pipeline
## target_environment: mac_web
