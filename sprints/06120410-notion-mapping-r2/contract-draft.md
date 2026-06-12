# Sprint Contract Draft (Round 6)

## Response Schema（推导来源: 前次 APPROVED 合同 c0e2546b-r5 + Notion DB 实查 2026-06-11 + PRD 字面）

### Endpoint: POST /api/brain/notes
**Success (HTTP 201)**:
```json
{"id": "<string>", "url": "<string>", "title": "<string>", "warnings": ["<string>"]}
```
- `id` (string, 必填): Notion 页面 ID
- `url` (string, 必填): Notion 页面 URL（`https://notion.so/...` 格式）
- `title` (string, 必填): 写入的标题原文
- `warnings` (array of string, 必填): 被剔除的未知属性名说明列表，正常路径为 `[]`

**禁用字段名（旧属性名，不得出现在 Notion payload 中）**: `Initiative ID`（AI Notes DB 2026-06-10 重构后已删）

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

**Error (HTTP 502)**:
```json
{"error": "<string>"}
```

---

### Endpoint: POST /api/brain/notion/task
**Success (HTTP 201)**:
```json
{"id": "<string>", "url": "<string>", "title": "<string>", "warnings": ["<string>"]}
```
- `id` (string, 必填): Notion 页面 ID
- `url` (string, 必填): Notion 页面 URL
- `title` (string, 必填): 实际写入标题（含 WS 前缀）
- `warnings` (array of string, 必填): 未知属性剔除说明，正常路径为 `[]`

**禁用字段名（旧属性名）**: `Title`（Tasks DB 2026-06-10 重构后改为 `Name`，`Title` 不再是有效属性名）

**Error (HTTP 400/502)**: `{"error": "<string>"}`

---

### notion-push-sync（无 HTTP 响应）
`N/A — runNotionPushSync 是定时任务（setInterval 5min），无 HTTP 响应。验证方式：源码函数体静态断言（node 提取 pushJourneyStepLinks 函数体，断言不含 Order: 属性）+ 新增 mock 单测验证 Notion API call properties。`

---

## 已知约束（来自回归测试）

- [notes.test.js:51] `POST /api/brain/notes` 成功响应 keys 为 `['id', 'title', 'url']`（**本次变更**：需更新为含 `warnings` 的 4 字段）
- [notes.test.js:65] `POST /api/brain/notes` 带 `initiative_id` 时 Notion payload 含 `'Initiative ID'` 属性（**本次变更**：需反转为 not.toHaveProperty，旧属性已删）
- [notes.test.js:137] `POST /api/brain/notion/task` 成功响应 keys 为 `['id', 'title', 'url']`（**本次变更**：需更新含 `warnings`）
- [notes.test.js] `POST /api/brain/notes` 缺 title 返 400
- [notes.test.js] `POST /api/brain/notes` 缺 content 返 400
- [notes.test.js] Notion API 失败返 502
- [notes.test.js] `POST /api/brain/notion/task` 缺 title 返 400
- [notes-notion-task.test.js] `POST /notion/task` 带 status 时 Notion properties 中不含 `Status` 字段（Bug 2 回归守护）
- [notion-push-sync-db-ids.test.js] AI Notes DB 仅支持 `Title`/`Type`/`Date` 三个属性（无 Initiative ID）
- [notion-push-sync.test.js] 无待同步行时不调 Notion API

---

## Notion DB Schema（实查结果 — 2026-06-11）

| DB 名称 | DB ID | 真实属性名 |
|---|---|---|
| AI Notes | `185c40c2-ba63-828c-973f-81a9c4582cd6` | `Title(title)`, `Type(select)`, `Date(date)` — **无 `Initiative ID`** |
| Tasks | `d5bc40c2-ba63-82ef-965a-8153b7ad81a0` | **`Name(title)`**（非 `Title`）, `Status(status)`, `Project(relation)` 等 |
| Step Links | `369c40c2-ba63-81e2-b95a-e5e3d0592676` | `Name(title)`, `Status(select)`, `Journey(relation)`, `Step(relation)`, `Phase(select)`, `Notes(rich_text)` — **`Order` 已移除** |

> Step Links DB：Order 属性已并入 Golden Path，不再存入该 DB。pushJourneyStepLinks 写入时必须剔除 `Order:` 字段。

---

## Risks

| # | 风险描述 | Mitigation（写入合同验证） |
|---|---|---|
| R1 | **Notion API 网络超时**：Brain 调 Notion API 超时时，若未捕获则级联返回 Brain 500，调用方重试并产生脏页面 | Generator 必须在 Notion 调用处加 try-catch，统一 catch → HTTP 502 + `{"error": "Notion API timeout/error"}` 响应；合同 BEHAVIOR 第 6 条验证 Notion API 失败 → 502 |
| R2 | **映射配置漏字段 fallback**：三处路由若直接硬编码属性名，下次 Notion schema 变更需改三处，容易漏改导致 400 重现 | Generator 必须将属性名清单集中到 `notion-property-map.js` 的 `NOTION_PROPERTY_MAP` 常量，所有路由统一调 `stripUnknownProperties`；未知属性剔除+warn 而非报错；合同 ARTIFACT Step 5 + BEHAVIOR 第 5 条验证模块存在且语义正确 |
| R3 | **grep 误匹配注释**：若源码注释含 `Order:` / `Title:` 等旧属性字符串，简单 grep 产生假负（false negative），误判修复未完成 | 合同 Step 3 改用 node 函数体精确提取 + 正则 `/\bOrder\s*:\s*\{/`，注释中的字面字符串不触发 FAIL |

---

## Golden Path

```
[Brain API 推送调用 / tick 触发]
  → [notion-property-map.js 映射常量翻译属性名，剔除未知属性，收集 warnings]
  → [Notion API 用正确属性名创建页面，返回 page.url]
  → [路由返回 {id, url, title, warnings}，无 400]
```

---

### Step 1: POST /api/brain/notes（带 initiative_id）→ 201 + warnings

**来源**: `[FROM_PRD]` — PRD Step 2："POST /api/brain/notes（带 initiative_id）→ 200；若该 DB 确无对应关系属性则自动剔除该字段，响应含 warnings 数组说明跳过项"

**可观测行为**: 返回 HTTP 201，body 含 `url`（Notion 页面链接）、`id`、`title`、`warnings`（array）；Brain DB `notes` 表 5 分钟内有对应记录且 `initiative_id` 非 null

**验证命令**:
```bash
RESP=$(curl -sf -X POST localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] notes 属性映射验收","content":"E2E 验收内容","type":"Note","initiative_id":"cf4f596c-fa2b-48f2-ba7b-9969557c85a4"}') \
  || { echo "FAIL: POST /api/brain/notes 非 2xx"; exit 1; }
echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: id 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.url | type == "string"' || { echo "FAIL: url 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.title | type == "string"' || { echo "FAIL: title 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.warnings | type == "array"' || { echo "FAIL: warnings 字段缺失或不是 array"; exit 1; }
echo "$RESP" | jq -e '.warnings | length >= 1' || { echo "FAIL: warnings 应非空（AI Notes DB 无 Initiative ID 属性，剔除后必须留痕）"; exit 1; }
DB="${DB:-postgresql://localhost/cecelia}"
COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM notes WHERE initiative_id='cf4f596c-fa2b-48f2-ba7b-9969557c85a4' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: Brain DB notes.initiative_id 记录缺失"; exit 1; }
# GET 页面存在性验证（PRD Step 2 明确要求 "GET 该 url 200"）
NOTES_PAGE_ID=$(echo "$RESP" | jq -r '.id')
NOTION_TOKEN="${NOTION_API_KEY}"
GET_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://api.notion.com/v1/pages/$NOTES_PAGE_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28")
[ "$GET_CODE" = "200" ] || { echo "FAIL: Notion 页面 GET 返回 $GET_CODE（期望 200，页面应真实存在）"; exit 1; }
echo "STEP 1 OK"
```

**硬阈值**: HTTP 201；`warnings` 类型为 array；`warnings.length ≥ 1`（Initiative ID 剔除后留痕）；Brain DB `notes` 5 分钟内记录 count ≥ 1；Notion API GET 页面 ID 返回 200

---

### Step 2: POST /api/brain/notion/task（Title → Name 修复）→ 201 + warnings

**来源**: `[FROM_PRD]` — PRD Step 3："POST /api/brain/notion/task → 200：Title 字段按新属性名写入"

**可观测行为**: 返回 HTTP 201，body 含 `url`、`id`、`title`（含 `[WS1]` 前缀）、`warnings`（array）；Tasks DB 的 `Name` 属性包含传入 title

**验证命令**:
```bash
RESP=$(curl -sf -X POST localhost:5221/api/brain/notion/task \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] 任务属性修复","ws_number":1}') \
  || { echo "FAIL: POST /api/brain/notion/task 非 2xx"; exit 1; }
echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: id 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.url | type == "string"' || { echo "FAIL: url 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.title | startswith("[WS1]")' || { echo "FAIL: title 缺 [WS1] 前缀"; exit 1; }
echo "$RESP" | jq -e '.warnings | type == "array"' || { echo "FAIL: warnings 字段缺失"; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["id","title","url","warnings"]' || { echo "FAIL: notion/task schema keys 不符，实际=$(echo "$RESP" | jq -c keys)，期望 [id,title,url,warnings]"; exit 1; }
# GET 页面存在性验证（PRD Step 3 明确要求 "GET 该 url 200"）
TASK_PAGE_ID=$(echo "$RESP" | jq -r '.id')
NOTION_TOKEN="${NOTION_TOKEN:-${NOTION_API_KEY}}"
GET_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://api.notion.com/v1/pages/$TASK_PAGE_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28")
[ "$GET_CODE" = "200" ] || { echo "FAIL: notion/task 页面 GET 返回 $GET_CODE（期望 200）"; exit 1; }
echo "STEP 2 OK"
```

**硬阈值**: HTTP 201；`url` 为 string；`title` 含 `[WS1]` 前缀；`warnings` 类型为 array；顶层 keys 完全等于 `["id","title","url","warnings"]`；Notion API GET 页面 ID 返回 200

---

### Step 3: notion-push-sync step_link 推送不含旧属性 Order → 函数体精确静态断言

**来源**: `[FROM_PRD]` — PRD Step 4："触发 notion-push-sync：step_link 推送不再出现 'is not a property' 错误"

**可观测行为**: `notion-push-sync.js` 中 `pushJourneyStepLinks` 函数体不含 `Order:` 属性定义，且保留 `Name`（title）属性；源码三处旧属性名全部移除

**设计说明（为什么用静态断言而非 notion_sync_log 运行时检查）**:
> `runNotionPushSync` 通过 `setInterval(5min)` 在 Brain server.js 中调度，E2E 期间无法直接触发。PRD 允许"手动入口 or tick 日志"两种验证方式。本 sprint 不新增 trigger endpoint（超出 PRD 范围），改用 PRD 允许的"tick 日志"等价物：对函数体做精确静态分析。该分析等价于确认代码不含 `Order:` → Notion 不会收到该字段 → 不再报 "is not a property"。这是真 oracle（代码未修改时会 FAIL），而 `notion_sync_log count = 0` 是弱断言（sync 未运行时无论代码是否修复都返回 0）。

**验证命令**:
```bash
# 1. 源码级：三处旧属性名全移除（精确函数体提取，避免注释误匹配）

# 1a. pushJourneyStepLinks 函数体不含 Order:
node -e "
const src = require('fs').readFileSync('packages/brain/src/notion-push-sync.js', 'utf8');
const fnStart = src.indexOf('async function pushJourneyStepLinks');
if (fnStart < 0) { console.error('FAIL: pushJourneyStepLinks 函数未找到'); process.exit(1); }
const fnEnd = src.indexOf('\nasync function ', fnStart + 1);
const fnBody = src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
if (/\\bOrder\\s*:\\s*\\{/.test(fnBody)) {
  console.error('FAIL: pushJourneyStepLinks 仍含 Order: 属性（Step Links DB 已移除此字段）');
  process.exit(1);
}
if (!fnBody.includes('Name')) {
  console.error('FAIL: pushJourneyStepLinks 缺 Name 属性（title 必须保留）');
  process.exit(1);
}
console.log('OK: pushJourneyStepLinks Order 已移除，Name 保留');
" || { echo "FAIL: pushJourneyStepLinks 函数体断言失败"; exit 1; }

# 1b. notes.js POST /notes handler 不含 'Initiative ID' 属性
node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/notes.js', 'utf8');
const routeStart = src.indexOf(\"router.post('/notes'\");
if (routeStart < 0) { console.error('FAIL: /notes 路由未找到'); process.exit(1); }
const routeEnd = src.indexOf('\nrouter.', routeStart + 1);
const routeBody = src.slice(routeStart, routeEnd > 0 ? routeEnd : undefined);
if (routeBody.includes(\"'Initiative ID'\")) {
  console.error('FAIL: /notes 路由仍含旧属性 Initiative ID');
  process.exit(1);
}
console.log('OK: /notes 路由 Initiative ID 已移除');
" || { echo "FAIL: /notes 路由断言失败"; exit 1; }

# 1c. notes.js POST /notion/task handler 用 Name 而非 Title
node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/notes.js', 'utf8');
const routeStart = src.indexOf(\"router.post('/notion/task'\");
if (routeStart < 0) { console.error('FAIL: /notion/task 路由未找到'); process.exit(1); }
const routeEnd = src.indexOf('\nrouter.', routeStart + 1);
const routeEnd2 = src.indexOf('\nexport ', routeStart + 1);
const endIdx = routeEnd > 0 ? routeEnd : (routeEnd2 > 0 ? routeEnd2 : undefined);
const routeBody = src.slice(routeStart, endIdx);
if (/\\bTitle\\s*:\\s*\\{/.test(routeBody)) {
  console.error('FAIL: /notion/task 路由仍含旧属性 Title:（应改为 Name:）');
  process.exit(1);
}
if (!/\\bName\\s*:\\s*\\{/.test(routeBody)) {
  console.error('FAIL: /notion/task 路由缺新属性 Name:');
  process.exit(1);
}
console.log('OK: /notion/task 路由 Title 已改为 Name');
" || { echo "FAIL: /notion/task 路由断言失败"; exit 1; }

echo "STEP 3 OK"
```

**硬阈值**:
- `pushJourneyStepLinks` 函数体：`/\bOrder\s*:\s*\{/.test(fnBody)` = false
- `pushJourneyStepLinks` 函数体：`fnBody.includes('Name')` = true
- `/notes` 路由体：`'Initiative ID'` 不存在
- `/notion/task` 路由体：`/\bTitle\s*:\s*\{/` = false；`/\bName\s*:\s*\{/` = true

---

### Step 4: 负向场景 — 带故意未知属性 POST → 2xx + warnings 非空

**来源**: `[FROM_PRD]` — PRD Step 5："payload 带一个故意未知属性 → 不 500/502，降级成功，日志与 API 响应均含 warning 留痕"

**可观测行为**: POST `/api/brain/notes` 带不存在的属性名，返回 2xx（不 400/500/502），`warnings` 数组非空，含跳过说明

**验证命令**:
```bash
RESP=$(curl -sf -X POST localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] 降级路径验收","content":"测试内容","type":"Note","fake_unknown_property":"should_be_stripped"}') \
  || { echo "FAIL: 降级路径非 2xx"; exit 1; }
echo "$RESP" | jq -e '.warnings | type == "array"' || { echo "FAIL: warnings 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.warnings | length >= 1' || { echo "FAIL: 降级路径 warnings 应非空"; exit 1; }
WARN_MSG=$(echo "$RESP" | jq -r '.warnings[0]')
echo "$WARN_MSG" | grep -qiE "skip|not in schema|unknown|剔除|忽略" \
  || { echo "FAIL: warnings[0]='$WARN_MSG' 未含跳过说明"; exit 1; }
echo "STEP 4 OK: warnings=$(echo "$RESP" | jq -c '.warnings')"
```

**硬阈值**: HTTP 2xx；`warnings` length ≥ 1；warnings[0] 含 skip/not in schema/unknown 字样

---

### Step 5: notion-property-map.js 模块可导入，导出 NOTION_PROPERTY_MAP 和 stripUnknownProperties

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：PRD 核心要求"三处共用的统一剔除+warn 策略"，必须有共用模块；通过可导入性验证防止 generator 只修 3 处硬编码不建共用模块。此步骤是 Step 1/2/4 中 `warnings` 字段存在的技术基础。

**可观测行为**: `packages/brain/src/notion-property-map.js` 存在、可正常 import、导出 `NOTION_PROPERTY_MAP`（对象）和 `stripUnknownProperties`（函数）；`NOTION_PROPERTY_MAP.notionTask.allowedKeys` 不含 `Status`（防 Bug 2 回归）

**验证命令**:
```bash
node --input-type=module << 'JSEOF'
import { stripUnknownProperties, NOTION_PROPERTY_MAP } from './packages/brain/src/notion-property-map.js';
if (typeof stripUnknownProperties !== 'function') {
  console.error('FAIL: stripUnknownProperties 不是函数');
  process.exit(1);
}
if (!NOTION_PROPERTY_MAP || typeof NOTION_PROPERTY_MAP !== 'object') {
  console.error('FAIL: NOTION_PROPERTY_MAP 未导出或不是对象');
  process.exit(1);
}
const taskMap = NOTION_PROPERTY_MAP.notionTask || {};
const taskKeys = taskMap.allowedKeys || Object.keys(taskMap);
if (taskKeys.includes('Status')) {
  console.error('FAIL: NOTION_PROPERTY_MAP.notionTask allowedKeys 含 Status — Bug 2 回归风险');
  process.exit(1);
}
const { props, warnings } = stripUnknownProperties(
  { 'Title': { title: [] }, 'FakeField': { rich_text: [] } },
  ['Title']
);
if (!props['Title']) { console.error('FAIL: 已知属性 Title 被误删'); process.exit(1); }
if (props['FakeField']) { console.error('FAIL: 未知属性 FakeField 未被剔除'); process.exit(1); }
if (!warnings || !warnings.some(w => w.includes('FakeField'))) {
  console.error('FAIL: warnings 未记录 FakeField');
  process.exit(1);
}
console.log('STEP 5 OK: notion-property-map.js 导入正确，strip 函数工作正常');
JSEOF
```

**硬阈值**: `import()` 成功；`stripUnknownProperties` 是函数；`NOTION_PROPERTY_MAP` 是对象；`notionTask.allowedKeys` 不含 `Status`

---

### Step 6: 归档所有 [contract-e2e] 测试页面

**来源**: `[AI_ADDED]` — PRD ASSUMPTION："E2E 测试页面统一前缀 [contract-e2e]，验收结束后 API PATCH archived=true 归档"；防止测试页面污染 Notion

**可观测行为**: 所有 `[contract-e2e]` 前缀 Notion 页面通过 Notion API PATCH archived=true，返回 HTTP 200

**验证命令**:
```bash
NOTION_TOKEN="${NOTION_API_KEY}"
NOTES_DB="185c40c2-ba63-828c-973f-81a9c4582cd6"
TASKS_DB="d5bc40c2-ba63-82ef-965a-8153b7ad81a0"
for DB_ID in "$NOTES_DB" "$TASKS_DB"; do
  QUERY_RESP=$(curl -sf -X POST "https://api.notion.com/v1/databases/$DB_ID/query" \
    -H "Authorization: Bearer $NOTION_TOKEN" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d '{"filter":{"property":"Title","title":{"starts_with":"[contract-e2e]"}}}') || QUERY_RESP='{}'
  echo "$QUERY_RESP" | jq -e '.results | type == "array"' >/dev/null \
    || { echo "WARN: DB $DB_ID query response invalid: $(echo "$QUERY_RESP" | jq -c '.error // empty')"; continue; }
  PAGE_IDS=$(echo "$QUERY_RESP" | jq -r '.results[].id' 2>/dev/null || echo "")
  for PAGE_ID in $PAGE_IDS; do
    [ -z "$PAGE_ID" ] && continue
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "https://api.notion.com/v1/pages/$PAGE_ID" \
      -H "Authorization: Bearer $NOTION_TOKEN" \
      -H "Notion-Version: 2022-06-28" \
      -H "Content-Type: application/json" \
      -d '{"archived":true}')
    [ "$CODE" = "200" ] && echo "archived $PAGE_ID" \
      || echo "WARN: archive $PAGE_ID returned $CODE"
  done
done
echo "STEP 6 OK"
```

**硬阈值**: 所有 PATCH 返回 HTTP 200；可接受 0 个页面（若前面步骤未实际创建 Notion 页面）
> gate-allow: weak-assert-no-pages 归档步骤若本轮 E2E 无 Notion 页面创建则零页面归档属预期，不应视为 FAIL

---

## E2E 验收（target_environment = local_api — curl+psql+jq-e pipeline）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e — Notion 属性映射修复（Brain↔Notion R2）Round 3
# 执行环境：Brain localhost:5221 已运行，psql 可用，NOTION_API_KEY 已配置
set -e

DB="${DB:-postgresql://localhost/cecelia}"
BASE="http://localhost:5221"
NOTION_TOKEN="${NOTION_API_KEY}"
NOTES_DB="185c40c2-ba63-828c-973f-81a9c4582cd6"
TASKS_DB="d5bc40c2-ba63-82ef-965a-8153b7ad81a0"
CREATED_PAGES=()

fail() { echo "FAIL: $*"; exit 1; }

cleanup() {
  echo ""
  echo "=== 归档 [contract-e2e] 测试页面 ==="
  for PAGE_ID in "${CREATED_PAGES[@]}"; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "https://api.notion.com/v1/pages/$PAGE_ID" \
      -H "Authorization: Bearer $NOTION_TOKEN" \
      -H "Notion-Version: 2022-06-28" \
      -H "Content-Type: application/json" \
      -d '{"archived": true}')
    [ "$CODE" = "200" ] && echo "  archived $PAGE_ID" \
      || echo "  [WARN] archive $PAGE_ID returned $CODE"
  done
}
trap cleanup EXIT

# ── Step 1: POST /api/brain/notes + initiative_id → 201 ──────────────────
echo "=== Step 1: notes initiative_id 修复验证 ==="
RESP1=$(curl -sf -X POST "$BASE/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] notes 映射修复","content":"E2E 验收内容","type":"Note","initiative_id":"cf4f596c-fa2b-48f2-ba7b-9969557c85a4"}') \
  || fail "POST /api/brain/notes 非 2xx"
echo "$RESP1" | jq -e '.id | type == "string"' || fail "notes.id 缺失"
echo "$RESP1" | jq -e '.url | type == "string"' || fail "notes.url 缺失"
echo "$RESP1" | jq -e '.title | type == "string"' || fail "notes.title 缺失"
echo "$RESP1" | jq -e '.warnings | type == "array"' || fail "notes.warnings 缺失"
echo "$RESP1" | jq -e '.warnings | length >= 1' || fail "notes.warnings 应非空（Initiative ID 剔除后必须留痕）"
NOTES_PAGE_ID=$(echo "$RESP1" | jq -r '.id')
[ -n "$NOTES_PAGE_ID" ] && [ "$NOTES_PAGE_ID" != "null" ] && CREATED_PAGES+=("$NOTES_PAGE_ID")

COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM notes WHERE initiative_id='cf4f596c-fa2b-48f2-ba7b-9969557c85a4' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "${COUNT:-0}" -ge 1 ] || fail "Brain DB notes initiative_id 记录缺失"
# PRD Step 2 明确要求 "GET 该 url 200" — Notion API 页面存在性确认
if [ -n "$NOTION_TOKEN" ] && [ -n "$NOTES_PAGE_ID" ] && [ "$NOTES_PAGE_ID" != "null" ]; then
  GET1=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://api.notion.com/v1/pages/$NOTES_PAGE_ID" \
    -H "Authorization: Bearer $NOTION_TOKEN" \
    -H "Notion-Version: 2022-06-28")
  [ "$GET1" = "200" ] || fail "Notion notes 页面 GET 返回 $GET1（期望 200）"
fi
echo "✓ Step 1 PASS: page_id=${NOTES_PAGE_ID}"

# ── Step 2: POST /api/brain/notion/task → 201 ─────────────────────────────
echo ""
echo "=== Step 2: notion/task Name 属性修复验证 ==="
RESP2=$(curl -sf -X POST "$BASE/api/brain/notion/task" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] 任务属性修复","ws_number":1}') \
  || fail "POST /api/brain/notion/task 非 2xx"
echo "$RESP2" | jq -e '.id | type == "string"' || fail "task.id 缺失"
echo "$RESP2" | jq -e '.url | type == "string"' || fail "task.url 缺失"
echo "$RESP2" | jq -e '.title | startswith("[WS1]")' || fail "task.title 缺 [WS1] 前缀"
echo "$RESP2" | jq -e '.warnings | type == "array"' || fail "task.warnings 缺失"
echo "$RESP2" | jq -e 'keys | sort == ["id","title","url","warnings"]' || fail "notion/task schema keys 不符"
TASK_PAGE_ID=$(echo "$RESP2" | jq -r '.id')
[ -n "$TASK_PAGE_ID" ] && [ "$TASK_PAGE_ID" != "null" ] && CREATED_PAGES+=("$TASK_PAGE_ID")
# PRD Step 3 明确要求 "GET 该 url 200" — Notion API 页面存在性确认
if [ -n "$NOTION_TOKEN" ] && [ -n "$TASK_PAGE_ID" ] && [ "$TASK_PAGE_ID" != "null" ]; then
  GET2=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://api.notion.com/v1/pages/$TASK_PAGE_ID" \
    -H "Authorization: Bearer $NOTION_TOKEN" \
    -H "Notion-Version: 2022-06-28")
  [ "$GET2" = "200" ] || fail "Notion task 页面 GET 返回 $GET2（期望 200）"
fi
echo "✓ Step 2 PASS: page_id=${TASK_PAGE_ID}"

# ── Step 3: notion-push-sync 精确静态 + 函数体分析 ────────────────────────
echo ""
echo "=== Step 3: notion-push-sync 旧属性已移除（精确函数体断言）==="

# 3a. pushJourneyStepLinks 函数体：Order: 已移除，Name 保留
node -e "
const src = require('fs').readFileSync('packages/brain/src/notion-push-sync.js', 'utf8');
const fnStart = src.indexOf('async function pushJourneyStepLinks');
if (fnStart < 0) { console.error('FAIL: pushJourneyStepLinks 函数未找到'); process.exit(1); }
const fnEnd = src.indexOf('\nasync function ', fnStart + 1);
const fnBody = src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
if (/\\bOrder\\s*:\\s*\\{/.test(fnBody)) {
  console.error('FAIL: pushJourneyStepLinks 仍含 Order: 属性');
  process.exit(1);
}
if (!fnBody.includes('Name')) {
  console.error('FAIL: pushJourneyStepLinks 缺 Name 属性（title 必须保留）');
  process.exit(1);
}
console.log('  ✓ pushJourneyStepLinks: Order 已移除，Name 保留');
" || fail "pushJourneyStepLinks 函数体断言失败"

# 3b. /notes 路由体：Initiative ID 已移除
node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/notes.js', 'utf8');
const routeStart = src.indexOf(\"router.post('/notes'\");
if (routeStart < 0) { console.error('FAIL: /notes 路由未找到'); process.exit(1); }
const routeEnd = src.indexOf('\nrouter.', routeStart + 1);
const routeBody = src.slice(routeStart, routeEnd > 0 ? routeEnd : undefined);
if (routeBody.includes(\"'Initiative ID'\")) {
  console.error('FAIL: /notes 路由仍含旧属性 Initiative ID');
  process.exit(1);
}
console.log('  ✓ /notes 路由: Initiative ID 已移除');
" || fail "/notes 路由 Initiative ID 断言失败"

# 3c. /notion/task 路由体：Title 已改为 Name
node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/notes.js', 'utf8');
const routeStart = src.indexOf(\"router.post('/notion/task'\");
if (routeStart < 0) { console.error('FAIL: /notion/task 路由未找到'); process.exit(1); }
const routeEnd = src.indexOf('\nrouter.', routeStart + 1);
const routeEnd2 = src.indexOf('\nexport ', routeStart + 1);
const endIdx = routeEnd > 0 ? routeEnd : (routeEnd2 > 0 ? routeEnd2 : undefined);
const routeBody = src.slice(routeStart, endIdx);
if (/\\bTitle\\s*:\\s*\\{/.test(routeBody)) {
  console.error('FAIL: /notion/task 路由仍含旧属性 Title:');
  process.exit(1);
}
if (!/\\bName\\s*:\\s*\\{/.test(routeBody)) {
  console.error('FAIL: /notion/task 路由缺 Name: 属性');
  process.exit(1);
}
console.log('  ✓ /notion/task 路由: Title 已改为 Name');
" || fail "/notion/task 路由 Name 断言失败"

echo "✓ Step 3 PASS: 三处旧属性全移除（精确函数体断言通过）"

# ── Step 4: 降级路径 warnings 非空 ────────────────────────────────────────
echo ""
echo "=== Step 4: 降级路径（未知属性 → warnings 非空）==="
RESP4=$(curl -sf -X POST "$BASE/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] 降级路径测试","content":"test body","type":"Note","fake_unknown_property":"should_warn"}') \
  || fail "降级路径非 2xx"
echo "$RESP4" | jq -e '.warnings | type == "array"' || fail "降级路径 warnings 缺失"
echo "$RESP4" | jq -e '.warnings | length >= 1' || fail "降级路径 warnings 应非空"
WARN0=$(echo "$RESP4" | jq -r '.warnings[0]')
echo "$WARN0" | grep -qiE "skip|not in schema|unknown|剔除" || fail "warnings[0]='$WARN0' 未含跳过说明"
DEGRADE_PAGE_ID=$(echo "$RESP4" | jq -r '.id')
[ -n "$DEGRADE_PAGE_ID" ] && [ "$DEGRADE_PAGE_ID" != "null" ] && CREATED_PAGES+=("$DEGRADE_PAGE_ID")
echo "✓ Step 4 PASS: warnings=$(echo "$RESP4" | jq -c '.warnings')"

# ── Step 5: notion-property-map.js 模块验证 ───────────────────────────────
echo ""
echo "=== Step 5: notion-property-map.js 模块导入验证 ==="
node --input-type=module << 'JSEOF'
import { stripUnknownProperties, NOTION_PROPERTY_MAP } from './packages/brain/src/notion-property-map.js';
if (typeof stripUnknownProperties !== 'function') { console.error('FAIL: stripUnknownProperties 不是函数'); process.exit(1); }
if (!NOTION_PROPERTY_MAP || typeof NOTION_PROPERTY_MAP !== 'object') { console.error('FAIL: NOTION_PROPERTY_MAP 未导出'); process.exit(1); }
const taskMap = NOTION_PROPERTY_MAP.notionTask || {};
const taskKeys = taskMap.allowedKeys || Object.keys(taskMap);
if (taskKeys.includes('Status')) { console.error('FAIL: notionTask allowedKeys 含 Status — Bug 2 回归'); process.exit(1); }
const { props, warnings } = stripUnknownProperties({ 'Title': { title: [] }, 'FakeField': { rich_text: [] } }, ['Title']);
if (!props['Title']) { console.error('FAIL: 已知属性 Title 被误删'); process.exit(1); }
if (props['FakeField']) { console.error('FAIL: 未知属性 FakeField 未被剔除'); process.exit(1); }
if (!warnings || !warnings.some(w => w.includes('FakeField'))) { console.error('FAIL: warnings 未记录 FakeField'); process.exit(1); }
console.log('✓ Step 5 PASS: notion-property-map.js 导入正确');
JSEOF

echo ""
echo "✅ Notion 属性映射修复 Golden Path 全部验证通过（5/5 PASS）"
```

**通过标准**: 脚本 exit 0，Step 1–5 全部 PASS，cleanup 归档所有 `[contract-e2e]` 测试页面

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| notion-property-map.js 模块 | `tests/notion-mapping-fix.test.ts` | stripUnknownProperties + NOTION_PROPERTY_MAP + notionTask 不含 Status | → FAIL（文件不存在）|
| POST /api/brain/notes → warnings | `tests/notion-mapping-fix.test.ts` | response 含 warnings(array) | → FAIL（当前不返回 warnings）|
| POST /api/brain/notion/task → Name + warnings | `tests/notion-mapping-fix.test.ts` | Notion call 用 Name 不用 Title + response 含 warnings | → FAIL（当前用 Title，无 warnings）|
| pushJourneyStepLinks 无 Order | `tests/notion-mapping-fix.test.ts` | 源码静态 + mock Notion 调用不含 Order | → FAIL（当前含 Order）|

### ⚠️ 现有 CI 测试需由 generator 在同一 PR 内更新（修代码前 RED，修后 GREEN）

| 文件 | 行号 | 当前断言（旧行为）| 修复后断言 |
|---|---|---|---|
| `packages/brain/src/routes/notes.test.js` | :51 | `toEqual(['id', 'title', 'url'])` | `toEqual(['id', 'title', 'url', 'warnings'])` |
| `packages/brain/src/routes/notes.test.js` | :65 | `properties['Initiative ID']).toBeDefined()` | `.not.toHaveProperty('Initiative ID')` |
| `packages/brain/src/routes/notes.test.js` | :137 | `toEqual(['id', 'title', 'url'])` | `toEqual(['id', 'title', 'url', 'warnings'])` |
