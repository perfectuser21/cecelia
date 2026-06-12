# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: PRD 字段 + api_registry 现有端点推导）

### Endpoint: POST /api/brain/notes（修改）

**Success (HTTP 201)**:
```json
{"id": "<string>", "url": "<string>", "title": "<string>", "warnings": ["<string>"]}
```
- `id` (string, 必填): Notion 页面 UUID — 来自现有实现（notes.js:54 `page.id`）
- `url` (string, 必填): Notion 页面 URL — 来自现有实现（notes.js:54 `page.url`）
- `title` (string, 必填): 创建的页面标题 — 来自现有实现
- `warnings` (string[], 新增): 被降级跳过的属性描述列表；无跳过时为 `[]` — PRD "response.warnings 数组说明"

**禁用字段名**: `warning`（单数），`skipped`，`errors`（不是 error path 字段）

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

**Error (HTTP 502)**:
```json
{"error": "<string>"}
```

---

### Endpoint: POST /api/brain/notion/task（内部修复，响应 schema 不变）

**Success (HTTP 201)**:
```json
{"id": "<string>", "url": "<string>", "title": "<string>"}
```
- `id` (string, 必填): Notion 页面 UUID
- `url` (string, 必填): Notion 页面 URL
- `title` (string, 必填): 实际写入的标题（含 [WSn] 前缀）

**禁用字段名**: `warnings`（task 路由不新增 warnings 字段）

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

---

## 已知约束（来自回归测试）

- [notes-notion-task.test.js] → POST /notion/task 不带 status 时返回 201
- [notes-notion-task.test.js] → 带 status 时 Notion properties 中不含 Status 字段（Bug 2 回归）
- [notes-notion-task.test.js] → 带 status 时 status 值出现在 children paragraph 中
- [notes-notion-task.test.js] → 缺少 title 返回 400
- [notion-push-sync.test.js] → 无待同步行时不调 Notion API
- [notion-push-sync.test.js] → 有待同步 journey 时调 Notion API 创建页面并更新 notion_synced_at
- [notion-push-sync.test.js] → Notion API 失败时跳过该行（notion_synced_at 保持 NULL）
- [notion-push-sync.test.js] → calls pushSkillRegistry / pushJourneySteps / pushJourneyStepLinks

---

## Golden Path

[Brain API 推送 Notion] → [属性名校验与降级] → [Notion 页面真实创建，无 400]

```
POST /api/brain/notes (initiative_id)
        ↓ 实查 AI Notes DB schema
        ↓ "Initiative ID" 不在 schema → 跳过 + warnings
        ↓ Notion POST /pages → 201
Step 1: 降级创建成功 (201 + warnings[])

POST /api/brain/notion/task
        ↓ 实查 Tasks DB schema → 找到 title property 真实名称 (Name)
        ↓ 用 Name 写入
Step 2: Notion 创建成功 (201，不再 400)

notion-push-sync 触发 pushJourneyStepLinks
        ↓ 实查 STEP_LINKS_DB schema
        ↓ "Order" 不在 schema → 跳过（不写该字段）
Step 3: step_link 推送无 "is not a property" 400

POST /api/brain/notes 传入全未知属性 (initiative_id 不在 schema)
Step 4: 200/201 + warnings 数组（非 500/502）

[contract-e2e] 测试页面归档（teardown）
Step 5: Notion PATCH archived:true → 200
```

---

### Step 1: POST /api/brain/notes 带 initiative_id → 降级创建成功

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条："POST /api/brain/notes 带 initiative_id → 200，返回 url 经 Notion API GET 验证页面存在；DB 无 'Initiative ID' 属性 → 自动剔除 + response.warnings 数组说明"

**可观测行为**: Brain API 返回 201 + `{id, url, title, warnings: [...]}`，warnings 中包含 "Initiative ID" 被跳过的说明；Notion 页面真实被创建（url 可 GET 验证页面存在）

**验证命令**:
```bash
# 1a. 触发 — 发送带 initiative_id 的 notes 请求
RESP=$(curl -sf -X POST http://localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] R4 Step1 test","content":"E2E test content","type":"Note","initiative_id":"test-init-r4"}')
echo "RESP=$RESP"

# 1b. 返回 id 和 url（schema 字段值断言）
echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: id 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.url | type == "string"' || { echo "FAIL: url 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.title | type == "string"' || { echo "FAIL: title 字段缺失"; exit 1; }

# 1c. warnings 数组存在（Initiative ID 被降级时必须出现）
echo "$RESP" | jq -e '.warnings | type == "array"' || { echo "FAIL: warnings 字段缺失或非数组"; exit 1; }

# 1d. 禁用字段反向检查
echo "$RESP" | jq -e 'has("warning") | not' || { echo "FAIL: 禁用字段 warning（单数）出现"; exit 1; }

# 1e. Notion 页面真实存在 — 用返回的 page id 验证（需要 NOTION_API_KEY）
PAGE_ID=$(echo "$RESP" | jq -r '.id')
PAGE_URL=$(echo "$RESP" | jq -r '.url')
NOTION_CHECK=$(curl -sf \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  "https://api.notion.com/v1/pages/$PAGE_ID" | jq -r '.id')
[ "$NOTION_CHECK" = "$PAGE_ID" ] || { echo "FAIL: Notion 页面不存在 PAGE_ID=$PAGE_ID"; exit 1; }

echo "✅ Step1 PASS: notes POST 201 + warnings + Notion 页面真实存在"
```

**硬阈值**: HTTP 201，`warnings` 为数组（可为空），`id`/`url`/`title` 均为 string，Notion GET 页面返回 id 匹配

---

### Step 2: POST /api/brain/notion/task → Notion 创建成功（不再 400）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条："POST /api/brain/notion/task → 200 真建页（Notion API GET 验证），Title 属性名与 DB schema 一致"

**可观测行为**: Brain API 返回 201 + `{id, url, title}`，Notion 页面通过 GET 验证真实存在（修前因 "Title" 属性名错误 → Notion 400 → Brain 502）

**验证命令**:
```bash
# 2a. 触发 — 创建 notion task
RESP2=$(curl -sf -X POST http://localhost:5221/api/brain/notion/task \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] R4 Step2 task","ws_number":1}')
echo "RESP2=$RESP2"

# 2b. schema 字段值断言
echo "$RESP2" | jq -e '.id | type == "string"' || { echo "FAIL: id 字段缺失"; exit 1; }
echo "$RESP2" | jq -e '.url | type == "string"' || { echo "FAIL: url 字段缺失"; exit 1; }
echo "$RESP2" | jq -e '.title | type == "string"' || { echo "FAIL: title 字段缺失"; exit 1; }

# 2c. keys 完整性（notion/task 响应只有三字段）
echo "$RESP2" | jq -e '[keys[]] | sort == ["id","title","url"]' || { echo "FAIL: keys 不符"; exit 1; }

# 2d. 禁用字段反向检查（notion/task 不应有 warnings）
echo "$RESP2" | jq -e 'has("warnings") | not' || { echo "FAIL: task 路由不应有 warnings 字段"; exit 1; }

# 2e. Notion 页面真实存在
PAGE_ID2=$(echo "$RESP2" | jq -r '.id')
NOTION_CHECK2=$(curl -sf \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  "https://api.notion.com/v1/pages/$PAGE_ID2" | jq -r '.id')
[ "$NOTION_CHECK2" = "$PAGE_ID2" ] || { echo "FAIL: notion/task 页面不存在 PAGE_ID=$PAGE_ID2"; exit 1; }

echo "✅ Step2 PASS: notion/task POST 201 + Notion 页面真实存在"
```

**硬阈值**: HTTP 201，`id`/`url`/`title` 为 string，`keys == [id,title,url]`，Notion GET 页面 id 匹配

---

### Step 3: notion-push-sync step_link 写入无 "is not a property" 400

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条："触发 notion-push-sync → step_link 写入 Order 字段无 'is not a property' 400"

**可观测行为**: pushJourneyStepLinks 函数在 STEP_LINKS_DB 属性清单中未查到 "Order" 时，不向 Notion 传递该字段；整体 push 不抛出 400。可通过单测验证属性名称跟随 schema 变化（不硬编码）

**验证命令**:
```bash
# 3a. 单测验证：pushJourneyStepLinks 发给 Notion 的 properties 不包含硬编码 "Order"
# 当 schema 返回 {"Name":{}, "Status":{}} 时（无 Order），properties 中不应有 Order
cd /workspace && node --experimental-vm-modules node_modules/.bin/vitest run \
  sprints/06121511-notion-mapping-r4/tests/ \
  --reporter=verbose 2>&1 | tee /tmp/r4-step3.log
grep -E "PASS|FAIL|✓|✗|step_link|Order" /tmp/r4-step3.log | tail -20
# 期望: step_link 相关测试全部 PASS，无 FAIL
grep -c "FAIL\|✗" /tmp/r4-step3.log | xargs -I{} bash -c '[ "{}" = "0" ] || { echo "FAIL: step_link 单测失败"; exit 1; }' || { echo "FAIL: step_link 单测失败"; exit 1; }
echo "✅ Step3 PASS: step_link 属性降级单测通过"
```

**硬阈值**: step_link 相关 vitest 测试 0 FAIL；代码中 pushJourneyStepLinks 不向 properties 写入不在 schema 的字段

---

### Step 4: 负向路径 — 未知属性 → 200/201 + warnings 非 500/502

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条："负向：故意传入未知属性 → 200 降级（非 500/502），warnings 数组留痕，不静默丢弃"；PRD 边界情况："全部待写字段均不存在于 DB schema → 仍 200，warnings 列出所有跳过字段"

**可观测行为**: POST /api/brain/notes 带一个肯定不在 AI Notes DB schema 的属性 (`initiative_id` 映射的 `'Initiative ID'` 已被移除），返回 201 + warnings 中明确列出跳过的字段；HTTP code 不为 502/500

**验证命令**:
```bash
# 4a. 传入 initiative_id — DB 无 'Initiative ID' 属性 → 降级
RESP4=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] R4 Step4 negative","content":"neg test","initiative_id":"fake-id-r4"}')
[ "$RESP4" = "201" ] || { echo "FAIL: 期望 201，实际 HTTP $RESP4（502 = 未降级）"; exit 1; }

# 4b. warnings 数组非空（说明确实跳过了属性）
RESP4_BODY=$(curl -sf -X POST http://localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] R4 Step4b negative","content":"neg test b","initiative_id":"fake-id-r4b"}')
echo "$RESP4_BODY" | jq -e '.warnings | type == "array"' || { echo "FAIL: warnings 字段缺失"; exit 1; }
echo "$RESP4_BODY" | jq -e '.warnings | length >= 1' || { echo "FAIL: warnings 数组为空（属性未被降级记录）"; exit 1; }

echo "✅ Step4 PASS: 未知属性 → 201 + warnings 非空"
```

**硬阈值**: HTTP 201（非 500/502），`warnings` 数组长度 ≥ 1

---

### Step 5: E2E teardown — 归档 [contract-e2e] 测试页

**来源**: `[AI_ADDED]` — PRD 要求 "E2E 测试页 [contract-e2e] 前缀，末尾 Notion API 归档"；防止测试产生的 Notion 页面污染真实 DB，每次 E2E 执行后必须 teardown

**可观测行为**: Step 1/2 创建的 [contract-e2e] 测试页通过 Notion PATCH archived:true 归档成功（HTTP 200）

**验证命令**:
```bash
# teardown — 归档 Step1/2 创建的测试页
for PAGE_ID in "$PAGE_ID" "$PAGE_ID2"; do
  [ -z "$PAGE_ID" ] && continue
  ARCHIVE_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PATCH "https://api.notion.com/v1/pages/$PAGE_ID" \
    -H "Authorization: Bearer $NOTION_API_KEY" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d '{"archived":true}')
  [ "$ARCHIVE_CODE" = "200" ] || echo "WARN: 归档 $PAGE_ID 返回 $ARCHIVE_CODE（非致命）"
done
# gate-allow: cheat/or-true teardown — 归档失败不阻断 E2E 结果（页面已存在即合格），留痕即可
echo "✅ Step5 teardown 完成"
```

**硬阈值**: Notion PATCH 返回 200（非致命，归档失败仅 WARN，不阻断 E2E 结论）

---

## Risks

| # | 风险 | 缓解措施 |
|---|---|---|
| R1 | **NOTION_API_KEY 未设置**：E2E Step 1/2/5 的 Notion API GET/PATCH 全部失败，脚本目前无前置检查，失败信息不明确 | E2E 脚本首行加前置守卫：`[ -n "$NOTION_API_KEY" ] \|\| { echo "FAIL: NOTION_API_KEY 未设置"; exit 1; }`（已加入下方 E2E 脚本 set -e 之后） |
| R2 | **notion-push-sync 无 HTTP 端点**：`runNotionPushSync()` 是内部调度函数，无法通过 curl 直接触发；E2E Step 3 只能用 vitest 单测代替，无法走真实 tick 路径 | 设计决策已显式登记：Step 3 测试范围限于"属性过滤逻辑正确性"（单测 mock Notion 客户端，断言 pushJourneyStepLinks 发出的 properties 不含 schema 外的 Order 字段），不覆盖"tick 调度触发完整路径"；调度路径验收不在本 sprint scope |

---

## E2E 验收（final-e2e 跑 — target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e 脚本 — R4 Brain↔Notion 属性映射修复（local_api）
# 需要: Brain 运行在 localhost:5221，NOTION_API_KEY 已设置
set -e

# 前置检查（Risk R1 mitigation）：NOTION_API_KEY 未设置 → Step1/2/5 全失败，提前中止并给出明确错误
[ -n "$NOTION_API_KEY" ] || { echo "FAIL: NOTION_API_KEY 未设置，E2E 需要 Notion API 凭据"; exit 1; }

DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
BRAIN="http://localhost:5221"

echo "=== R4 E2E: Notion 属性映射降级验证 ==="

# ── Step 1: notes POST 带 initiative_id → 降级创建 ──

RESP=$(curl -sf -X POST "$BRAIN/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] R4-notes-init","content":"E2E test","type":"Note","initiative_id":"r4-test-init"}')
echo "Step1 RESP=$RESP"

echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: Step1 id缺失"; exit 1; }
echo "$RESP" | jq -e '.url | type == "string"' || { echo "FAIL: Step1 url缺失"; exit 1; }
echo "$RESP" | jq -e '.warnings | type == "array"' || { echo "FAIL: Step1 warnings字段缺失"; exit 1; }
echo "$RESP" | jq -e 'has("warning") | not' || { echo "FAIL: Step1 禁用字段warning出现"; exit 1; }

PAGE_ID=$(echo "$RESP" | jq -r '.id')

# Notion API GET 验证页面真实存在
NOTION_PAGE=$(curl -sf \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  "https://api.notion.com/v1/pages/$PAGE_ID")
echo "$NOTION_PAGE" | jq -e ".id == \"$PAGE_ID\"" || { echo "FAIL: Step1 Notion页面不存在"; exit 1; }
echo "✅ Step1 PASS"

# ── Step 2: notion/task POST → 正确属性名，不再 400 ──

RESP2=$(curl -sf -X POST "$BRAIN/api/brain/notion/task" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] R4-task","ws_number":1}')
echo "Step2 RESP2=$RESP2"

echo "$RESP2" | jq -e '.id | type == "string"' || { echo "FAIL: Step2 id缺失"; exit 1; }
echo "$RESP2" | jq -e '.url | type == "string"' || { echo "FAIL: Step2 url缺失"; exit 1; }
echo "$RESP2" | jq -e '[keys[]] | sort == ["id","title","url"]' || { echo "FAIL: Step2 keys不符"; exit 1; }
echo "$RESP2" | jq -e 'has("warnings") | not' || { echo "FAIL: Step2 不应有warnings"; exit 1; }

PAGE_ID2=$(echo "$RESP2" | jq -r '.id')
NOTION_PAGE2=$(curl -sf \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  "https://api.notion.com/v1/pages/$PAGE_ID2")
echo "$NOTION_PAGE2" | jq -e ".id == \"$PAGE_ID2\"" || { echo "FAIL: Step2 Notion页面不存在"; exit 1; }
echo "✅ Step2 PASS"

# ── Step 3: step_link 单测（属性降级，不硬编码 Order）──

cd /workspace && node --experimental-vm-modules node_modules/.bin/vitest run \
  sprints/06121511-notion-mapping-r4/tests/ \
  --reporter=verbose 2>&1 | tee /tmp/r4-e2e-step3.log
FAIL_COUNT=$(grep -c "FAIL\|✗" /tmp/r4-e2e-step3.log || true)
[ "$FAIL_COUNT" = "0" ] || { echo "FAIL: Step3 单测有失败"; cat /tmp/r4-e2e-step3.log; exit 1; }
echo "✅ Step3 PASS"

# ── Step 4: 负向 — initiative_id 不在 schema → 201 + warnings ──

CODE4=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BRAIN/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] R4-negative","content":"neg","initiative_id":"fake-r4-neg"}')
[ "$CODE4" = "201" ] || { echo "FAIL: Step4 期望201,实际$CODE4"; exit 1; }

RESP4B=$(curl -sf -X POST "$BRAIN/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] R4-negative-b","content":"neg b","initiative_id":"fake-r4-neg-b"}')
echo "$RESP4B" | jq -e '.warnings | length >= 1' || { echo "FAIL: Step4 warnings空（未记录降级属性）"; exit 1; }
echo "✅ Step4 PASS"

# ── Step 5: Teardown ──
for PID in "$PAGE_ID" "$PAGE_ID2"; do
  [ -z "$PID" ] && continue
  ARCHIVE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "https://api.notion.com/v1/pages/$PID" \
    -H "Authorization: Bearer $NOTION_API_KEY" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d '{"archived":true}')
  [ "$ARCHIVE_CODE" = "200" ] || echo "WARN: 归档 $PID 返回 $ARCHIVE_CODE（非致命，teardown）"
done
echo "✅ Step5 teardown 完成"

echo ""
echo "=== ✅ R4 E2E 全部通过 ==="
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| notes Initiative ID 降级 | `tests/notes-initiative-id-degrade.test.ts` | properties 不含 Initiative ID / warnings 数组包含跳过说明 | → FAIL（当前不查 schema，始终写 Initiative ID） |
| notion/task Title→Name 修复 | `tests/notion-task-title-fix.test.ts` | 使用 Name 而非 Title | → FAIL（当前硬编码 Title） |
| step_link Order 属性降级 | `tests/step-link-order-degrade.test.ts` | properties 不含 Order | → FAIL（当前硬编码 Order） |
| 降级全量覆盖 | `tests/notes-initiative-id-degrade.test.ts` | warnings 字段类型必须为 array | → FAIL |
