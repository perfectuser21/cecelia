# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: PRD 明确 + api_registry 空 → [NEW_PATTERN]）

### Endpoint: POST /api/brain/notes
**Success (HTTP 201)**:
```json
{"id": "<string>", "url": "<string>", "title": "<string>", "warnings": []}
```
- `url` (string, 必填): Notion 页面 URL，`https://notion.so/...` 格式 — 来源 PRD 明确
- `warnings` (string[], 必填): 未知属性剔除说明列表，正常路径为 `[]`，降级路径含跳过记录 — 来源 PRD 明确
- `id` (string, 可选): Notion 页面 ID — 来源现有代码保留

**禁用字段名（旧属性名禁止出现在 Notion payload 中）**: `Initiative ID`（AI Notes DB 重构后已删）

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

---

### Endpoint: POST /api/brain/notion/task
**Success (HTTP 201)**:
```json
{"id": "<string>", "url": "<string>", "title": "<string>", "warnings": []}
```
- `url` (string, 必填): Notion 页面 URL — 来源 PRD 明确
- `warnings` (string[], 必填): 未知属性剔除列表 — 来源 PRD 明确

**禁用字段名（旧属性名）**: `Title`（Tasks DB 重构后改为 `Name`）

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

---

### notion-push-sync（无 HTTP 响应）
`N/A — runNotionPushSync 是 setInterval 触发的后台任务，无 HTTP 响应。验证方式：notion_sync_log 表无新增 "is not a property" 错误 + 源码不含旧属性名。`

---

## 已知约束（来自回归测试）

- [notes-notion-task.test.js] POST /notion/task 带 status 时 Notion properties 中不含 Status 字段（Bug 2 回归）
- [notes-notion-task.test.js] POST /notion/task 带 status 时 status 值出现在 children paragraph 中
- [notes-notion-task.test.js] 缺少 title 返回 400
- [notes.test.js] POST /api/brain/notes 返回 {id, url, title} 三字段（新增 warnings 后变为 4 字段）
- [notes.test.js] POST /api/brain/notes 传 initiative_id 写入 Notion properties 和 DB
- [notion-push-sync.test.js] 无待同步行时不调 Notion API
- [notion-push-sync-db-ids.test.js] AI Notes DB 只有三个 property：Title、Type、Date（Initiative ID 不在其中）

---

## Golden Path

```
[调用方触发推送 / tick 触发]
  → [notion-property-map.js 映射常量翻译属性名，剔除未知属性，收集 warnings]
  → [Notion API 创建页面，返回 page.url]
  → [路由返回 {url, warnings}，无 400]
```

---

### Step 1: POST /api/brain/notes 带 initiative_id → 成功创建 Notion 页面

**来源**: `[FROM_PRD]` — PRD "背景" 第一条：`POST /api/brain/notes 带 initiative_id → "Initiative ID is not a property"` 需修复

**可观测行为**: 请求返回 HTTP 201，body 含 `url`（Notion 页面链接）和 `warnings: []`；GET 该 url 返回 HTTP 200

**验证命令**:
```bash
curl -sf -X POST localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] notes 修复验证","content":"E2E 测试正文","type":"Note","initiative_id":"test-init-id-e2e"}' \
  | tee /tmp/e2e_step1.json \
  | jq -e '.url | type == "string"' > /dev/null \
  || { echo "FAIL: POST /api/brain/notes 非 2xx 或 url 字段不是 string"; exit 1; }
RESP=$(cat /tmp/e2e_step1.json)
echo "$RESP" | jq -e '.warnings | type == "array"' || { echo "FAIL: warnings 字段缺失或不是 array"; exit 1; }
echo "$RESP" | jq -e '.warnings | length == 0' || { echo "FAIL: 正常路径 warnings 应为空数组"; exit 1; }

# URL 格式验证（Notion URL 需 auth 不可公开访问，验证格式而非访问性）
NOTION_URL=$(echo "$RESP" | jq -r '.url')
echo "$NOTION_URL" | grep -qE '^https://(www\.)?notion\.so/' \
  || { echo "FAIL: url 格式不是 notion.so: $NOTION_URL"; exit 1; }

echo "STEP 1 OK: url=${NOTION_URL:0:50}"
```

**硬阈值**: HTTP 201、`url` 匹配 `^https://(www\.)?notion\.so/`、`warnings` 为空数组

---

### Step 2: POST /api/brain/notion/task → 成功创建 Notion Task 页面

**来源**: `[FROM_PRD]` — PRD "背景" 第二条：`POST /api/brain/notion/task → "Title is not a property"` 需修复

**可观测行为**: 请求返回 HTTP 201，body 含 `url` 和 `warnings: []`

**验证命令**:
```bash
curl -sf -X POST localhost:5221/api/brain/notion/task \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] task 修复验证","ws_number":1}' \
  | tee /tmp/e2e_step2.json \
  | jq -e '.url | type == "string"' > /dev/null \
  || { echo "FAIL: POST /api/brain/notion/task 非 2xx 或 url 字段不是 string"; exit 1; }
RESP2=$(cat /tmp/e2e_step2.json)
echo "$RESP2" | jq -e '.warnings | type == "array"' || { echo "FAIL: warnings 字段缺失"; exit 1; }
echo "$RESP2" | jq -e 'has("url") and has("warnings")' || { echo "FAIL: 必填字段 url/warnings 不完整"; exit 1; }

echo "STEP 2 OK: url=$(echo "$RESP2" | jq -r '.url' | cut -c1-50)"
```

**硬阈值**: HTTP 201、`url` 字符串、`warnings` 数组（两字段同时存在）

---

### Step 3: notion-push-sync step_link 推送 → 无 "is not a property" 错误

**来源**: `[FROM_PRD]` — PRD "背景" 第三条：`notion-push-sync 的 step_link → "Order is not a property"` 需修复

**可观测行为**: `pushJourneyStepLinks` 调用 Notion API 时不携带已删除的 `Order` 属性；`notion_sync_log` 表近 5 分钟内无 "is not a property" 错误记录

**验证命令**:
```bash
# 静态检查（风险 R3 mitigation — 扩展 grep 覆盖三处已知旧属性名，不止 Order）
# 1. notion-push-sync.js 中 Step Links 的旧属性名 Order
grep -n "'Order'" packages/brain/src/notion-push-sync.js \
  && { echo "FAIL: notion-push-sync.js 仍含旧属性 Order"; exit 1; } \
  || echo "OK: Order 属性已移除"
# 2. notes.js 中 AI Notes DB 的旧属性名 Initiative ID
grep -n "'Initiative ID'" packages/brain/src/routes/notes.js \
  && { echo "FAIL: notes.js 仍含旧属性 Initiative ID"; exit 1; } \
  || echo "OK: Initiative ID 属性已移除"
# 3. notes.js notion/task handler 中的旧 Title 属性（Tasks DB 已改用 Name）
#    检测方式：查找 notion/task 附近出现 Title: { title: 的组合
grep -A 20 "router.post.*notion/task" packages/brain/src/routes/notes.js \
  | grep "Title: {" \
  && { echo "FAIL: notion/task handler 仍含旧属性 Title:"; exit 1; } \
  || echo "OK: notion/task Title 属性已移除"

# 运行时检查：notion_sync_log 近 5 分钟无新增 "is not a property" 错误（单行 SQL 含时间窗）
DB="${DB_URL:-postgresql://localhost/cecelia}"
COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM notion_sync_log WHERE error_message LIKE '%is not a property%' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "${COUNT:-0}" -eq 0 ] \
  || { echo "FAIL: notion_sync_log 有 $COUNT 条 'is not a property' 错误（近 5 分钟）"; exit 1; }

echo "STEP 3 OK: 无 Order 属性，sync_log 无 'is not a property' 错误"
```

**硬阈值**: `grep -n "Order:" notion-push-sync.js` 无输出 + notion_sync_log count = 0（5 分钟窗口）

---

### Step 4: POST 带故意未知属性 → 200/201 + warnings 非空（降级路径）

**来源**: `[FROM_PRD]` — PRD "可观测结果"第 2 条：`降级路径（payload 含未知属性）→ HTTP 200，响应含 {url: ..., warnings: ["initiative_id skipped: not in schema"]}`

**可观测行为**: 请求带故意未知属性，返回 2xx，`warnings` 数组非空，含 "skipped" 字样；不返回 400/500

**验证命令**:
```bash
curl -sf -X POST localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] 降级路径验证","content":"测试内容","type":"Note","fake_unknown_property":"should_be_stripped"}' \
  | tee /tmp/e2e_step4.json \
  | jq -e '.warnings | length > 0' > /dev/null \
  || { echo "FAIL: 降级路径非 2xx 或 warnings 应非空（未知属性应被记录）"; exit 1; }
RESP3=$(cat /tmp/e2e_step4.json)
echo "$RESP3" | jq -e '.warnings | type == "array"' || { echo "FAIL: 降级路径 warnings 字段缺失"; exit 1; }
WARN_MSG=$(echo "$RESP3" | jq -r '.warnings[0]')
echo "$WARN_MSG" | grep -qi "skip\|not in schema\|unknown\|剔除\|忽略" \
  || { echo "FAIL: warnings[0]='$WARN_MSG' 未包含跳过说明"; exit 1; }

echo "STEP 4 OK: warnings=$(echo "$RESP3" | jq -c '.warnings')"
```

**硬阈值**: HTTP 2xx（不 400/500）、`warnings` 数组 length ≥ 1、warnings[0] 含 skip/not in schema/unknown 字样

---

### Step 5: notion-property-map.js 模块可导入，导出 stripUnknownProperties 函数

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：三处路由共用映射常量是 PRD 核心要求（新建 `notion-property-map.js`），通过可导入性验证防止 Generator 只修 3 处硬编码而不建共用模块，导致四处代码维护分散。

**可观测行为**: `packages/brain/src/notion-property-map.js` 存在且可正常 import；导出 `stripUnknownProperties` 函数

**验证命令**:
```bash
node -e "
  import('./packages/brain/src/notion-property-map.js').then(m => {
    if (typeof m.stripUnknownProperties !== 'function') {
      console.error('FAIL: stripUnknownProperties 不是函数');
      process.exit(1);
    }
    if (!m.NOTION_PROPERTY_MAP || typeof m.NOTION_PROPERTY_MAP !== 'object') {
      console.error('FAIL: NOTION_PROPERTY_MAP 未导出');
      process.exit(1);
    }
    console.log('STEP 5 OK: notion-property-map.js 可导入，导出正确');
  }).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
" || exit 1
```

**硬阈值**: `import()` 成功、`stripUnknownProperties` 是函数、`NOTION_PROPERTY_MAP` 是对象

---

## E2E 验收（target_environment = local_api — bash curl 全程链路）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e — Notion 属性映射修复 E2E 验收脚本
# 执行环境：本地，Brain localhost:5221 已运行，NOTION_API_KEY 已配置
set -e

DB="${DB_URL:-postgresql://localhost/cecelia}"
BASE="http://localhost:5221"
START_TIME=$(date +%s)
CREATED_PAGES=()

cleanup() {
  echo ""
  echo "=== 清理 [contract-e2e] 测试页面 ==="
  for PAGE_ID in "${CREATED_PAGES[@]}"; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "https://api.notion.com/v1/pages/$PAGE_ID" \
      -H "Authorization: Bearer $NOTION_API_KEY" \
      -H "Notion-Version: 2022-06-28" \
      -H "Content-Type: application/json" \
      -d '{"archived": true}')
    [ "$HTTP_CODE" = "200" ] && echo "  archived page $PAGE_ID" \
      || echo "  [WARN] 清理页面 $PAGE_ID 返回 HTTP $HTTP_CODE（可手动归档）"
  done
}
trap cleanup EXIT

fail() { echo "FAIL: $*"; exit 1; }

# ── 1. POST /api/brain/notes 带 initiative_id ──────────────────────────────
echo "=== Step 1: POST /api/brain/notes 修复验证 ==="
curl -sf -X POST "$BASE/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] notes 映射修复","content":"E2E 自动生成测试记录","type":"Note","initiative_id":"e2e-test-init-id"}' \
  | tee /tmp/e2e_resp1.json \
  | jq -e '.url | type == "string"' > /dev/null \
  || fail "Step 1: POST /api/brain/notes 非 2xx 或 url 字段不是 string"
RESP1=$(cat /tmp/e2e_resp1.json)
echo "$RESP1" | jq -e '.warnings | type == "array"' || fail "Step 1: warnings 字段缺失"
echo "$RESP1" | jq -e '.warnings | length == 0' || fail "Step 1: 正常路径 warnings 非空（应为 []）"
NOTION_URL1=$(echo "$RESP1" | jq -r '.url')
echo "$NOTION_URL1" | grep -qE '^https://(www\.)?notion\.so/' \
  || fail "Step 1: url 格式不是 notion.so: $NOTION_URL1"
PAGE1_ID=$(echo "$RESP1" | jq -r '.id')
[ -n "$PAGE1_ID" ] && [ "$PAGE1_ID" != "null" ] && CREATED_PAGES+=("$PAGE1_ID")
echo "✓ Step 1 PASS: url=${NOTION_URL1:0:60}"

# 1b. DB initiative_id 非 null（风险 R1 mitigation — 防重构误删 DB 写入，单行 SQL 含时间窗）
DB_INIT_ID=$(psql "$DB" -t -c "SELECT initiative_id FROM notes WHERE title='[contract-e2e] notes 映射修复' AND created_at > NOW() - interval '5 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$DB_INIT_ID" ] && [ "$DB_INIT_ID" != "null" ] \
  || fail "Step 1b: DB notes.initiative_id 为 null 或记录缺失（initiative_id 在重构过程中被误删）"
echo "  ✓ DB initiative_id = $DB_INIT_ID (非 null)"

# ── 2. POST /api/brain/notion/task ──────────────────────────────────────────
echo ""
echo "=== Step 2: POST /api/brain/notion/task 修复验证 ==="
curl -sf -X POST "$BASE/api/brain/notion/task" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] task 映射修复","ws_number":1}' \
  | tee /tmp/e2e_resp2.json \
  | jq -e '.url | type == "string"' > /dev/null \
  || fail "Step 2: POST /api/brain/notion/task 非 2xx 或 url 字段不是 string"
RESP2=$(cat /tmp/e2e_resp2.json)
echo "$RESP2" | jq -e '.warnings | type == "array"' || fail "Step 2: warnings 字段缺失"
echo "$RESP2" | jq -e 'has("url") and has("warnings")' || fail "Step 2: 必填字段 url/warnings 不完整"
PAGE2_ID=$(echo "$RESP2" | jq -r '.id')
[ -n "$PAGE2_ID" ] && [ "$PAGE2_ID" != "null" ] && CREATED_PAGES+=("$PAGE2_ID")
echo "✓ Step 2 PASS: url=$(echo "$RESP2" | jq -r '.url' | cut -c1-60)"

# ── 3. notion-push-sync 静态检查（旧属性名已移除）──────────────────────────
echo ""
echo "=== Step 3: notion-push-sync Order 属性已移除 ==="
grep -n "Order:" packages/brain/src/notion-push-sync.js \
  && fail "notion-push-sync.js 仍含旧 Order: 属性" \
  || echo "✓ Order 属性已移除"

# notion_sync_log 近 5 分钟无 "is not a property" 错误（单行 SQL 含时间窗）
COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM notion_sync_log WHERE error_message LIKE '%is not a property%' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "${COUNT:-0}" -eq 0 ] \
  || fail "Step 3: notion_sync_log 有 ${COUNT} 条 'is not a property' 错误（近 5 分钟）"
echo "✓ Step 3 PASS: 无旧属性错误"

# ── 4. 降级路径：未知属性 → warnings 非空 ──────────────────────────────────
echo ""
echo "=== Step 4: 降级路径（未知属性）验证 ==="
curl -sf -X POST "$BASE/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] 降级路径测试","content":"降级测试内容","type":"Note","fake_unknown_prop":"should_warn"}' \
  | tee /tmp/e2e_resp3.json \
  | jq -e '.warnings | length > 0' > /dev/null \
  || fail "Step 4: 降级路径非 2xx 或 warnings 应非空"
RESP3=$(cat /tmp/e2e_resp3.json)
echo "$RESP3" | jq -e '.warnings | type == "array"' || fail "Step 4: warnings 字段缺失"
WARN_MSG=$(echo "$RESP3" | jq -r '.warnings[0]')
echo "$WARN_MSG" | grep -qi "skip\|not in schema\|unknown\|剔除" \
  || fail "Step 4: warnings[0]='$WARN_MSG' 未包含跳过说明"
PAGE3_ID=$(echo "$RESP3" | jq -r '.id')
[ -n "$PAGE3_ID" ] && [ "$PAGE3_ID" != "null" ] && CREATED_PAGES+=("$PAGE3_ID")
echo "✓ Step 4 PASS: warnings=$(echo "$RESP3" | jq -c '.warnings')"

# ── 5. notion-property-map.js 模块可导入 ──────────────────────────────────
echo ""
echo "=== Step 5: notion-property-map.js 模块验证 ==="
node --input-type=module << 'JSEOF'
import { stripUnknownProperties, NOTION_PROPERTY_MAP } from './packages/brain/src/notion-property-map.js';
if (typeof stripUnknownProperties !== 'function') {
  console.error('FAIL: stripUnknownProperties 不是函数');
  process.exit(1);
}
if (!NOTION_PROPERTY_MAP || typeof NOTION_PROPERTY_MAP !== 'object') {
  console.error('FAIL: NOTION_PROPERTY_MAP 未导出');
  process.exit(1);
}
// 验证 stripUnknownProperties 能正确剔除未知属性
const { props, warnings } = stripUnknownProperties(
  { 'Title': { title: [] }, 'Fake': { rich_text: [] } },
  ['Title']
);
if (!props['Title']) { console.error('FAIL: 已知属性 Title 被误删'); process.exit(1); }
if (props['Fake']) { console.error('FAIL: 未知属性 Fake 未被剔除'); process.exit(1); }
if (!warnings.some(w => w.includes('Fake'))) { console.error('FAIL: warnings 未记录 Fake'); process.exit(1); }
console.log('✓ Step 5 PASS: 模块导入正确，strip 函数工作正常');
JSEOF

# ── 产物时间戳验证（防造假：Notion 页面 created_at 须在本轮内）──────────────
echo ""
echo "=== 时间戳防造假检查 ==="
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
[ "$ELAPSED" -lt 300 ] || { echo "[WARN] E2E 耗时 ${ELAPSED}s 较长，建议检查 Notion API 延迟"; }
echo "✓ E2E 总耗时 ${ELAPSED}s"

echo ""
echo "✅ Golden Path 全部验证通过（5/5 步骤 PASS）"
```

**通过标准**: 脚本 exit 0，5 个步骤全部 PASS，cleanup 归档所有 `[contract-e2e]` 测试页面

---

## Risks

| # | 风险 | 影响 | Mitigation（合同已覆盖） |
|---|---|---|---|
| R1 | generator 重构 notes handler 时误删 DB `initiative_id` 写入 | `notes` 表 initiative_id 丢失，Harness report 无法关联 Initiative | E2E Step 1b：psql 验证 notes 表 initiative_id 非 null + contract-dod BEHAVIOR 第 8 条 |
| R2 | `stripUnknownProperties` 的 notion-task allowedKeys 误含 `Status` → Bug 2 回归 | `POST /notion/task` 将 `Status` 写入 Notion properties → Notion 400 | tests/ 新增 allowlist 不含 Status 测试 + contract-dod BEHAVIOR 第 9 条 |
| R3 | notion-push-sync 除 `Order` 外仍有其他旧属性名（`Initiative ID` / `Title` 跨文件扩散）| step_link/notes/task 推送仍 400 | Step 3 验证命令扩展为三处旧属性名 grep + contract-dod ARTIFACT 2 扩展 |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| notion-property-map.js | `tests/notion-property-map.test.ts` | NOTION_PROPERTY_MAP / stripUnknownProperties / notionTask allowedKeys 不含 Status | → 4 failures（文件不存在）|
| POST /api/brain/notes → warnings | `tests/notion-property-map.test.ts` | 成功路径返回 warnings | → 1 failure（当前不返回 warnings）|
| POST /api/brain/notion/task → warnings | `tests/notion-property-map.test.ts` | 成功路径返回 warnings | → 1 failure（当前不返回 warnings）|

### ⚠️ 现有 CI 测试必须由 generator 更新（修代码前 RED，修后 GREEN，必须 commit）

| 文件 | 行号 | 当前断言（bug 行为）| 修复后断言 | 说明 |
|---|---|---|---|---|
| `packages/brain/src/routes/notes.test.js` | :55 | `expect(notionBody.properties['Initiative ID']).toBeDefined()` | `expect(notionBody.properties).not.toHaveProperty('Initiative ID')` | 旧属性名已移除，继续断言 defined = 测试锁定 bug |
| `packages/brain/src/routes/notes.test.js` | :45 | `Object.keys(res.body).sort()).toEqual(['id', 'title', 'url'])` | `toEqual(['id', 'title', 'url', 'warnings'])` | 添加 warnings 字段后精确 3 字段匹配 FAIL |
| `packages/brain/src/routes/notes.test.js` | :137 | `Object.keys(res.body).sort()).toEqual(['id', 'title', 'url'])` | `toEqual(['id', 'title', 'url', 'warnings'])` | notion/task 同样添加 warnings，三字段匹配 FAIL |

**声明**：generator 必须在同一 PR 内更新上述三处断言，保持 CI 始终 GREEN。这三处测试在修代码前会 RED（验证 Red 阶段真红），修完后必须 GREEN。
