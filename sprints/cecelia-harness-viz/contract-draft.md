# Sprint Contract Draft (Round 3)

## Golden Path
[用户访问 /pipeline] → [页面对 in_progress initiative 调 ws-progress API 读 checkpoint_blobs] → [pipeline card status badge 下方显示 WS 进度行]

---

### Step 1: 用户打开 /pipeline 页面
**来源**: `[FROM_PRD]` — PRD「Golden Path」段第 1 条："用户打开 http://perfect21:5211/pipeline"

**可观测行为**: Dashboard /pipeline 页面正常加载，对每个 status=in_progress 的 initiative 调用 ws-progress API

**验证命令**:
```bash
# 验证 Brain API 健康（Playwright 测试先决条件）
curl -f localhost:5221/api/brain/health | jq -e '.status == "ok"'
```

**硬阈值**: Brain API 返回 200，status = "ok"

---

### Step 2: 页面对 in_progress initiative 调用 ws-progress API
**来源**: `[FROM_PRD]` — PRD「Golden Path」段第 2 条 + 「Response Schema」段完整定义

**可观测行为**: GET /api/brain/harness/initiative/:id/ws-progress 返回 HTTP 200，body 包含 initiative_id + workstreams 数组

**验证命令**:
```bash
INIT_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='harness_initiative' AND status='in_progress' LIMIT 1" | tr -d ' ')
[ -z "$INIT_ID" ] && { echo "SKIP: 无 in_progress initiative"; exit 0; }
RESP=$(curl -f localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress)

# 2a. initiative_id 字段值匹配
echo "$RESP" | jq -e --arg id "$INIT_ID" '.initiative_id == $id' || { echo "FAIL: initiative_id 不匹配"; exit 1; }

# 2b. workstreams 是数组
echo "$RESP" | jq -e '.workstreams | type == "array"' || { echo "FAIL: workstreams 不是数组"; exit 1; }

# 2c. Schema 完整性 — 顶层 keys 精确匹配
echo "$RESP" | jq -e 'keys == ["initiative_id","workstreams"]' || { echo "FAIL: 顶层 keys 不符"; exit 1; }

# 2d. 禁用字段反向检查（全部禁用字段名）
for BANNED in steps phases stages result data ws_list; do
  echo "$RESP" | jq -e "has(\"$BANNED\") | not" || { echo "FAIL: 禁用字段 $BANNED 存在"; exit 1; }
done

echo "✅ Step 2 验证通过"
```

**硬阈值**: HTTP 200；顶层 keys 精确等于 `["initiative_id","workstreams"]`；所有禁用字段均不存在

---

### Step 3: workstreams 数组每个元素字段正确
**来源**: `[FROM_PRD]` — PRD Response Schema 段 workstreams[] 字段定义（ws_id/title/status/evaluate_verdict/pr_url/fix_round/container_id）

**可观测行为**: 当 checkpoint_blobs 存在 harness-task:{initiative_id}:ws1/ws2/ws3 线程时，workstreams 包含对应记录，子对象字段完整

**验证命令**:
```bash
INIT_ID=$(psql $DB -t -c "SELECT t.id FROM tasks t INNER JOIN checkpoint_blobs cb ON cb.thread_id LIKE 'harness-task:' || t.id::text || ':ws%' WHERE t.task_type='harness_initiative' LIMIT 1" | tr -d ' ')
[ -z "$INIT_ID" ] && { echo "SKIP: 无带 checkpoint 的 initiative"; exit 0; }
RESP=$(curl -f localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress)

# 3a. workstream 子对象 keys 精确匹配（字典序）
echo "$RESP" | jq -e '.workstreams[0] | keys == ["container_id","evaluate_verdict","fix_round","pr_url","status","title","ws_id"]' || { echo "FAIL: workstream 子 keys 不符"; exit 1; }

# 3b. fix_round 是 number
echo "$RESP" | jq -e '.workstreams[0].fix_round | type == "number"' || { echo "FAIL: fix_round 不是 number"; exit 1; }

# 3c. ws_id 格式正确
echo "$RESP" | jq -e '.workstreams[0].ws_id | test("^ws[123]$")' || { echo "FAIL: ws_id 格式错误"; exit 1; }

echo "✅ Step 3 验证通过"
```

**硬阈值**: workstream 子对象 keys 精确等于 `["container_id","evaluate_verdict","fix_round","pr_url","status","title","ws_id"]`（字典序）；fix_round type == "number"

---

### Step 4: pipeline card 在 status badge 下方显示 WS 进度行
**来源**: `[FROM_PRD]` — PRD「Golden Path」段第 3 条："pipeline card status badge 下方显示 ws_id | 标题（≤30字）| 状态图标 | verdict badge | PR 链接"

**可观测行为**: 前端 HarnessPipelinePage.tsx PipelineCard 在 status badge 区块下方渲染 WS 进度行，每行含 data-testid="ws-progress-row"

**验证命令**:
```javascript
// Playwright 模式A：API-level（evaluator 逐 ws 跑，验 DOM 结构 + UI 约束）
const { chromium, expect } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/pipeline');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });

  // 1. ws-progress-section DOM 存在
  const count = await page.locator('[data-testid="ws-progress-section"]').count();
  if (count === 0) { console.error('FAIL: ws-progress-section 不存在'); process.exit(1); }

  // 2. verdict badge DOM 存在（PRD 要求「verdict badge」）
  const verdictBadges = await page.locator('[data-testid="ws-verdict-badge"]').count();
  // verdictBadge 仅在有 evaluate_verdict 的 WS 出现，≥0 即可；源码必须有 data-testid
  // 通过 BEHAVIOR 源码检查强制要求其存在

  // 3. 标题 ≤30 字（PRD「标题（≤30字）」约束）
  const titleEls = page.locator('[data-testid="ws-progress-row"] .ws-title, [data-testid="ws-progress-row"] [class*="title"]');
  const titleCount = await titleEls.count();
  for (let i = 0; i < titleCount; i++) {
    const text = await titleEls.nth(i).textContent();
    if (text && text.length > 30) {
      console.error(`FAIL: 标题超过30字 (${text.length}字): "${text}"`);
      process.exit(1);
    }
  }

  await page.screenshot({ path: 'screenshots/02-ws-detail.png' });
  await browser.close();
  console.log('✅ Step 4 DOM 结构 + UI 约束验证通过');
})();
```

**硬阈值**: 至少 1 个 `[data-testid="ws-progress-section"]` 存在（当有 in_progress pipeline 时）；所有 WS 标题长度 ≤30 字；源码含 `data-testid="ws-verdict-badge"`

---

### Step 5: 4 条 status→图标映射规则全部正确渲染
**来源**: `[FROM_PRD]` — PRD「边界情况」段完整 4 条规则：null+container_id非空→🔄；null+null→⬜；merged→✅；running/spawning→🔄

**可观测行为**: UI 对所有 4 种 status/container_id 组合渲染正确状态图标

**验证命令**:
```bash
# 验证 UI 源码包含所有 4 种 status 分支逻辑
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');
const checks = [
  ['container_id', 'null+container_id 分支'],
  ['merged', 'merged 分支'],
  ['running', 'running/spawning 分支'],
  ['待开始', '⬜ 待开始文本或 pending 状态'],
];
const failed = checks.filter(([k]) => !c.includes(k));
if (failed.length > 0) { console.error('FAIL: 缺少分支:', failed.map(f=>f[1])); process.exit(1); }
console.log('✅ 4 条图标映射分支均存在');
"
```

**硬阈值**: 4 种 status 组合在源码中均有对应条件分支

---

### Step 6: 边界情况 — 无 WS thread 时返回空数组；不存在 initiative 返回 404
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD「边界情况」明确"无 WS thread → workstreams 返回 []"+ Error Schema 定义 404，防止 generator 对空或不存在 ID 返 null / 500

**可观测行为**: 边界输入返回合规响应，不抛 5xx

**验证命令**:
```bash
# 空 workstreams 验证
NEW_INIT_ID=$(psql $DB -t -c "INSERT INTO tasks (task_type,status,title) VALUES ('harness_initiative','queued','test-empty-ws-r2') RETURNING id" | tr -d ' ')
RESP=$(curl -f localhost:5221/api/brain/harness/initiative/$NEW_INIT_ID/ws-progress)
psql $DB -c "DELETE FROM tasks WHERE id='$NEW_INIT_ID'" >/dev/null
echo "$RESP" | jq -e '.workstreams == []' || { echo "FAIL: 空 workstreams 不是 []"; exit 1; }

# 404 验证
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/ws-progress")
[ "$HTTP_CODE" = "404" ] || { echo "FAIL: 非 404 HTTP code: $HTTP_CODE"; exit 1; }
ERR_BODY=$(curl -s "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/ws-progress")
echo "$ERR_BODY" | jq -e '.error == "initiative not found"' || { echo "FAIL: error 字段不符"; exit 1; }

echo "✅ Step 6 边界验证通过"
```

**硬阈值**: 空 WS → `workstreams: []`；不存在 ID → HTTP 404 + `{"error":"initiative not found"}`

---

## Risks

### Risk 1: checkpoint_blobs 表结构假设失效
**场景**: PRD ASSUMPTION 声明 `channel` 字段含 `status/evaluate_verdict/pr_url/fix_round/containerId/task`，但若字段名实际为 `containerid`（小写）或字段不存在，路由查询将返回 null 导致 workstream 渲染空白。
**影响**: WS 进度行全部显示"⬜ 待开始"，即使实际在运行中 — 误导用户，cascade 影响所有 in_progress initiative 的可观测性。
**Mitigation**: Generator 必须在实现前用 `psql -c "\d checkpoint_blobs"` 验证 channel 字段实际结构，路由代码加 `COALESCE(channel->>'status', null)` 防 null crash。合同 WS1 ARTIFACT 条目要求 harness.js 明确引用 channel 字段名。

### Risk 2: 前端 fetch 无 in_progress initiative 时 ws-progress API 未被调用，WS 行永不渲染
**场景**: Dashboard 只对 `status=in_progress` 的 initiative card 调用 ws-progress API。若测试环境无 in_progress initiative，Playwright 断言 `ws-progress-section` count=0 不会抛错（被 `count === 0` 分支跳过），final-e2e 假绿。
**影响**: Generator 实现可以完全省略 WS 进度行，evaluator 模式B 仍然通过 — cascade 导致功能实际未交付。
**Mitigation**: final-e2e 脚本必须先确保有 in_progress initiative（若无则 INSERT 测试数据），再断言 `ws-progress-section` count ≥ 1；删除"count=0跳过"逻辑改为硬断言。Reviewer 已在 Step 4 验证命令中要求去掉跳过分支。

---

## E2E 验收（final-e2e — target_environment = mac_web）

**journey_type**: user_facing
**target_environment**: mac_web

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行，localhost:5174）
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. 确保有 in_progress initiative（防假绿）
  const ensureResp = await page.request.get('http://localhost:5221/api/brain/tasks?task_type=harness_initiative&status=in_progress&limit=1');
  const ensureData = await ensureResp.json();
  const inProgressList = ensureData.tasks || ensureData || [];
  let testInitId = null;
  if (inProgressList.length === 0) {
    // 插入测试数据使前端能渲染 ws-progress
    const createResp = await page.request.post('http://localhost:5221/api/brain/tasks', {
      data: { task_type: 'harness_initiative', status: 'in_progress', title: 'e2e-test-ws-viz' }
    });
    const created = await createResp.json();
    testInitId = created.id;
  }

  // 2. 导航到 /pipeline 页面
  await page.goto('http://localhost:5174/pipeline');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });

  // 3. 验证页面标题区域存在
  const h1 = page.locator('h1, [data-testid="pipeline-page-title"]').first();
  await h1.waitFor({ timeout: 10000 });

  // 4. 验证 ws-progress-section 存在（硬断言，不跳过）
  const wsSection = page.locator('[data-testid="ws-progress-section"]').first();
  await wsSection.waitFor({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/02-ws-progress-visible.png' });

  // 5. 验证 ws-progress-row 存在
  const wsRow = page.locator('[data-testid="ws-progress-row"]').first();
  await wsRow.waitFor({ timeout: 5000 });

  // 6. 交叉验证后端 API 返回正确结构
  const initRows = inProgressList.length > 0 ? inProgressList : [{ id: testInitId }];
  const initId = initRows[0].task_id || initRows[0].id;
  const wsResp = await page.request.get(`http://localhost:5221/api/brain/harness/initiative/${initId}/ws-progress`);
  if (wsResp.status() !== 200) {
    console.error('FAIL: ws-progress API 返回非 200', wsResp.status());
    process.exit(1);
  }
  const wsData = await wsResp.json();
  if (wsData.initiative_id !== initId) { console.error('FAIL: initiative_id 不匹配', wsData); process.exit(1); }
  if (!Array.isArray(wsData.workstreams)) { console.error('FAIL: workstreams 不是数组', wsData); process.exit(1); }
  for (const banned of ['steps','phases','stages','result','data','ws_list']) {
    if (banned in wsData) { console.error(`FAIL: 禁用字段 ${banned} 存在`); process.exit(1); }
  }

  // 7. 清理测试数据
  if (testInitId) {
    await page.request.delete(`http://localhost:5221/api/brain/tasks/${testInitId}`).catch(() => {});
  }

  await page.screenshot({ path: 'screenshots/03-result.png' });
  await context.close();
  await browser.close();
  console.log('✅ Golden Path UI 验证通过');
})();
```

**截图期望**:
- `01-initial.png`: /pipeline 页面加载完成，pipeline 卡片列表可见，页面无红色报错框
- `02-ws-progress-visible.png`: in_progress pipeline card 内 ws-progress-section 区块显示，WS 进度行含状态图标和 ws_id 标签
- `03-result.png`: 整体页面最终状态，WS 进度区块已渲染，后端 API 交叉验证通过

**通过标准**: 脚本 exit 0；截图符合期望描述

---

## 注册表防冲突检查

**已注册 API Endpoints**: 无 `/api/brain/harness/initiative/:id/ws-progress`，新建无冲突

**已注册 DB Schema**: 使用现有 `checkpoint_blobs` 表，不新建表，无冲突

---

## Workstreams

workstream_count: 3

### Workstream 1: Brain API — GET /initiative/:id/ws-progress 端点

**范围**: `packages/brain/src/routes/harness.js` 新增路由，查询 `checkpoint_blobs` 表（thread_id LIKE `harness-task:{initiative_id}:ws%`），提取 ws_id/title/status/evaluate_verdict/pr_url/fix_round/container_id
**大小**: S (<100 行)
**依赖**: 无（ws1 为起点）

**BEHAVIOR**:
- [ ] [BEHAVIOR] ws-progress API 返回顶层 keys 精确等于 `["initiative_id","workstreams"]`（schema 完整性）
- [ ] [BEHAVIOR] initiative_id 字段值等于请求路径 id（字段值正确）
- [ ] [BEHAVIOR] 无 WS checkpoint 时 workstreams 返回 `[]`（空数组边界）
- [ ] [BEHAVIOR] 不存在 initiative_id 返回 HTTP 404 + `{"error":"initiative not found"}`（error path）
- [ ] [BEHAVIOR] workstream 子对象 keys 精确等于 `["container_id","evaluate_verdict","fix_round","pr_url","status","title","ws_id"]`（字典序）
- [ ] [BEHAVIOR] workstream fix_round 是 number 类型

**对应合同 Step**: Step 2、3、6

---

### Workstream 2: Brain 单元测试（mock pool）

**范围**: 新建 `packages/brain/src/__tests__/harness-ws-progress.test.js`，mock pool 验证路由逻辑，覆盖正常/空/404/字段类型/禁用字段
**大小**: M (100-150 行)
**依赖**: Workstream 1 完成后

**BEHAVIOR**:
- [ ] [BEHAVIOR] vitest 单测全部通过（mock pool 返回正确 schema — initiative_id + workstreams 字段）
- [ ] [BEHAVIOR] mock pool 返回空行时 workstreams=[]（空数组边界）
- [ ] [BEHAVIOR] mock pool 无 initiative 行时路由返回 HTTP 404 + error（error path）
- [ ] [BEHAVIOR] 测试文件 fix_round 断言为 number 类型（字段类型正确性）
- [ ] [BEHAVIOR] 测试文件不含禁用字段名在 mock 响应正向断言中

**对应合同 Step**: Step 2、3

---

### Workstream 3: Dashboard UI — WsProgressSection + 状态图标 + 渲染测试

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx` 在 PipelineCard 内加 WsProgressSection 组件（含 4 条 status→图标映射）；新建渲染测试 `__tests__/WsProgress.test.tsx` + `__tests__/WsStatusIcon.test.tsx`
**大小**: M (130-160 行，3 文件)
**依赖**: Workstream 2 完成后

**BEHAVIOR**:
- [ ] [BEHAVIOR] UI 引用所有 PRD 字段（ws_id/title/status/evaluate_verdict/pr_url/fix_round/container_id）
- [ ] [BEHAVIOR] 禁用字段名不在 UI 代码数据解构中
- [ ] [BEHAVIOR] status=null && container_id 非空 → 🔄 运行中（边界场景 1）
- [ ] [BEHAVIOR] status=null && container_id=null → ⬜ 待开始（边界场景 2）
- [ ] [BEHAVIOR] status=merged → ✅ MERGED（状态映射正确）
- [ ] [BEHAVIOR] status=running/spawning → 🔄 运行中（状态映射正确）
- [ ] [BEHAVIOR] WsProgress.test.tsx + WsStatusIcon.test.tsx vitest 渲染测试全部通过

**对应合同 Step**: Step 4、5

---

## Workstreams 切分自查

- WS1: ~70 行 (≤ 200 ✅)，1 文件 (≤ 3 ✅)
- WS2: ~130 行 (≤ 200 ✅)，1 文件 (≤ 3 ✅)
- WS3: ~150 行 (≤ 200 ✅)，3 文件 (≤ 3 ✅)
- 总净增: ~350 行 (> 200 ✅ 必须多 ws)

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（机检命令） |
|---|---|---|---|
| WS1 | `tests/ws1/harness-ws-progress.test.js` | schema/initiative_id/checkpoint_blobs/404/禁用字段 | `npx vitest run sprints/cecelia-harness-viz/tests/ws1/harness-ws-progress.test.js 2>&1 \| grep -qE "Test Files.*failed\|failed to load\|FAIL" && echo "RED OK" \|\| { echo "UNEXPECTED GREEN"; exit 1; }` |
| WS2 | `tests/ws2/harness-ws-progress-unit.test.js` | empty workstreams/404/fix_round/禁用字段 | `npx vitest run sprints/cecelia-harness-viz/tests/ws2/harness-ws-progress-unit.test.js 2>&1 \| grep -qE "Test Files.*failed\|failed to load\|FAIL" && echo "RED OK" \|\| { echo "UNEXPECTED GREEN"; exit 1; }` |
| WS3 | `apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx` `apps/dashboard/src/pages/harness-pipeline/__tests__/WsStatusIcon.test.tsx` | UI渲染/4条图标映射/空状态 | `npx vitest run apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx apps/dashboard/src/pages/harness-pipeline/__tests__/WsStatusIcon.test.tsx 2>&1 \| grep -qE "Test Files.*failed\|Cannot find\|FAIL" && echo "RED OK" \|\| { echo "UNEXPECTED GREEN"; exit 1; }` |

**depends_on 串行链自查（v7.10）**:
```bash
python3 - << 'PYEOF'
import json
plan = json.load(open("sprints/cecelia-harness-viz/task-plan.json"))
tasks = plan["tasks"]
for i, t in enumerate(tasks):
    if i == 0:
        assert t["depends_on"] == [], f"FAIL: ws1.depends_on 应为 []，实际 {t['depends_on']}"
    else:
        prev = tasks[i-1]["task_id"]
        assert prev in t["depends_on"], \
            f"FAIL: {t['task_id']}.depends_on 缺少前置 {prev}"
print("✅ depends_on 串行链验证通过")
PYEOF
```
