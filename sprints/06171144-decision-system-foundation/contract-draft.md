# Sprint Contract Draft (Round 1) — Decision System 地基

> journey_type: dev_pipeline ｜ target_environment: local_api
> 一个 Sprint = 一个 Generator = 一个 PR。本合同覆盖：写决策 API + 读 ability 决策清单 API + pushDecisions 映射 Level/Scope/ability relation + 端到端 smoke。

---

## 已知约束（来自回归测试）

- [notion-push-sync.test.js] runNotionPushSync — 无待同步行时不调 Notion API（dedup：`WHERE notion_synced_at IS NULL`）
- [notion-push-sync.test.js] Notion API 失败时跳过该行（notion_synced_at 保持 NULL，不可吞成已同步）
- [notion-push-sync.test.js] feature 推送 Status 用 **status 类型而非 select**（Notion 属性类型必须与库 schema 对齐，发错类型 → 400）→ 新增 Level/Scope 属性时同样必须匹配 AI Notes 库实际属性类型，不能想当然写 select
- [notion-push-sync.test.js] feature kind=ability 映射为 Ability（已有 select 映射先例）
- [migration 289] pushDecisions 创建 Notion 页后必须回写 `notion_id`（VARCHAR UNIQUE），否则记录永不标 synced → 5 分钟定时任务无限重复推送
- [decisions-api-chain.test.js / strategic-decisions.js] decisions 表已有 category/topic/decision/reason/status/notion_synced_at/notion_id 列；本 sprint 依赖 migration 302（线上已应用）新增的 `level/target_type/target_id/scope` 列，**本 sprint 不碰 migration**

---

## Response Schema（推导来源: api_registry 为空 → 按 abilities.js 同族端点惯例 + PRD 字面）

> 推导依据：registry API 当前为空。新端点 `POST /api/brain/decisions` 与 `GET /api/brain/abilities/:id/decisions` 在资源族上与 `packages/brain/src/routes/abilities.js` 同族（abilities 资源），该族 POST 返回**裸行** `res.status(201).json(rows[0])`、GET 返回**裸数组** `res.json(rows)`。故新端点沿用裸行/裸数组惯例（**不**用 strategic-decisions.js 的 `{success,data}` 包裹）。错误体沿用 abilities.js 的 `{error:<string>}`，与 PRD 边界「400 + error(string)」字面一致。

### Endpoint: POST /api/brain/decisions
**Success (HTTP 201)** — 返回创建出的决策裸行：
```json
{"id":"<uuid>","level":"ability","target_type":"journey_feature","target_id":"<uuid>","scope":"v1","category":"nfr","topic":"前后台","decision":"后台静默"}
```
- `id` (string, 必填): 新决策主键 — 来源 PRD「返回该决策 id（201）」
- `level` (string, 必填): 回显写入值 ∈ `area|ability|feature|step` — 来源 PRD Golden Path step 1
- `target_type` (string, 必填): 回显写入值（ability/feature 级 = `journey_feature`）— 来源 PRD
- `target_id` (string, 必填): 回显写入值（指向 journey_features.id）— 来源 PRD
- `scope` (string, 必填): 回显写入值 ∈ `v1|backlog` — 来源 PRD
- `category` / `topic` / `decision`: 回显（裸行附带，不做强约束）

**禁用字段名**（不得作为成功响应 key 出现）: `success`、`data`（strategic-decisions 包裹风格，本族不用）；`ability_id`（列名是 `target_id`，不可漂成 `ability_id`）

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

### Endpoint: GET /api/brain/abilities/:id/decisions?scope=v1
**Success (HTTP 200)** — 该 ability 的决策清单（裸数组，可空）：
```json
[{"id":"<uuid>","level":"ability","target_type":"journey_feature","target_id":"<id>","scope":"v1","topic":"前后台","decision":"后台静默"}]
```
- 数组每行为 decisions 裸行；空清单返回 `[]`（HTTP 200，**非** 404/错误）— 来源 PRD 边界「无决策返回空清单（非报错）」
- `?scope=v1` 过滤：只返回 `scope='v1'` 的行；无 scope 参数返回该 ability 全部决策

---

## Golden Path

[给某 ability 记一条 NFR 决策] → [POST 落库 returns id(201)] → [tick 触发 pushDecisions 同步进 Notion AI Notes(Type=Decision, Level/Scope, 链 ability)] → [GET abilities/:id/decisions?scope=v1 拿回验收清单]

### Step 1: 写 ability 级决策落库
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 1（`POST /api/brain/decisions` 带 level/target_type/target_id/scope → 写 decisions 表 → 返回 id，201）

**可观测行为**: 对真实 ability（journey_features WHERE kind='ability'）POST 一条 NFR 决策，HTTP 201，响应体含 `id`（string），decisions 表新增一行且 level/target_type/target_id/scope 与请求一致。

**验证命令**:
```bash
# 取真实 ability id
ABILITY_ID=$(psql "$DB" -t -c "SELECT id FROM journey_features WHERE kind='ability' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
# POST 决策
RESP=$(curl -sf -X POST localhost:5221/api/brain/decisions \
  -H "Content-Type: application/json" \
  -d "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"$ABILITY_ID\",\"scope\":\"v1\"}")
echo "$RESP" | jq -e '.id | type == "string"'        # id 存在
echo "$RESP" | jq -e '.level == "ability"'
echo "$RESP" | jq -e '.target_id == "'"$ABILITY_ID"'"'
echo "$RESP" | jq -e '.scope == "v1"'
```
**硬阈值**: HTTP 201；`id` 为非空 string；level/target_id/scope 回显正确
**验证命令（硬阈值 codify）**:
```bash
DEC_ID=$(echo "$RESP" | jq -r '.id'); [ -n "$DEC_ID" ] && [ "$DEC_ID" != "null" ] || { echo "FAIL: 无 id"; exit 1; }
ROW=$(psql "$DB" -t -c "SELECT level||'|'||target_type||'|'||target_id||'|'||scope FROM decisions WHERE id='$DEC_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$ROW" = "ability|journey_feature|$ABILITY_ID|v1" ] || { echo "FAIL: DB 行不符 $ROW"; exit 1; }
```

---

### Step 2: tick 同步进 Notion AI Notes（Level/Scope + ability relation）
**来源**: `[FROM_PRD]` — Golden Path 步骤 2（Brain tick 同步 → Notion AI Notes 库 Type=Decision，带 Level=ability / Scope=v1，并链到那个 ability）

**可观测行为**: `pushDecisions` 把决策的 `level` 映射进 Notion `Level` 属性、`scope` 映射进 `Scope` 属性、并通过 ability 的 `journey_features.notion_id` 建立 relation 链；同步成功后 decisions 行的 `notion_synced_at` 被置位、`notion_id` 回写。映射逻辑由**导出的纯函数** `buildDecisionNotionProperties(decision, abilityNotionId)` 承载，可独立确定性验证（不依赖 Notion 网络）。

**验证命令**（确定性 — 不打 Notion 网络）:
```bash
# 纯映射函数：Level/Scope/relation 三项必须正确（generator 未实现则 import 失败 → FAIL）
node -e '
import("./packages/brain/src/notion-push-sync.js").then(m => {
  const p = m.buildDecisionNotionProperties(
    { level:"ability", scope:"v1", topic:"前后台", decision:"后台静默" },
    "notion-ability-page-id-xyz"
  );
  const levelName = p.Level?.select?.name || p.Level?.status?.name;
  const scopeName = p.Scope?.select?.name || p.Scope?.status?.name;
  if (levelName !== "ability") { console.error("FAIL: Level 映射错", JSON.stringify(p.Level)); process.exit(1); }
  if (scopeName !== "v1")      { console.error("FAIL: Scope 映射错", JSON.stringify(p.Scope)); process.exit(1); }
  const hasRel = Object.values(p).some(v => Array.isArray(v?.relation) && v.relation.some(r => r.id === "notion-ability-page-id-xyz"));
  if (!hasRel) { console.error("FAIL: 缺 ability relation"); process.exit(1); }
  console.log("OK");
}).catch(e => { console.error("FAIL:", e.message); process.exit(1); });
'
```
**硬阈值**: Level.name=ability、Scope.name=v1、relation 含 abilityNotionId
**验证命令（dedup 源码断言）**:
```bash
# pushDecisions 保留 notion_synced_at IS NULL 过滤（已同步不重推）
node -e 'const c=require("fs").readFileSync("packages/brain/src/notion-push-sync.js","utf8"); const seg=c.slice(c.indexOf("function pushDecisions")); if(!/FROM decisions[\s\S]*?notion_synced_at IS NULL/.test(seg)){console.error("FAIL: pushDecisions 缺 notion_synced_at IS NULL 去重");process.exit(1)} console.log("OK")'
```

---

### Step 3: 读回某 ability 的 v1 决策清单
**来源**: `[FROM_PRD]` — Golden Path 步骤 3（`GET /api/brain/abilities/<id>/decisions?scope=v1` → 拿回该 ability 的 v1 决策清单）

**可观测行为**: GET 该 ability + scope=v1，返回 HTTP 200 + JSON 数组，含 Step 1 写入的决策。

**验证命令**:
```bash
LIST=$(curl -sf "localhost:5221/api/brain/abilities/$ABILITY_ID/decisions?scope=v1")
echo "$LIST" | jq -e 'type == "array"'
echo "$LIST" | jq -e --arg id "$DEC_ID" 'any(.[]; .id == $id)'    # 含刚写入的决策
echo "$LIST" | jq -e 'all(.[]; .scope == "v1")'                    # scope 过滤生效
```
**硬阈值**: HTTP 200；返回 array；含 `$DEC_ID`；全部行 scope=v1

---

### Step 4: 边界 — 非法 target_id / 非法 level → 400 + error(string)
**来源**: `[FROM_PRD]` — PRD 边界情况（非法 target_id 400、非法 level 400）

**可观测行为**: target_id 不是合法 journey_features id → 400；level 非法 → 400；两者响应体均含 `error`（string）。

**验证命令**:
```bash
# 非法 level
C1=$(curl -s -o /tmp/e1.json -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" \
  -d "{\"topic\":\"x\",\"decision\":\"y\",\"level\":\"galaxy\",\"target_type\":\"journey_feature\",\"target_id\":\"$ABILITY_ID\",\"scope\":\"v1\"}")
[ "$C1" = "400" ] && jq -e '.error | type == "string"' /tmp/e1.json || { echo "FAIL: 非法 level 未 400+error"; exit 1; }
# 非法 target_id（不存在的 uuid）
C2=$(curl -s -o /tmp/e2.json -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" \
  -d "{\"topic\":\"x\",\"decision\":\"y\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"00000000-0000-0000-0000-000000000000\",\"scope\":\"v1\"}")
[ "$C2" = "400" ] && jq -e '.error | type == "string"' /tmp/e2.json || { echo "FAIL: 非法 target_id 未 400+error"; exit 1; }
```
**硬阈值**: 两条均 HTTP 400 且 `.error` 为 string

---

### Step 5: 边界 — 空清单（非报错）
**来源**: `[FROM_PRD]` — PRD 边界「该 ability 无决策 → 返回空清单（非报错）」

**可观测行为**: 对一个没有任何决策的合法 ability GET，返回 HTTP 200 + `[]`。

**验证命令**:
```bash
# 新建一个干净 ability（无决策），GET 应返回空数组
EMPTY_AB=$(psql "$DB" -t -c "INSERT INTO journey_features (name, kind, status) VALUES ('e2e-empty-ability', 'ability', 'planned') RETURNING id" | tr -d ' ')
EMPTY_LIST=$(curl -sf "localhost:5221/api/brain/abilities/$EMPTY_AB/decisions?scope=v1")
echo "$EMPTY_LIST" | jq -e 'type == "array" and length == 0' || { echo "FAIL: 空 ability 未返回空数组"; exit 1; }
```
**硬阈值**: HTTP 200；返回 `[]`（length 0）

---

## AI_ADDED 防造假/健壮性增项

- `[AI_ADDED]` — Step 1/Step 5 的 psql 计数/读取带 `created_at > NOW() - interval '5 minutes'` 时间窗。理由：防止 generator 利用历史 decisions 行冒充本轮写入通过。
- `[AI_ADDED]` — 所有新端点 BEHAVIOR 要求 HTTP 201/200/400 明确码，**禁止 404-acceptable 旁路**。理由：Brain 通用 404 handler 返回 `{"error":"Not Found"}`，若 BEHAVIOR 接受 404，generator 不挂载路由也能假绿；故路由必须真实 MOUNTED 在 routes.js 才能通过。
- `[AI_ADDED]` — Notion 映射用导出的纯函数 `buildDecisionNotionProperties` 做确定性 oracle（不打 Notion 网络）。理由：Notion 同步依赖外部 token/网络，直接打 Notion 会 flaky 且产生真实页面污染；纯函数验证 Level/Scope/relation 映射逻辑是确定的、generator 未实现即 FAIL。
- `[AI_ADDED]` — Level/Scope Notion 属性类型用 `.select.name || .status.name` 双读断言。理由：回归测试已暴露「Feature 库 Status 必须用 status 类型，发 select 会 400」，AI Notes 库 Level/Scope 实际类型未知，断言对类型容错只锁 value，避免误判。

---

## E2E 验收（final-e2e 由 evaluator 按 target_environment=local_api 跑 — curl + psql + 可选 Notion API）

```bash
#!/bin/bash
set -e
DB="${DB:-postgresql://localhost/cecelia}"
BASE="localhost:5221/api/brain"

echo "▶ Step 1: 取真实 ability + POST 决策"
ABILITY_ID=$(psql "$DB" -t -c "SELECT id FROM journey_features WHERE kind='ability' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$ABILITY_ID" ] || { echo "FAIL: 无 kind=ability 的 journey_features"; exit 1; }
RESP=$(curl -sf -X POST "$BASE/decisions" -H "Content-Type: application/json" \
  -d "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"$ABILITY_ID\",\"scope\":\"v1\"}")
DEC_ID=$(echo "$RESP" | jq -r '.id')
[ -n "$DEC_ID" ] && [ "$DEC_ID" != "null" ] || { echo "FAIL: POST 无 id"; exit 1; }
echo "$RESP" | jq -e '.level=="ability" and .scope=="v1"' >/dev/null || { echo "FAIL: 回显字段错"; exit 1; }

echo "▶ Step 1b: psql 验落库（时间窗防造假）"
ROW=$(psql "$DB" -t -c "SELECT level||'|'||target_type||'|'||target_id||'|'||scope FROM decisions WHERE id='$DEC_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$ROW" = "ability|journey_feature|$ABILITY_ID|v1" ] || { echo "FAIL: 落库不符 $ROW"; exit 1; }

echo "▶ Step 2: 触发 Notion 同步（直接调 runNotionPushSync）"
SYNC_OUT=$(node -e '
import("./packages/brain/src/db.js").then(async ({default:pool}) => {
  const { runNotionPushSync } = await import("./packages/brain/src/notion-push-sync.js");
  await runNotionPushSync(pool);
  console.log("SYNC_DONE");
  process.exit(0);
}).catch(e => { console.error("SYNC_ERR:", e.message); process.exit(1); });
' 2>&1) || { echo "FAIL: 同步调用异常 $SYNC_OUT"; exit 1; }

echo "▶ Step 2b: 映射纯函数确定性验证（不依赖 Notion 网络）"
node -e '
import("./packages/brain/src/notion-push-sync.js").then(m => {
  const p = m.buildDecisionNotionProperties({level:"ability",scope:"v1",topic:"t",decision:"d"}, "ab-notion-id");
  const lv = p.Level?.select?.name || p.Level?.status?.name;
  const sc = p.Scope?.select?.name || p.Scope?.status?.name;
  if (lv!=="ability"||sc!=="v1") { console.error("FAIL: Level/Scope 映射错"); process.exit(1); }
  if (!Object.values(p).some(v=>Array.isArray(v?.relation)&&v.relation.some(r=>r.id==="ab-notion-id"))) { console.error("FAIL: 缺 relation"); process.exit(1); }
  console.log("MAP_OK");
}).catch(e=>{console.error("FAIL:",e.message);process.exit(1)});
'

echo "▶ Step 2c: 若 NOTION_API_KEY 可用，真打 Notion API 查 page properties（同步成功则 notion_id 已回写）"
SYNCED_NOTION_ID=$(psql "$DB" -t -c "SELECT notion_id FROM decisions WHERE id='$DEC_ID'" | tr -d ' ')
if [ -n "$NOTION_API_KEY" ] && [ -n "$SYNCED_NOTION_ID" ] && [ "$SYNCED_NOTION_ID" != "null" ]; then
  PAGE=$(curl -sf -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2022-06-28" \
    "https://api.notion.com/v1/pages/$SYNCED_NOTION_ID")
  echo "$PAGE" | jq -e '.properties.Level' >/dev/null || { echo "FAIL: Notion 页缺 Level 属性"; exit 1; }
  echo "$PAGE" | jq -e '.properties.Scope' >/dev/null || { echo "FAIL: Notion 页缺 Scope 属性"; exit 1; }
  echo "  ✓ Notion 页 Level/Scope 属性确认"
else
  echo "  · 无 NOTION_API_KEY 或本轮未回写 notion_id（同步因网络/token 跳过）— 映射逻辑已由 Step 2b 确定性覆盖"
fi

echo "▶ Step 3: GET 验收清单"
LIST=$(curl -sf "$BASE/abilities/$ABILITY_ID/decisions?scope=v1")
echo "$LIST" | jq -e 'type=="array"' >/dev/null || { echo "FAIL: 非数组"; exit 1; }
echo "$LIST" | jq -e --arg id "$DEC_ID" 'any(.[]; .id==$id)' >/dev/null || { echo "FAIL: 清单缺刚写入决策"; exit 1; }
echo "$LIST" | jq -e 'all(.[]; .scope=="v1")' >/dev/null || { echo "FAIL: scope 过滤未生效"; exit 1; }

echo "▶ Step 4: 边界 400"
C1=$(curl -s -o /tmp/e1.json -w "%{http_code}" -X POST "$BASE/decisions" -H "Content-Type: application/json" \
  -d "{\"topic\":\"x\",\"decision\":\"y\",\"level\":\"galaxy\",\"target_type\":\"journey_feature\",\"target_id\":\"$ABILITY_ID\",\"scope\":\"v1\"}")
[ "$C1" = "400" ] && jq -e '.error|type=="string"' /tmp/e1.json >/dev/null || { echo "FAIL: 非法 level 未 400"; exit 1; }
C2=$(curl -s -o /tmp/e2.json -w "%{http_code}" -X POST "$BASE/decisions" -H "Content-Type: application/json" \
  -d "{\"topic\":\"x\",\"decision\":\"y\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"00000000-0000-0000-0000-000000000000\",\"scope\":\"v1\"}")
[ "$C2" = "400" ] && jq -e '.error|type=="string"' /tmp/e2.json >/dev/null || { echo "FAIL: 非法 target_id 未 400"; exit 1; }

echo "▶ Step 5: 空清单"
EMPTY_AB=$(psql "$DB" -t -c "INSERT INTO journey_features (name, kind, status) VALUES ('e2e-empty-ability', 'ability', 'planned') RETURNING id" | tr -d ' ')
curl -sf "$BASE/abilities/$EMPTY_AB/decisions?scope=v1" | jq -e 'type=="array" and length==0' >/dev/null || { echo "FAIL: 空 ability 未返回 []"; exit 1; }

echo "✅ Decision System Golden Path 端到端验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| POST/GET decisions 路由 + 映射 | `sprints/06171144-decision-system-foundation/tests/decision-system.test.ts` | 写决策落库、读 ability 清单、非法 level/target_id 400、空清单、buildDecisionNotionProperties 映射 Level/Scope/relation、dedup | → import buildDecisionNotionProperties 失败 + 路由未挂载 → N failures |
