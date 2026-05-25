# Sprint Contract Draft (Round 2)

## Golden Path

[运维人员打开 /pipeline 页] → [点击 initiative card] → [调 GET /api/brain/harness/initiative/:id/detail] → [面板渲染 PRD/合约/时间线/截图]

---

### Step 1: SKILL.md mac_web 合约模板自动注入截图 DoD 条目

**来源**: `[FROM_PRD]` — PRD "WS1 — proposer skill 截图 DoD 自动注入" 段直接定义：每个 WS 的 contract-dod 末尾自动包含 `[BEHAVIOR:E2E:screenshot]` 条目

**可观测行为**: `packages/workflows/skills/harness-contract-proposer/SKILL.md` 的 mac_web 合约模板包含 `[BEHAVIOR:E2E:screenshot]` 截图条目，格式为 `evaluator 验收后截图存 screenshots/<ws_id>-<step>.png，复制到 ~/claude-output/harness-screenshots/`

**验证命令**:
```bash
grep -c '\[BEHAVIOR:E2E:screenshot\]' packages/workflows/skills/harness-contract-proposer/SKILL.md
# 期望：≥ 1（截图条目存在）
```

**硬阈值**: grep 返回 ≥ 1，exit 0

---

### Step 2: Brain 新增 GET /api/brain/harness/initiative/:id/detail 端点

**来源**: `[FROM_PRD]` — PRD "WS2 — Brain API /detail 端点" + "Response Schema" 段直接定义了端点 URL 及全部字段

**可观测行为**: 调 `GET /api/brain/harness/initiative/:id/detail` 返回 HTTP 200，body 含 `initiative_id`、`prd_content`、`contract_content`、`gan_rounds`、`step_timing`、`screenshot_urls` 六个字段，无禁用字段（`steps`/`phases`/`timeline`/`data`/`result`/`details`/`info`）

**验证命令**:
```bash
TEST_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='harness_initiative' LIMIT 1" | tr -d ' ')
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail")

# initiative_id（必填 string）
echo "$RESP" | jq -e '.initiative_id | type == "string"' || { echo "FAIL: initiative_id 非 string"; exit 1; }

# prd_content / contract_content（string 或 null）
echo "$RESP" | jq -e '.prd_content == null or (.prd_content | type == "string")' || { echo "FAIL: prd_content 类型错误"; exit 1; }
echo "$RESP" | jq -e '.contract_content == null or (.contract_content | type == "string")' || { echo "FAIL: contract_content 类型错误"; exit 1; }

# gan_rounds（number 或 null）
echo "$RESP" | jq -e '.gan_rounds == null or (.gan_rounds | type == "number")' || { echo "FAIL: gan_rounds 类型错误"; exit 1; }

# step_timing / screenshot_urls（array）
echo "$RESP" | jq -e '.step_timing | type == "array"'     || { echo "FAIL: step_timing 非 array"; exit 1; }
echo "$RESP" | jq -e '.screenshot_urls | type == "array"' || { echo "FAIL: screenshot_urls 非 array"; exit 1; }

# 禁用字段反向验证
echo "$RESP" | jq -e 'has("steps") | not'    || { echo "FAIL: 禁用字段 steps"; exit 1; }
echo "$RESP" | jq -e 'has("timeline") | not' || { echo "FAIL: 禁用字段 timeline"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not'   || { echo "FAIL: 禁用字段 result"; exit 1; }

echo "✅ Step 2 验证通过"
```

**硬阈值**: 所有 jq -e 断言 exit 0；HTTP 状态 200

---

### Step 3: /detail 端点 Response Schema 字段完整性

**来源**: `[FROM_PRD]` — PRD "Response Schema" 段定义顶层 keys 集合为 `["initiative_id","prd_content","contract_content","gan_rounds","step_timing","screenshot_urls"]`

**可观测行为**: 响应 body 顶层 keys 完全等于 PRD 定义集合，不多不少

**验证命令**:
```bash
TEST_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='harness_initiative' LIMIT 1" | tr -d ' ')
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail")
echo "$RESP" | jq -e '[keys[] | .] | sort == ["contract_content","gan_rounds","initiative_id","prd_content","screenshot_urls","step_timing"]' \
  || { echo "FAIL: keys 不完整或含多余禁用字段"; exit 1; }
echo "✅ Step 3 keys 完整性验证通过"
```

**硬阈值**: jq -e exit 0

---

### Step 4: step_timing 从 task_events 推算（含边界）

**来源**: `[FROM_PRD]` — PRD "step_timing (array): 从 task_events WHERE event_type='graph_node_update'" 直接定义数据来源和边界：无 task_events → 返回 `[]`

**可观测行为**: initiative 有 graph_node_update 事件时，step_timing 数组非空，每条含 `node`/`started_at`/`ended_at`/`duration_ms` 字段；无事件时返回 `[]`

**验证命令**:
```bash
TEST_ID=$(psql $DB -t -c "
  SELECT DISTINCT task_id FROM task_events 
  WHERE event_type='graph_node_update' 
  AND task_id IN (SELECT id FROM tasks WHERE task_type='harness_initiative')
  LIMIT 1" | tr -d ' ')

if [ -n "$TEST_ID" ]; then
  RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail")
  echo "$RESP" | jq -e '.step_timing | length > 0' || { echo "FAIL: step_timing 应非空"; exit 1; }
  echo "$RESP" | jq -e '.step_timing[0] | has("node") and has("started_at") and has("ended_at") and has("duration_ms")' \
    || { echo "FAIL: step_timing 元素缺字段"; exit 1; }
  echo "✅ Step 4 step_timing 字段验证通过"
else
  echo "SKIP: 无含 graph_node_update 的 initiative，测 empty 边界"
  EMPTY_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='harness_initiative' LIMIT 1" | tr -d ' ')
  RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${EMPTY_ID}/detail")
  echo "$RESP" | jq -e '.step_timing == []' || { echo "FAIL: 空 step_timing 应为 []"; exit 1; }
  echo "✅ Step 4 边界验证通过"
fi
```

**硬阈值**: step_timing 元素含 `node`/`started_at`/`ended_at`/`duration_ms`；无事件时返回 `[]`

---

### Step 5: /detail 错误路径 — initiative not found → 404 + error 字段

**来源**: `[FROM_PRD]` — PRD Error 段直接定义：HTTP 404 + `{"error": "initiative not found"}`；禁用字段同上

**可观测行为**: 传入不存在 UUID 返回 HTTP 404，body 含 `error` string 字段

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail")
[ "$CODE" = "404" ] || { echo "FAIL: 期望 404，实际 $CODE"; exit 1; }

RESP=$(curl -s "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail")
echo "$RESP" | jq -e '.error | type == "string"' || { echo "FAIL: error 字段缺失或非 string"; exit 1; }
echo "✅ Step 5 error path 验证通过"
```

**硬阈值**: HTTP 404；`error` 字段为 string 类型

---

### Step 6: Dashboard 面板点击 initiative card → 侧栏展示 PRD 全文

**来源**: `[FROM_PRD]` — PRD Golden Path "用户点击 HarnessPipelinePage.tsx 的 initiative card" + "面板展示：PRD 全文（Markdown 渲染）"

**可观测行为**: 用户在 /pipeline 页点击 initiative card 后，出现侧栏/抽屉，渲染 PRD 全文（含 "# Sprint PRD" 字样）

**验证命令**:
```javascript
// Playwright mac_web E2E（见下方 E2E 验收区块）
await page.click('[data-testid="initiative-card"]');
await expect(page.locator('[data-testid="initiative-detail-panel"]')).toBeVisible({ timeout: 10000 });
await expect(page.locator('[data-testid="initiative-prd-content"]')).toContainText('# Sprint PRD');
```

**硬阈值**: Playwright 断言 toBeVisible + toContainText，exit 0

---

### Step 7: Dashboard 面板展示步骤时间线（node + duration）

**来源**: `[FROM_PRD]` — PRD DoD 条目 4："Dashboard 详情面板展示步骤时间线（至少显示 node 名和 duration）"

**可观测行为**: 面板中时间线区块可见，每条记录显示 node 名（如 "prep"/"plan"/"execute"）和对应耗时

**验证命令**:
```javascript
// Playwright 断言（mac_web E2E 中验证）
await expect(page.locator('[data-testid="initiative-step-timeline"]')).toBeVisible({ timeout: 8000 });
await expect(page.locator('[data-testid="step-timeline-item"]').first()).toBeVisible();
```

**硬阈值**: step-timeline 区块可见，至少 1 条时间线条目

---

### Step 8: reportNode 输出 JSON 含 step_timing / ws_issues / ws_costs 三字段

**来源**: `[FROM_PRD]` — PRD "reportNode 新增字段（WS4）" 段直接定义三字段名及禁用清单（`timings`/`timing`/`issues`/`costs`/`breakdown`）

**可观测行为**: `reportNode` 构建的 reportContent JSON 包含 `step_timing`（数组）、`ws_issues`（数组）、`ws_costs`（数组）三个顶层字段，无禁用字段名。report 内容以 JSONB 对象存储在 `tasks.result->'report_content'` 键下（**非文件路径**，是内存 JSON 直接持久化）。

**验证命令**:
```bash
# 从最近完成的 initiative 的 tasks.result->'report_content' 中验证
# 注意：->'report_content' 取 JSONB 嵌套对象（不是 ->>，不需要二次 JSON 解析）
REPORT_JSON=$(psql $DB -t -c "
  SELECT result->'report_content'
  FROM tasks
  WHERE task_type='harness_initiative'
    AND status='completed'
    AND result->'report_content' IS NOT NULL
  ORDER BY completed_at DESC LIMIT 1" | tr -d ' \n')

if [ -n "$REPORT_JSON" ]; then
  echo "$REPORT_JSON" | jq -e '.step_timing | type == "array"'  || { echo "FAIL: step_timing"; exit 1; }
  echo "$REPORT_JSON" | jq -e '.ws_issues | type == "array"'    || { echo "FAIL: ws_issues"; exit 1; }
  echo "$REPORT_JSON" | jq -e '.ws_costs | type == "array"'     || { echo "FAIL: ws_costs"; exit 1; }
  echo "$REPORT_JSON" | jq -e 'has("timings") | not'            || { echo "FAIL: 禁用字段 timings"; exit 1; }
  echo "$REPORT_JSON" | jq -e 'has("issues") | not'             || { echo "FAIL: 禁用字段 issues"; exit 1; }
  # ws_issues 元素结构：每条含 ws_id / feedback / ci_fail_type
  echo "$REPORT_JSON" | jq -e 'if (.ws_issues | length) > 0 then .ws_issues[0] | has("ws_id") and has("feedback") and has("ci_fail_type") else true end' \
    || { echo "FAIL: ws_issues 元素缺 ws_id/feedback/ci_fail_type"; exit 1; }
  # ws_costs 元素结构：每条含 ws_id / cost_usd
  echo "$REPORT_JSON" | jq -e 'if (.ws_costs | length) > 0 then .ws_costs[0] | has("ws_id") and has("cost_usd") else true end' \
    || { echo "FAIL: ws_costs 元素缺 ws_id/cost_usd"; exit 1; }
  echo "✅ Step 8 reportNode 字段验证通过"
else
  echo "SKIP: 无已完成含 report_content 的 initiative（WS4 实现后再验）"
fi
```

**硬阈值**: 三字段类型为 array；禁用字段不存在；元素结构符合 PRD 定义

---

### Step 9: mac_web evaluator 验收后截图写入 ~/claude-output/harness-screenshots/

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：PRD 描述了截图链路但未指定端到端验证方式；此步骤防止 generator 只写 SKILL.md 文字但不实际触发截图落盘，加时间窗口避免历史截图造假通过。

**可观测行为**: WS5 E2E 跑完后，`~/claude-output/harness-screenshots/` 目录下有至少 1 个新于 E2E 开始时间的 PNG 文件

**验证命令**:
```bash
SCREENSHOTS_DIR="$HOME/claude-output/harness-screenshots"
COUNT=$(find "$SCREENSHOTS_DIR" -name "*.png" -newer /tmp/e2e-start-marker -type f 2>/dev/null | wc -l | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: 截图目录 $SCREENSHOTS_DIR 无新 PNG（截图链路断开）"; exit 1; }
echo "✅ Step 9 截图链路验证通过，新增 $COUNT 张"
```

**硬阈值**: ≥ 1 个 PNG 文件（新于 E2E 开始时间戳 /tmp/e2e-start-marker）

---

### Step 10: PRD DoD #8 — sprint 目录结构完整性

**来源**: `[FROM_PRD]` — PRD DoD 第 8 条直接定义："[ARTIFACT] `sprints/cecelia-pipeline-viz-v2/` 目录含 sprint-prd.md + contract-dod.md（每 WS 一份）"

**可观测行为**: `sprints/cecelia-pipeline-viz-v2/` 目录存在 `sprint-prd.md` 及 `contract-dod-ws1.md` 至 `contract-dod-ws5.md` 共 6 个文件

**验证命令**:
```bash
BASE="sprints/cecelia-pipeline-viz-v2"
for f in sprint-prd.md contract-dod-ws1.md contract-dod-ws2.md contract-dod-ws3.md contract-dod-ws4.md contract-dod-ws5.md; do
  [ -f "$BASE/$f" ] || { echo "FAIL: 缺少 $BASE/$f"; exit 1; }
done
echo "✅ Step 10 sprint 目录结构完整"
```

**硬阈值**: 6 个文件全部存在，exit 0

---

## Risks

### R1: `initiative_contracts` 表缺列（PRD ASSUMPTION #1 — 依赖 PR #3091 合并）
**影响**: 若 PR #3091 未合并，`initiative_contracts` 表不含 `prd_content`/`contract_content`/`review_rounds` 列，WS2 路由 PostgreSQL 报 "column does not exist" → HTTP 500 → WS5 E2E 全链路 FAIL。
**缓解**: WS2 Generator 在路由层用 `try-catch` 包裹 `initiative_contracts` 查询；捕获到列不存在错误时，`prd_content`/`contract_content`/`gan_rounds` 均返回 `null`（HTTP 200 不 500）。WS2 evaluator 边界 BEHAVIOR（无 initiative_contracts 行 → prd_content == null）同时覆盖此 risk。

### R2: Dashboard dev server 未运行导致 Playwright E2E 超时
**影响**: WS5 Mode B final-e2e 脚本的所有 `page.goto('http://localhost:5174/...')` 调用将因连接拒绝而超时（默认 30s），导致 Playwright exit 1，final-e2e FAIL。
**缓解**: E2E 脚本开头加 health check：`curl -sf --max-time 5 http://localhost:5174/ || { echo "FAIL: Dashboard dev server 未在 localhost:5174 运行"; exit 1; }`；超时时报清晰错误而非 Playwright timeout；evaluator 应将此类环境错误标记为 `infra_fail` 而非 `code_fail`，触发重试而非任务失败。

---

## E2E 验收（final-e2e — mac_web Playwright，localhost:5174）

**journey_type**: user_facing
**target_environment**: mac_web

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行）
const { chromium, expect } = require('@playwright/test');

(async () => {
  // 时间戳标记（防止历史截图造假）
  const { execSync } = require('child_process');
  execSync('touch /tmp/e2e-start-marker');

  // health check：dev server 必须运行
  try {
    execSync('curl -sf --max-time 5 http://localhost:5174/', { stdio: 'ignore' });
  } catch (e) {
    console.error('FAIL: Dashboard dev server 未在 localhost:5174 运行');
    process.exit(1);
  }

  const screenshotsDir = `${process.env.HOME}/claude-output/harness-screenshots`;
  require('fs').mkdirSync(screenshotsDir, { recursive: true });
  require('fs').mkdirSync('screenshots', { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. 前置：通过 Brain API 创建测试 initiative（保证有数据可点）
  const taskResp = await page.request.post('http://localhost:5221/api/brain/tasks', {
    data: {
      task_type: 'harness_initiative',
      title: '[E2E Test] pipeline-viz-v2 detail panel',
      description: '# Sprint PRD — E2E Test Initiative\n## OKR 对齐\n测试用',
      status: 'completed',
      payload: { sprint_dir: 'sprints/cecelia-pipeline-viz-v2' }
    },
    headers: { 'Content-Type': 'application/json' }
  });
  const taskData = await taskResp.json();
  const testInitiativeId = taskData.id;
  if (!testInitiativeId) { console.error('FAIL: 创建测试 initiative 失败', taskData); process.exit(1); }

  // 2. 导航到 Dashboard /pipeline 页
  await page.goto('http://localhost:5174/pipeline');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-pipeline-list.png' });

  // 3. 找到 initiative card 并点击
  const card = page.locator('[data-testid="initiative-card"]').first();
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();
  await page.screenshot({ path: 'screenshots/02-card-click.png' });

  // 4. 验证详情面板出现
  const detailPanel = page.locator('[data-testid="initiative-detail-panel"]');
  await expect(detailPanel).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/03-detail-panel.png' });

  // 5. 验证 PRD 内容展示
  const prdContent = page.locator('[data-testid="initiative-prd-content"]');
  await expect(prdContent).toBeVisible({ timeout: 8000 });
  await expect(prdContent).toContainText('# Sprint PRD');
  await page.screenshot({ path: 'screenshots/04-prd-content.png' });

  // 6. 验证步骤时间线区块可见
  const timeline = page.locator('[data-testid="initiative-step-timeline"]');
  await expect(timeline).toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: 'screenshots/05-timeline.png' });

  // 7. 交叉验证 Brain API
  const detailResp = await page.request.get(`http://localhost:5221/api/brain/harness/initiative/${testInitiativeId}/detail`);
  if (!detailResp.ok()) { console.error('FAIL: /detail API 返回', detailResp.status()); process.exit(1); }
  const detail = await detailResp.json();
  if (!Array.isArray(detail.screenshot_urls)) { console.error('FAIL: screenshot_urls 非 array'); process.exit(1); }
  if (!Array.isArray(detail.step_timing)) { console.error('FAIL: step_timing 非 array'); process.exit(1); }
  if (detail.prd_content !== null && typeof detail.prd_content !== 'string') {
    console.error('FAIL: prd_content 类型错误', typeof detail.prd_content); process.exit(1);
  }

  // 8. 截图复制到 harness-screenshots 目录
  const fs = require('fs');
  ['01-pipeline-list.png','02-card-click.png','03-detail-panel.png','04-prd-content.png','05-timeline.png'].forEach(f => {
    if (fs.existsSync(`screenshots/${f}`)) {
      fs.copyFileSync(`screenshots/${f}`, `${screenshotsDir}/ws5-${f}`);
    }
  });

  await context.close();
  await browser.close();
  console.log('✅ Golden Path UI 验证通过');
})();
```

**PASS 标准**: 脚本 exit 0，所有 Playwright 断言通过，`~/claude-output/harness-screenshots/` 有新 PNG

---

## Workstreams

workstream_count: 5

### Workstream 1: SKILL.md mac_web 截图 DoD 注入

**范围**: `packages/workflows/skills/harness-contract-proposer/SKILL.md` — mac_web 合约模板末尾加 `[BEHAVIOR:E2E:screenshot]` 条目
**大小**: S（< 30 行改动）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/skill-screenshot-dod.test.ts`

---

### Workstream 2: Brain API /detail 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /initiative/:id/detail` 路由 + `packages/brain/src/__tests__/harness-detail.test.js` 单测
**大小**: M（100-130 行）
**依赖**: Workstream 1 完成后（串行链）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/harness-detail-route.test.ts`

---

### Workstream 3: Dashboard initiative 详情面板

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx` 新增侧栏/抽屉组件，点击 initiative card 展示 PRD/合约/时间线/截图
**大小**: M（120-160 行）
**依赖**: Workstream 2 完成后（面板调用 /detail API）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/initiative-detail-panel.test.ts`

---

### Workstream 4: reportNode 增强

**范围**: `packages/brain/src/workflows/harness-initiative.graph.js` `reportNode` 函数 — 在 reportContent JSON 新增 `step_timing`/`ws_issues`/`ws_costs` 三字段，存储到 `tasks.result->'report_content'`（JSONB，非文件路径）
**大小**: S（50-70 行）
**依赖**: Workstream 3 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws4/report-node-fields.test.ts`

---

### Workstream 5: E2E 截图链路验证

**范围**: `sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts` — 轻量 E2E 脚本验证 WS1-WS4 端到端截图写入链路；PRD DoD #8 目录结构完整性检查
**大小**: S（40-60 行）
**依赖**: Workstream 4 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws5/e2e-screenshot-chain.test.ts`

---

## Workstreams 切分验证（v7.7 自查）

| WS | 主文件 | 预估 LoC | 复杂度 |
|---|---|---|---|
| ws1 | SKILL.md | ~25 | S |
| ws2 | harness.js + harness-detail.test.js | ~130 | M |
| ws3 | HarnessPipelinePage.tsx（+ 可能 HarnessInitiativeDetailPanel.tsx）| ~155 | M |
| ws4 | harness-initiative.graph.js | ~55 | S |
| ws5 | e2e-screenshot-chain.test.ts | ~50 | S |

全部 ≤ 200 行；总计 ~415 行 > 200，不允许合并为 ws=1 ✅

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/skill-screenshot-dod.test.ts` | SKILL.md 含 [BEHAVIOR:E2E:screenshot] | 1 failure（文字尚未存在）|
| WS2 | `tests/ws2/harness-detail-route.test.ts` | HTTP 200 + 六字段 schema / 404 + error 字段为 string | 4-5 failures（路由不存在）|
| WS3 | `tests/ws3/initiative-detail-panel.test.ts` | initiative-detail-panel / initiative-prd-content | 3-4 failures（组件未写）|
| WS4 | `tests/ws4/report-node-fields.test.ts` | step_timing（array） / ws_costs 元素含 | 3 failures（字段未加）|
| WS5 | `tests/ws5/e2e-screenshot-chain.test.ts` | harness-screenshots | 2 failures（链路未建立）|

---

## GAN 来源标注汇总

| 类型 | 步骤 |
|---|---|
| FROM_PRD | Step 1, 2, 3, 4, 5, 6, 7, 8, 10 |
| AI_ADDED | Step 9（截图时间窗口防造假 — 防止历史截图绕过验证）|
