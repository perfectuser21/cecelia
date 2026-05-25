# Sprint Contract Draft (Round 3)

## Golden Path
[Dashboard /pipeline 页] → [点击 initiative card] → [/detail API 组装完整数据] → [面板渲染：PRD 全文 + 步骤时间线 + 截图 section]

---

### Step 1: SKILL.md mac_web 合约模板注入截图 DoD 条目
**来源**: `[FROM_PRD]` — PRD 范围限定 WS1 明确要求"SKILL.md mac_web 合约模板末尾注入 `[BEHAVIOR:E2E:screenshot]` 截图 DoD 条目，格式：evaluator 验收后截图存 `~/claude-output/harness-screenshots/<ws_id>-<step>.png`"

**可观测行为**: 新合同起草时 mac_web 合约模板自动包含截图规格，future proposer 起草 user_facing sprint 合同时截图 DoD 条目自动出现

**验证命令**:
```bash
grep -c '\[BEHAVIOR:E2E:screenshot\]' packages/workflows/skills/harness-contract-proposer/SKILL.md
# 期望：输出 ≥ 1
grep 'harness-screenshots' packages/workflows/skills/harness-contract-proposer/SKILL.md | head -3
# 期望：至少 1 行含 harness-screenshots 路径
```

**硬阈值**: grep count ≥ 1，文件在 mac_web 模板区块内含 `~/claude-output/harness-screenshots/` 目标路径

---

### Step 2: Brain API 新增 GET /api/brain/harness/initiative/:id/detail 端点
**来源**: `[FROM_PRD]` — PRD Response Schema 明确定义 6 个顶层字段（initiative_id/prd_content/contract_content/gan_rounds/step_timing/screenshot_urls）+ 禁用字段列表（含 content）+ 404 error 格式

**可观测行为**: 存在的 initiative 调用 GET /api/brain/harness/initiative/:id/detail 返回 HTTP 200，JSON 包含 6 个顶层字段，顶层 keys 完全等于 `["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]`（jq 字母序）

**验证命令**:
```bash
# $DB fallback（evaluator 运行前请 export DB=... 或依赖此默认值）
DB=${DB:-postgresql://localhost/cecelia}

# 在 Brain 真实 DB 插入测试数据
TEST_ID=$(psql $DB -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('harness_initiative', 'completed', 'test-detail-contract-e2e', '{}'::jsonb) RETURNING id::text" | tr -d ' \n')

# 验证端点返回 200（端点未注册时 Brain 通用 404 handler 返 404 — 真红）
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$TEST_ID/detail") || { echo "FAIL: 端点未返回 200（路由未注册或 initiative 不存在）"; psql $DB -c "DELETE FROM tasks WHERE id='$TEST_ID'::uuid" > /dev/null; exit 1; }

# 字段类型验证
echo "$RESP" | jq -e '.initiative_id | type == "string"' || { echo "FAIL: initiative_id not string"; exit 1; }
echo "$RESP" | jq -e '.step_timing | type == "array"' || { echo "FAIL: step_timing not array"; exit 1; }
echo "$RESP" | jq -e '.screenshot_urls | type == "array"' || { echo "FAIL: screenshot_urls not array"; exit 1; }

# Schema 完整性（jq keys 字母升序）
echo "$RESP" | jq -e 'keys == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]' || { echo "FAIL: schema 顶层 keys 不完整"; exit 1; }

# 禁用字段反向检查（含 content — PRD 明确禁用）
echo "$RESP" | jq -e 'has("steps") | not' || { echo "FAIL: 禁用字段 steps 出现"; exit 1; }
echo "$RESP" | jq -e 'has("timeline") | not' || { echo "FAIL: 禁用字段 timeline 出现"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result 出现"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 禁用字段 data 出现"; exit 1; }
echo "$RESP" | jq -e 'has("details") | not' || { echo "FAIL: 禁用字段 details 出现"; exit 1; }
echo "$RESP" | jq -e 'has("info") | not' || { echo "FAIL: 禁用字段 info 出现"; exit 1; }
echo "$RESP" | jq -e 'has("content") | not' || { echo "FAIL: 禁用字段 content 出现"; exit 1; }
echo "$RESP" | jq -e 'has("report") | not' || { echo "FAIL: 禁用字段 report 出现"; exit 1; }

# 清理
psql $DB -c "DELETE FROM tasks WHERE id='$TEST_ID'::uuid" > /dev/null
echo "✅ WS2 /detail 端点 schema 验证通过"
```

**硬阈值**: HTTP 200，initiative_id(string)，step_timing/screenshot_urls(array)，schema 6 字段完整，禁用字段不存在

---

### Step 3: 404 error path 验证
**来源**: `[FROM_PRD]` — PRD Error response 明确定义：initiative 不存在 → HTTP 404 + `{"error": "<string>"}`

**可观测行为**: 随机 UUID 调用 /detail → 返回 HTTP 404，body 含 `error` 字段（string）

**验证命令**:
```bash
FAKE_ID="00000000-0000-0000-0000-000000000099"
CODE=$(curl -s -o /tmp/detail-404.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/$FAKE_ID/detail")
[ "$CODE" = "404" ] || { echo "FAIL: 应返 404，实际 $CODE"; exit 1; }
cat /tmp/detail-404.json | jq -e '.error | type == "string"' || { echo "FAIL: 404 body 无 error 字段或不是 string"; exit 1; }
echo "✅ 404 error path 通过"
```

**硬阈值**: HTTP 404，body.error 为 string 类型

---

### Step 4: reportNode 增强 — step_timing / ws_issues / ws_costs 写入 DB
**来源**: `[FROM_PRD]` — PRD reportNode schema 明确规定三字段 + 禁用字段列表（timings/timing/issues/costs/breakdown）+ 存储模型 `tasks.result->'report_content'`

**可观测行为**: harness pipeline 完成后，initiative `tasks.result->'report_content'` JSONB 包含 step_timing/ws_issues/ws_costs 三字段；禁用字段不作为 reportContent 顶层键

**验证命令**:
```bash
# ARTIFACT 层：源码含三字段（实现前 FAIL — 真红）
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
const fields = ['step_timing', 'ws_issues', 'ws_costs'];
fields.forEach(f => {
  if (!c.includes(f)) { console.error('FAIL: reportNode 缺字段', f); process.exit(1); }
});
console.log('OK: 三字段存在');
"

# ARTIFACT 层：report_content 键写入
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
if (!c.includes('report_content')) { console.error('FAIL: 缺 report_content 写入逻辑'); process.exit(1); }
console.log('OK: report_content 写入存在');
"

# ARTIFACT 层：禁用字段精确键名反向检查（不误杀 ws_issues/ws_costs/step_timing 合法字段）
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
const start = c.indexOf('reportNode');
const slice = c.slice(start, start + 3000);
const banned = ['timings', 'timing', 'issues', 'costs', 'breakdown'];
banned.forEach(f => {
  // 精确键名匹配：要求禁用名前面紧贴引号（防止 ws_issues/ws_costs/step_timing 等合法字段误触）
  const rx = new RegExp('[\"\\x27]' + f + '[\"\\x27]\\s*:');
  if (rx.test(slice)) {
    console.error('FAIL: 禁用字段作为独立键名出现在 reportNode 上下文:', f); process.exit(1);
  }
});
console.log('OK: 禁用字段未出现');
"

echo "✅ WS4 reportNode 字段验证通过"
```

**硬阈值**: 三字段全在 reportNode 代码中，report_content 写入存在，禁用字段不在 reportNode 上下文键名（精确匹配，不误杀带前缀合法字段）

---

### Step 5: E2E 截图链路验证测试文件
**来源**: `[FROM_PRD]` — PRD WS5 明确要求写 `sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts`，验证截图链路

**可观测行为**: 测试文件存在，含 harness-screenshots 目录断言；/detail 端点可访问（200 或 404，非 500）；截图目录结构可创建

**验证命令**:
```bash
# 文件存在且含关键断言（文件不存在时 FAIL — 真红）
node -e "
const c = require('fs').readFileSync('sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts', 'utf8');
if (!c.includes('harness-screenshots')) { console.error('FAIL: 缺 harness-screenshots 断言'); process.exit(1); }
if (!c.includes('/api/brain/harness/initiative')) { console.error('FAIL: 缺 /detail 端点检查'); process.exit(1); }
console.log('OK: 文件内容验证通过');
"
echo "✅ WS5 E2E 测试文件验证通过"
```

**硬阈值**: 文件存在，含 harness-screenshots 和 /api/brain/harness/initiative 引用

---

## E2E 验收（target_environment = mac_web，final-e2e Playwright，localhost:5174）

**journey_type**: user_facing
**target_environment**: mac_web

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行，localhost:5174）
const { chromium, expect } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. 导航到 Dashboard /pipeline 页
  await page.goto('http://localhost:5174/pipeline');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-pipeline-list.png' });

  // 2. 验证 initiative card 列表可见
  await expect(page.locator('[data-testid="initiative-card"]').first()).toBeVisible({ timeout: 10000 });

  // 3. 点击第一个 initiative card
  await page.locator('[data-testid="initiative-card"]').first().click();
  await page.screenshot({ path: 'screenshots/02-card-click.png' });

  // 4. 断言详情面板展开（Initiative 侧栏/抽屉）
  await expect(page.locator('[data-testid="initiative-detail-panel"]')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/03-detail-panel.png' });

  // 5. 断言 PRD 内容区块可见
  await expect(page.locator('[data-testid="initiative-prd-content"]')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'screenshots/04-prd-content.png' });

  // 6. 断言步骤时间线可见
  await expect(page.locator('[data-testid="initiative-step-timeline"]')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'screenshots/05-timeline.png' });

  // 7. 交叉验证后端 /detail API（防止前端撒谎）
  const initiativeId = await page.locator('[data-testid="initiative-card"]').first().getAttribute('data-initiative-id');
  if (initiativeId) {
    const apiResp = await page.request.get(`http://localhost:5221/api/brain/harness/initiative/${initiativeId}/detail`);
    expect(apiResp.ok()).toBe(true);
    const data = await apiResp.json();
    if (typeof data.initiative_id !== 'string') {
      console.error('FAIL: /detail API initiative_id 不是 string', data);
      process.exit(1);
    }
    if (!Array.isArray(data.step_timing)) {
      console.error('FAIL: /detail API step_timing 不是 array', data);
      process.exit(1);
    }
    if (!Array.isArray(data.screenshot_urls)) {
      console.error('FAIL: /detail API screenshot_urls 不是 array', data);
      process.exit(1);
    }
    // Schema 完整性
    const keys = Object.keys(data).sort();
    const expected = ['contract_content','gan_rounds','initiative_id','prd_content','screenshot_urls','step_timing'];
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      console.error('FAIL: /detail API schema keys 不匹配', keys);
      process.exit(1);
    }
  }

  await context.close();
  await browser.close();
  console.log('✅ Golden Path UI + API 验证通过');
})();
```

**PASS 标准**: Playwright exit 0，5 张截图均与期望描述一致，/detail API schema 验证通过
**FAIL 标准**: initiative-card/initiative-detail-panel/initiative-prd-content/initiative-step-timeline 任一 toBeVisible 超时，或 /detail API schema 不符

---

## Workstreams

workstream_count: 4

### Workstream 1: SKILL.md 截图 DoD 注入
**范围**: `packages/workflows/skills/harness-contract-proposer/SKILL.md` — mac_web 合约模板区块末尾添加 `[BEHAVIOR:E2E:screenshot]` 截图 DoD 条目（含路径格式 `~/claude-output/harness-screenshots/<ws_id>-<step>.png`）
**大小**: S（约 30 行注入，1 文件）
**依赖**: 无

---

### Workstream 2: Brain GET /detail 端点
**范围**: `packages/brain/src/routes/harness.js`（新增 GET /initiative/:id/detail 路由）+ `packages/brain/src/__tests__/harness-detail.test.js`（新建单测，含 mock pool）
**大小**: M（约 120-150 行净增，2 文件）
**依赖**: Workstream 1 完成后

---

### Workstream 4: reportNode 增强
**范围**: `packages/brain/src/workflows/harness-initiative.graph.js` — reportNode 函数新增 step_timing/ws_issues/ws_costs 三字段写入 `tasks.result->'report_content'` JSONB；禁止 timings/timing/issues/costs/breakdown
**大小**: S（约 80 行净增，1 文件）
**依赖**: Workstream 2 完成后

---

### Workstream 5: E2E 截图链路验证
**范围**: `sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts`（新建，约 80 行）
**大小**: S（1 文件）
**依赖**: Workstream 4 完成后

---

## Workstreams 切分验证

| WS | 预期 LoC | 文件数 | 大小 |
|---|---|---|---|
| ws1 | ~30 行 | 1 | S ✓ |
| ws2 | ~150 行 | 2 | M ✓ |
| ws4 | ~80 行 | 1 | S ✓ |
| ws5 | ~80 行 | 1 | S ✓ |
| 合计 | ~340 行 | 5 | < 限制 ✓ |

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/` — 无独立 test file（grep 验证） | SKILL.md 截图条目存在 | grep 无 → exit 1 |
| WS2 | `packages/brain/src/__tests__/harness-detail.test.js` | /detail 端点 200+schema、404、禁用字段 | 端点未注册 → curl 返 404（对真实 initiative）→ test FAIL |
| WS4 | `tests/ws4/` — 无独立 test file（src grep 验证） | reportNode 三字段存在 | grep 无 → exit 1 |
| WS5 | `tests/ws5/e2e-screenshot-chain.test.ts` | 文件存在含关键断言 | 文件不存在 → accessSync FAIL |

---

## GAN 来源标注汇总

| 类型 | Golden Path Step | 来源说明 |
|---|---|---|
| FROM_PRD | Step 1: SKILL.md 注入 | PRD WS1 范围限定直接描述 |
| FROM_PRD | Step 2: /detail 端点 + schema | PRD Response Schema 段逐字定义 |
| FROM_PRD | Step 3: 404 error path | PRD Error response 明确规定 |
| FROM_PRD | Step 4: reportNode 三字段 | PRD reportNode 写入 schema 明确规定 |
| FROM_PRD | Step 5: E2E 测试文件 | PRD WS5 范围限定明确要求 |
| AI_ADDED | Step 2 中 `psql $DB DELETE FROM tasks WHERE id=TEST_ID` 清理步骤 | 防止测试数据污染 DB，避免后续验证利用历史数据假绿 |
| AI_ADDED | jq 字母序 keys 完全匹配 | PRD 写的是逻辑集合，jq keys 输出字母序，需显式换算防止顺序不一致假绿 |
| AI_ADDED | 禁用字段逐一反向 jq -e `has("X") | not` | 防止 generator 用禁用字段名实现并通过松散断言 |
