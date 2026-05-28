# Sprint Contract Draft (Round 3) — Harness Sprint 全链路可见性

## Golden Path

[harness-report 触发] → [3 个 Notion 端点写入] → [PrepPRD/PRD/Contract 归档] → [Dashboard 文档 tab 渲染] → [死任务自动重置] → [79710a5d 状态变 queued]

---

### Step 1: POST /api/brain/notes 端点注册 + Notion 新建页面

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条："POST /api/brain/notes 被调用 → 在 Notion AI Notes DB（`185c40c2-ba63-828c-973f-81a9c4582cd6`）新建页面，返回 `{id, url, title}`"

**可观测行为**: POST /api/brain/notes 接受 {title, content, type}，HTTP 201 返回 {id, url, title}（三字段均为 string，keys 完全等于 ["id","title","url"]）；缺必填字段返回 HTTP 400 + {error: string}；Notion API 不可达返回 HTTP 502；禁用字段 page_id/notion_id/result/data/payload 不出现

**验证命令**:
```bash
# 端点注册检查（404 = 路由未注册 = WS 未实现 = FAIL）
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"合同验证Note","content":"test content","type":"Note"}')
[ "$CODE" = "201" ] || [ "$CODE" = "502" ] || { echo "FAIL: 端点未注册 code=$CODE"; exit 1; }

if [ "$CODE" = "201" ]; then
  RESP=$(curl -sf -X POST localhost:5221/api/brain/notes \
    -H "Content-Type: application/json" \
    -d '{"title":"schema-check","content":"c","type":"Note"}')
  echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: id 缺失"; exit 1; }
  echo "$RESP" | jq -e '.url | type == "string"' || { echo "FAIL: url 缺失"; exit 1; }
  echo "$RESP" | jq -e '.title | type == "string"' || { echo "FAIL: title 缺失"; exit 1; }
  echo "$RESP" | jq -e 'keys == ["id","title","url"]' || { echo "FAIL: response keys 不匹配"; exit 1; }
  echo "$RESP" | jq -e 'has("page_id") | not' || { echo "FAIL: 禁用字段 page_id"; exit 1; }
  echo "$RESP" | jq -e 'has("notion_id") | not' || { echo "FAIL: 禁用字段 notion_id"; exit 1; }
  echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result"; exit 1; }
fi

# error path：缺 title → 400
CODE_ERR=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" -d '{"content":"c","type":"Note"}')
[ "$CODE_ERR" = "400" ] || { echo "FAIL: 缺 title 应返 400 实际 $CODE_ERR"; exit 1; }

echo "✅ Step 1 验证通过"
```

**硬阈值**: HTTP 201/502（非 404）；201 时 keys == ["id","title","url"]；400 for missing fields

---

### Step 2: POST /api/brain/notion/project 自动加 [Sprint] 前缀 + 保留原始 title

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条："POST /api/brain/notion/project 被调用 → 标题自动加 `[Sprint]` 前缀，写入 Notion Projects DB"；PRD Response Schema："title 必须带 [Sprint] 前缀"且格式为 `"[Sprint] <原始title>"`

**可观测行为**: 传入 title="MyRun" → 返回 title="[Sprint] MyRun"（精确等于，原始 title 完整保留）；禁用字段 page_id/notion_id/result/data 不出现；keys 完全等于 ["id","title","url"]

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notion/project \
  -H "Content-Type: application/json" \
  -d '{"title":"合同验证Project","status":"Done"}')
[ "$CODE" = "201" ] || [ "$CODE" = "502" ] || { echo "FAIL: /notion/project 未注册 code=$CODE"; exit 1; }

if [ "$CODE" = "201" ]; then
  RESP=$(curl -sf -X POST localhost:5221/api/brain/notion/project \
    -H "Content-Type: application/json" \
    -d '{"title":"MyRun"}')
  # [Sprint] 前缀存在
  echo "$RESP" | jq -e '.title | startswith("[Sprint]")' || { echo "FAIL: [Sprint] 前缀缺失"; exit 1; }
  # ★ Round 3 Fix — 精确等值验证，防 generator 只返回 "[Sprint]" 或漏掉原始 title
  echo "$RESP" | jq -e '.title == "[Sprint] MyRun"' || { echo "FAIL: title 未精确匹配 [Sprint] MyRun（原始 title 未保留）"; exit 1; }
  echo "$RESP" | jq -e 'keys == ["id","title","url"]' || { echo "FAIL: /notion/project response keys 不匹配（多余字段）"; exit 1; }
fi
echo "✅ Step 2 验证通过"
```

**硬阈值**: title 精确等于 `"[Sprint] MyRun"`（不能只是 `"[Sprint]"`）；非 404；禁用字段不出现

---

### Step 3: POST /api/brain/notion/task 自动推断 [WS{n}] 前缀（精确匹配）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条："POST /api/brain/notion/task 被调用 → 标题自动加 `[WSn]` 前缀（n 从 ws_number 或 title 推断）"

**可观测行为**: 传入 {title:"实现功能X", ws_number:2} → 返回 title="[WS2] 实现功能X"（精确等于，n=ws_number，原始 title 完整保留）；title 已含 WS 前缀时不重复添加；keys 完全等于 ["id","title","url"]

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notion/task \
  -H "Content-Type: application/json" \
  -d '{"title":"实现功能X","ws_number":2}')
[ "$CODE" = "201" ] || [ "$CODE" = "502" ] || { echo "FAIL: /notion/task 未注册 code=$CODE"; exit 1; }

if [ "$CODE" = "201" ]; then
  RESP=$(curl -sf -X POST localhost:5221/api/brain/notion/task \
    -H "Content-Type: application/json" \
    -d '{"title":"实现功能X","ws_number":2}')
  echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: id 缺失"; exit 1; }
  echo "$RESP" | jq -e '.url | type == "string"' || { echo "FAIL: url 缺失"; exit 1; }
  # ★ Round 3 Fix — 精确匹配 [WS2]（不是宽松的 [WS]），防 generator 返回 [WSnone]
  echo "$RESP" | jq -e '.title | startswith("[WS2]")' || { echo "FAIL: title 未以 [WS2] 开头（ws_number=2 → 必须 [WS2]，[WSnone]/[WS] 不合规）"; exit 1; }
  # ★ Round 3 Fix — 等值验证：原始 title 必须完整保留
  echo "$RESP" | jq -e '.title == "[WS2] 实现功能X"' || { echo "FAIL: title 未精确匹配 [WS2] 实现功能X（原始 title 未保留）"; exit 1; }
  echo "$RESP" | jq -e 'keys == ["id","title","url"]' || { echo "FAIL: /notion/task response keys 不匹配（多余字段）"; exit 1; }
  echo "$RESP" | jq -e 'has("page_id") | not' || { echo "FAIL: 禁用字段 page_id"; exit 1; }
fi
echo "✅ Step 3 验证通过"
```

**硬阈值**: title 精确等于 `"[WS2] 实现功能X"`（ws_number=2 时）；非 404；禁用字段不出现

---

### Step 4: harness-report Step 3.5 — PrepPRD/SprintPRD/Contract 归档到 Notion

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条："harness-report Step 3.5 逐个读取 sprint 目录下 prep-prd.md / sprint-prd.md / contract-draft.md，POST 到 /api/brain/notes"

**可观测行为**: SKILL.md 中 Step 3.5 区间存在；三种 type 均覆盖（PrepPRD/SprintPRD/Contract）；POST payload 使用 content 字段（不是 body）；type 使用 $DOC_TYPE 变量；含 initiative_id 字段

**验证命令**:
```bash
# Step 3.5 存在性
grep -q "Step 3.5" packages/workflows/skills/harness-report/SKILL.md || \
  { echo "FAIL: Step 3.5 不存在于 SKILL.md"; exit 1; }

# 三种类型覆盖 + content 字段
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-report/SKILL.md','utf8');
  const s=c.split('Step 3.5')[1]?.split('Step 4')[0]||'';
  ['PrepPRD','SprintPRD','Contract'].forEach(t=>{if(!s.includes(t)){console.error('FAIL: '+t+' 缺失');process.exit(1)}});
  if(s.includes('\"body\"')){console.error('FAIL: body 字段应改为 content');process.exit(1)}
  if(!s.includes('\"content\"')){console.error('FAIL: content 字段缺失');process.exit(1)}
  console.log('OK')"

echo "✅ Step 4 验证通过"
```

**硬阈值**: Step 3.5 存在；PrepPRD/SprintPRD/Contract 均出现；content 字段而非 body

---

### Step 5: GET /api/brain/harness/sprint-docs 返回 4 文档结构

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条："GET /api/brain/harness/sprint-docs?sprint_dir=... 返回 4 个文档的 markdown 内容"；PRD Response Schema："docs 对象的 keys 完全等于 ['prep_prd', 'sprint_prd', 'contract', 'harness_report']"

**可观测行为**: 返回 {sprint_dir: string, docs: {prep_prd, sprint_prd, contract, harness_report}}；docs keys 完全等于这 4 个（下划线命名）；文件不存在时字段值为 null；缺 sprint_dir 参数返回 400

**验证命令**:
```bash
TEST_DIR="sprints/cecelia-sprint-visibility-0528"

RESP=$(curl -sf "localhost:5221/api/brain/harness/sprint-docs?sprint_dir=${TEST_DIR}") || \
  { echo "FAIL: sprint-docs 端点未注册"; exit 1; }

echo "$RESP" | jq -e '.sprint_dir | type == "string"' || { echo "FAIL: sprint_dir 缺失"; exit 1; }
echo "$RESP" | jq -e '.docs | type == "object"' || { echo "FAIL: docs 缺失"; exit 1; }

# docs keys 完全等于（sorted）
echo "$RESP" | jq -e '.docs | keys == ["contract","harness_report","prep_prd","sprint_prd"]' || \
  { echo "FAIL: docs keys 不匹配（多/少/camelCase）"; exit 1; }

# 现有文件对应字段为 string
echo "$RESP" | jq -e '.docs.sprint_prd | type == "string"' || \
  { echo "FAIL: sprint_prd 应为 string（文件存在）"; exit 1; }

# 不存在文件字段为 null
RESP2=$(curl -sf "localhost:5221/api/brain/harness/sprint-docs?sprint_dir=sprints/nonexistent-xyz")
echo "$RESP2" | jq -e '.docs.prep_prd == null' || { echo "FAIL: 不存在文件应为 null"; exit 1; }

# 禁用字段名不出现
echo "$RESP" | jq -e 'has("prepPrd") | not' || { echo "FAIL: 禁用字段 prepPrd"; exit 1; }
echo "$RESP" | jq -e 'has("sprintPrd") | not' || { echo "FAIL: 禁用字段 sprintPrd"; exit 1; }

# 缺 sprint_dir → 400
CODE400=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/sprint-docs")
[ "$CODE400" = "400" ] || { echo "FAIL: 缺 sprint_dir 应返 400 实际 $CODE400"; exit 1; }

echo "✅ Step 5 验证通过"
```

**硬阈值**: docs keys == ["contract","harness_report","prep_prd","sprint_prd"]；缺参数 400

---

### Step 6: HarnessDetailPage 新增文档 tab（Playwright UI 验证）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 条："HarnessDetailPage 出现'文档'tab，点击后调用 sprint-docs 端点，渲染 markdown"

**可观测行为**: HarnessDetailPage.tsx 含 data-testid='docs-tab' 按钮；点击后渲染 docs-tab-content；容器内 markdown 非空

**验证命令**:
```bash
# ARTIFACT 验证（WS 未实现时此命令 FAIL）
node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');
  if(!c.includes('docs-tab')){console.error('FAIL: docs-tab 缺失');process.exit(1)}
  if(!c.includes('docs-tab-content')){console.error('FAIL: docs-tab-content 缺失');process.exit(1)}
  if(!c.includes('sprint-docs')){console.error('FAIL: sprint-docs API 调用缺失');process.exit(1)}
  console.log('OK')"
echo "✅ Step 6 代码验证通过（UI 验证由 final-e2e Playwright 完成）"
```

**硬阈值**: 含 docs-tab、docs-tab-content、sprint-docs 三个字符串；Playwright E2E 见下方

---

### Step 7: tick-runner.js 死任务自动重置（execution_attempts=0 且超 10 分钟）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 7、8 条："tick-runner.js 扫描 execution_attempts=0 且卡死 ≥10 分钟的任务，自动 reset 为 queued"；"79710a5d 任务因上述逻辑被重置为 queued"

**可观测行为**: tick 执行后 execution_attempts=0 且 updated_at 超 10 分钟的 in_progress 任务状态变 queued；79710a5d 自动被重置

**验证命令**:
```bash
# ★ Round 3 Fix — $DB 变量定义，防 evaluator 环境无 $DB 时掩盖真正 FAIL
DB="${DATABASE_URL:-postgresql://localhost:5432/cecelia}"

# ARTIFACT 验证（WS 未实现 → execution_attempts 字符串不存在 → FAIL）
node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');
  if(!c.includes('execution_attempts')){console.error('FAIL: execution_attempts 逻辑缺失');process.exit(1)}
  const idx=c.indexOf('execution_attempts');const seg=c.slice(Math.max(0,idx-100),idx+2000);
  if(!seg.includes('10 minute')&&!seg.includes('INTERVAL')&&!seg.includes('interval')){
    console.error('FAIL: 10分钟时间判定缺失');process.exit(1)}
  console.log('OK')"

# 运行时验证：插入死任务，触发 tick，检查重置
TEST_TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, execution_attempts, updated_at) VALUES ('dead_task_contract_test', 'in_progress', 0, NOW() - INTERVAL '15 minutes') RETURNING id" | tr -d ' \n')
echo "插入测试任务 $TEST_TASK_ID"
curl -sf -X POST localhost:5221/api/brain/tick/execute 2>/dev/null || sleep 3
MAX=30; for i in $(seq 1 $MAX); do
  S=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$TEST_TASK_ID'" | tr -d ' \n')
  [ "$S" = "queued" ] && break
  [ "$i" = "$MAX" ] && { psql "$DB" -c "DELETE FROM tasks WHERE id='$TEST_TASK_ID'" >/dev/null 2>&1; echo "FAIL: 死任务未被重置 status=$S"; exit 1; }
  sleep 1
done
psql "$DB" -c "DELETE FROM tasks WHERE id='$TEST_TASK_ID'" >/dev/null 2>&1
echo "OK reset in ${i}s"

# 79710a5d 状态检查
STATUS_79=$(curl -sf localhost:5221/api/brain/tasks/79710a5d 2>/dev/null | jq -r '.status // "not_found"')
[ "$STATUS_79" = "queued" ] || [ "$STATUS_79" = "completed" ] || [ "$STATUS_79" = "not_found" ] || \
  { echo "FAIL: 79710a5d status=$STATUS_79（期望 queued 或 completed/not_found）"; exit 1; }
echo "✅ Step 7 验证通过 79710a5d=$STATUS_79"
```

**硬阈值**: 死任务 30s 内重置为 queued；79710a5d status 为 queued/completed/not_found

---

## E2E 验收（final-e2e — target_environment: mac_web）

**journey_type**: user_facing
**target_environment**: mac_web（Cecelia Dashboard，localhost:5174，本机 Playwright）

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行）
const { chromium, expect } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. 导航到 Harness 详情页（需要有效 initiative_id）
  const initiativeId = process.env.E2E_INITIATIVE_ID || '';
  if (!initiativeId) {
    console.warn('SKIP: E2E_INITIATIVE_ID 未设置，跳过 UI 验证');
    await browser.close();
    process.exit(0);
  }

  await page.goto(`http://localhost:5174/harness/${initiativeId}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/ws4-01-initial.png' });

  // 2. 点击文档 tab
  const docsTab = page.locator('[data-testid="docs-tab"]');
  await expect(docsTab).toBeVisible({ timeout: 10000 });
  await docsTab.click();
  await page.screenshot({ path: 'screenshots/ws4-02-action.png' });

  // 3. 验证文档内容渲染
  const docsContent = page.locator('[data-testid="docs-tab-content"]');
  await expect(docsContent).toBeVisible({ timeout: 10000 });
  const text = await docsContent.textContent();
  if (!text || text.trim().length === 0) {
    console.error('FAIL: docs-tab-content 内容为空');
    process.exit(1);
  }
  await page.screenshot({ path: 'screenshots/ws4-03-result.png' });

  // 4. 后端状态交叉验证
  const apiResp = await page.request.get(
    'http://localhost:5221/api/brain/harness/sprint-docs?sprint_dir=sprints/cecelia-sprint-visibility-0528'
  );
  const data = await apiResp.json();
  if (!data.docs || typeof data.docs.sprint_prd !== 'string') {
    console.error('FAIL: Brain sprint-docs 返回异常', data);
    process.exit(1);
  }

  await context.close();
  await browser.close();
  console.log('✅ Golden Path UI 验证通过');
})();
```

**BEHAVIOR:E2E 截图 DoD**:
- `ws4-01-initial.png`：HarnessDetailPage 初始状态，日志 tab 可见
- `ws4-02-action.png`：点击文档 tab 后，docs-tab-content 出现
- `ws4-03-result.png`：markdown 内容渲染完成，文本非空

---

## Workstreams

workstream_count: 5

### Workstream 1: Brain Notion API 端点（notes.js 新建）
**范围**: 新建 packages/brain/src/routes/notes.js + 在 server.js 注册；实现 POST /notes、POST /notion/project、POST /notion/task
**大小**: M（~150 行净增，2 文件）
**依赖**: 无

### Workstream 2: harness-report SKILL.md Step 3.5 修正
**范围**: 修正 packages/workflows/skills/harness-report/SKILL.md Step 3.5 字段名（content/SprintPRD/$DOC_TYPE/initiative_id）
**大小**: S（~20 行改动，1 文件）
**依赖**: Workstream 1

### Workstream 3: GET /harness/sprint-docs 端点
**范围**: packages/brain/src/routes/harness.js 新增 GET /sprint-docs?sprint_dir=...
**大小**: S（~80 行净增，1 文件）
**依赖**: Workstream 2

### Workstream 4: HarnessDetailPage 文档 tab
**范围**: apps/dashboard/src/pages/harness/HarnessDetailPage.tsx 新增 docs-tab + markdown 渲染
**大小**: M（~100 行净增，1-2 文件）
**依赖**: Workstream 3

### Workstream 5: tick-runner.js 死任务重置
**范围**: packages/brain/src/tick-runner.js 新增 execution_attempts=0 扫描 + 批量重置逻辑
**大小**: S（~60 行净增，1 文件）
**依赖**: Workstream 4

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/notion-endpoints.test.ts` | 端点已注册/schema/精确等于/error: string | routes/notes.js 不存在 → N failures |
| WS2 | `tests/ws2/skill-step35.test.ts` | Step 3.5/SprintPRD/content 字段/initiative_id | SKILL.md 未修改 → N failures |
| WS3 | `tests/ws3/sprint-docs.test.ts` | sprint_dir/docs keys/null/400 | 端点未实现 → N failures |
| WS4 | `tests/ws4/harness-detail-docs-tab.test.tsx` | docs-tab 组件 + API 联动 | HarnessDetailPage 无 docs-tab → N failures |
| WS5 | `tests/ws5/dead-task-reset.test.ts` | execution_attempts/10 分钟/queued/claimed_by | tick-runner.js 无此逻辑 → N failures |
