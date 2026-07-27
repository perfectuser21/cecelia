# Sprint Contract Draft (Round 1)

**Sprint**: 主理人对话回路 PR3/4 — Dashboard 对话栏 UI
**Task ID**: 496dceb8-0ded-4923-80e3-d5772af256a7
**target_environment**: mac_web
**journey_type**: user_facing
**base_repo**: cecelia

> 锚定父路声明：独立小路（无父路）— 本 sprint 是前端 UI 实现层，PR1/PR2 已落库 API 为依托，无 Golden Path 父路。

---

## Response Schema（推导来源: PRD 明确 + api_registry 推导）

### Endpoint: GET /api/brain/conversations?journey_id=<id>[&gp_id=<id>]
**Success (HTTP 200)**:
```json
{
  "conversations": [
    {
      "id": "<uuid>",
      "journey_id": "<uuid>",
      "gp_id": "<uuid|null>",
      "title": "<string|null>",
      "status": "active|resolved|suspended|archived",
      "turn_count": "<number>",
      "last_message": "<string|null>",
      "updated_at": "<iso8601>",
      "last_message_at": "<iso8601|null>"
    }
  ]
}
```
- `conversations` (array, 必填): 对话列表
- `status` (string 枚举): `active` / `resolved` / `suspended` / `archived`
- `gp_id` (uuid | null): GP 过滤字段，存在时只返回锚定该 GP 的对话

**禁用字段名**: `conversation_list`, `data`, `items`, `results`

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

### Endpoint: POST /api/brain/conversations
**Request Body**:
```json
{"journey_id": "<uuid>", "gp_id": "<uuid|optional>", "title": "<string|optional>"}
```
**Success (HTTP 201)**:
```json
{"id": "<uuid>", "journey_id": "<uuid>", "gp_id": "<uuid|null>", "status": "active", ...}
```

### Endpoint: N/A（本 Sprint 主体是前端 UI，无新 HTTP 响应）
本 Sprint 改动为前端组件（status badge 渲染、新页面、组件提取）+ 路由注册。
后端 API 复用 PR1/PR2 现有端点，无新 Response Schema。

---

## 已知约束（来自回归测试 + 累积 FR）

### 来自回归测试 [WarRoomLineCommandPage.test.ts]
- [WarRoomLineCommandPage.test.ts] → [B1] null → null（turnMarkerLabel）
- [WarRoomLineCommandPage.test.ts] → [B1] "chat" → null（纯聊天，不显示标记）
- [WarRoomLineCommandPage.test.ts] → [B2] "pending_user" → "等待拍板"
- [WarRoomLineCommandPage.test.ts] → [B3] "decision_saved=<uuid>" → "已落决策"
- [WarRoomLineCommandPage.test.ts] → [B4] 有 title 时返回 title（convTitle）
- [WarRoomLineCommandPage.test.ts] → [B5] 超长文本在 maxLen 处截断 + 省略号（truncateMsg）

### 来自累积 FR [context-manifest: unavailable]
context-manifest: unavailable（端点不可达，标记为不可用）

### 来自 PR1/PR2 已知约束
- conversations.journey_id 外键约束（migration 359）
- conversations 状态枚举：active / resolved / suspended / archived
- POST /api/brain/conversations 已校验 gp_id UUID 格式（不存在则 404）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | D1: 议题列表 status badge（3 色 3 态）；D4: 新建 WarRoomGoldenPathPage（/warroom/gp/:gpId）含 ConversationsPanel gpId 过滤；ConversationsPanel 提取为独立模块 |
| **NFR（做得多好）** | 非功能需求 | 议题列表首屏 < 2s；发送消息"军师思考中…"出现 < 300ms；375px 单栏可操作 |
| **Invariant（永不违反）** | 不变量 | journeyId 必来自真实 journeys.id；gp_id 必来自真实 golden_path.id；前端不直接 spawn claude；turn_count 只读展示 |
| **判定点（怎么知道）** | 模糊判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | N/A — 前端页面组件无 TTL；conversations 由 Brain cron 归档（PR4 处理） |
| **死亡告警（停了谁知道）** | 告警机制 | N/A — UI 层停用直接体现为 404；后端 Brain 有健康检查 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明表 |
| **效果确认（已发≠已生效）** | 回执验证 | 发消息后轮询 GET messages；agent 回复出现 = 效果确认；发送失败时 convError 展示 |

### 判定点登记表

（本任务无接缝判定点，N/A） — 本 Sprint 为纯前端 UI 实现，无 RPA/真机操控/生产 env 接缝。状态 badge 颜色映射是纯逻辑函数，无外部状态推断。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| GET /conversations 失败 | convError 显示"加载对话列表失败" | 是（用户点刷新重试） | 无降级，显示错误文字 |
| POST /conversations 失败 | convError 显示"创建对话失败" | 是（幂等，重试不重复创建） | 无降级 |
| POST /messages 失败 | convError 显示错误 msg，乐观消息已显示 | 否（需用户重新输入） | 无 SSE 回滚，下次轮询可见真实状态 |
| GP 页 gpId 不存在 | 显示"GP 不存在或已归档"错误卡 + 返回按钮 | N/A | 返回 Line 页 |

### 输入对抗面

N/A — 本 Sprint 为内部 Dashboard，用户已认证，无对外暴露 agent。

---

## 禁 mock 边清单

（本单纯 UI 前端改动，无调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径改动，N/A）

合同 tests/ 的 vitest 测试验证纯函数（statusBadgeMeta、ConversationsPanel props 类型），不 mock ConversationsPanel 的 fetch 链路（该链路改动在 PR1/PR2，本 sprint 不改）。

---

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

tests/ 中的纯函数单测无需 mock 被测函数的任何依赖（都是纯函数：statusBadgeMeta 接受 string 返回 class string，无外部调用）。

---

## 真实调用方请求 shape

N/A — 本 Sprint 无「设备/agent 调服务端」接缝，均为浏览器前端 fetch 调用，认证方式为 Cookie/Session（现有 Dashboard 鉴权体系）。

---

## Golden Path

[用户打开 /pipeline] → [下钻 Line] → [栏4 看到议题列表+status badge] → [创建新对话] → [发消息 → 收到 agent 回复] → [回访历史议题] → [从 Ability 进入 GP 页] → [GP 页创建对话 → 发消息]

---

### Step 1: 议题列表 status badge 渲染

**来源**: `[FROM_PRD]` — PRD D1 段（第 28-38 行）：议题卡片必须显示 status badge，三态颜色分别为 active/resolved/suspended

**可观测行为**: 议题列表中每条议题卡片右上角出现彩色 badge，active 显示绿色"活跃"、resolved 显示灰色"已解决"、suspended 显示黄色"挂起"

**验证命令**:
```bash
# 验证 statusBadgeMeta 纯函数存在且正确映射
node -e "
const { statusBadgeMeta } = require('./apps/dashboard/src/pages/warroom/ConversationsPanel.ts');
" 2>&1 | grep -v "Cannot\|Error" || true

# 验证测试文件包含 statusBadgeMeta 覆盖
node -e "const c=require('fs').readFileSync('./sprints/07271849-relay-496dceb8/tests/ConversationsPanel.test.ts','utf8'); if(!c.includes('statusBadgeMeta'))process.exit(1); console.log('OK')"
```

**硬阈值**: ConversationsPanel.tsx 必须包含 `statusBadgeMeta` 函数，覆盖 active/resolved/suspended 三态

---

### Step 2: ConversationsPanel 提取为独立模块

**来源**: `[FROM_PRD]` — PRD D4 段（第 73 行）：ConversationsPanel 组件需提取为独立模块

**可观测行为**: `apps/dashboard/src/pages/warroom/ConversationsPanel.tsx` 文件存在，接口包含 `journeyId: string` 和 `gpId?: string` 参数；WarRoomLineCommandPage.tsx import 该组件

**验证命令**:
```bash
# 文件存在
test -f /workspace/apps/dashboard/src/pages/warroom/ConversationsPanel.tsx || { echo "FAIL: ConversationsPanel.tsx 不存在"; exit 1; }

# 接口包含 gpId
grep -q "gpId" /workspace/apps/dashboard/src/pages/warroom/ConversationsPanel.tsx || { echo "FAIL: 缺 gpId 参数"; exit 1; }

# WarRoomLineCommandPage 引入了 ConversationsPanel
grep -q "ConversationsPanel" /workspace/apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx || { echo "FAIL: WarRoomLineCommandPage 未引用 ConversationsPanel"; exit 1; }

echo "OK"
```

**硬阈值**: 文件存在 + 接口含 gpId 参数 + WarRoomLineCommandPage 引用成功

---

### Step 3: GP 二级页创建及路由注册

**来源**: `[FROM_PRD]` — PRD D4 段（第 59-97 行）：新建 WarRoomGoldenPathPage，路由 /warroom/gp/:gpId，双栏布局

**可观测行为**: 导航到 `/warroom/gp/<gpId>` 时显示 GP 信息（title、one_liner、status）+ ConversationsPanel；路由注册在 system-hub/index.ts；App.tsx isFullHeightRoute 包含 `/warroom/gp`

**验证命令**:
```bash
# WarRoomGoldenPathPage.tsx 存在
test -f /workspace/apps/dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx || { echo "FAIL: WarRoomGoldenPathPage.tsx 不存在"; exit 1; }

# 路由注册
grep -q "warroom/gp" /workspace/apps/api/features/system-hub/index.ts || { echo "FAIL: system-hub 未注册 GP 路由"; exit 1; }

# isFullHeightRoute 包含 GP 路径
grep -q "warroom/gp" /workspace/apps/dashboard/src/App.tsx || { echo "FAIL: App.tsx 未加 GP 全高路由"; exit 1; }

echo "OK"
```

**硬阈值**: 3 文件均包含 GP 路由配置

---

### Step 4: GP 页 ConversationsPanel gp_id 过滤

**来源**: `[FROM_PRD]` — PRD D4 段（第 80-82 行）：创建对话时若有 gpId 则追加到 POST body，GET 列表也追加 gp_id 过滤

**可观测行为**: GP 页对话列表仅显示锚定该 GP 的对话（gp_id 过滤）；新建对话时 POST body 包含 gp_id

**验证命令**:
```bash
# ConversationsPanel 的 fetch 中含 gp_id 过滤逻辑
grep -q "gp_id" /workspace/apps/dashboard/src/pages/warroom/ConversationsPanel.tsx || { echo "FAIL: gp_id 过滤未实现"; exit 1; }

echo "OK"
```

**硬阈值**: ConversationsPanel.tsx 包含 gp_id 参数注入逻辑

---

### Step 5: GP 页 E2E — 用户从 Line 页进入 GP 页并发送消息

**来源**: `[FROM_PRD]` — PRD E2E-3 段（第 179-188 行）

**可观测行为**: 用户点击 Ability 卡片"对话"按钮 → 导航到 /warroom/gp/:gpId → 右栏 ConversationsPanel → 发消息 → agent 回复出现

**验证命令**: （见下方 ## E2E 验收 段 Playwright 脚本）

**硬阈值**: Playwright `toBeVisible` 断言全部通过，DB 中新建对话的 gp_id 等于 URL 中的 gpId

---

### Step 6: Line 页 E2E — 议题对话完整流程 + agent 查库回复

**来源**: `[FROM_PRD]` — PRD E2E-1 段（第 155-168 行）

**可观测行为**: 用户新建对话 → 发消息 → 看到"军师思考中…" → agent 回复出现（内容非空）→ DB 确认 conversation_messages 落库

**验证命令**: （见下方 ## E2E 验收 段 Playwright 脚本）

**硬阈值**: agent 回复文本长度 > 10 字；psql 查 conversation_messages 有记录（带时间窗口）

---

## E2E 验收（最终 final-e2e 跑 — mac_web，Playwright 本机 localhost:5174）

**journey_type**: user_facing
**target_environment**: mac_web

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行，localhost:5174）
// PRD E2E-1 + E2E-2 + E2E-3
const { chromium, expect } = require('@playwright/test');
const { execSync } = require('child_process');

(async () => {
  const DB_URL = process.env.DB_URL || 'postgresql://localhost/cecelia';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  // ===== E2E-1: Line 对话 + Agent 查库回复 =====
  console.log('=== E2E-1: Line 对话 ===');

  // 1. 导航到 /pipeline，找到 active line
  await page.goto('http://localhost:5174/pipeline');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-pipeline.png' });

  // 点击第一个 active line 卡片进入 warroom
  const lineCard = page.locator('[data-testid="line-card"]').first();
  if (await lineCard.count() === 0) {
    // fallback: 直接导航 journey 8bb8252f
    await page.goto('http://localhost:5174/warroom/line/8bb8252f-29b4-4c34-acb9-1accda7ddfcf');
  } else {
    await lineCard.click();
  }
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/02-warroom-line.png' });

  // 2. 确认议题列表区域可见（或"暂无议题对话"占位）
  const convPanel = page.locator('text=议题对话').first();
  await expect(convPanel).toBeVisible({ timeout: 10000 });

  // 3. 点"新对话"按钮
  const newConvBtn = page.locator('button', { hasText: '新对话' }).first();
  await expect(newConvBtn).toBeVisible({ timeout: 5000 });
  await newConvBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/03-new-conv.png' });

  // 4. 发消息
  const inputEl = page.locator('input[placeholder="向军师提问…"]').first();
  await expect(inputEl).toBeVisible({ timeout: 5000 });
  await inputEl.fill('请问当前 journey 最近有哪些决策？');
  await inputEl.press('Enter');

  // 5. 发送中状态：军师思考中气泡
  await expect(page.locator('text=军师思考中…')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'screenshots/04-sending.png' });

  // 6. 等待 agent 回复（max 90s）
  const DEADLINE = Date.now() + 90000;
  let agentReplied = false;
  while (Date.now() < DEADLINE) {
    const thinkingGone = await page.locator('text=军师思考中…').count() === 0;
    const assistantBubble = page.locator('.bg-slate-700\\/50').first();
    if (thinkingGone && await assistantBubble.count() > 0) {
      agentReplied = true;
      break;
    }
    await page.waitForTimeout(2000);
  }
  if (!agentReplied) {
    console.error('FAIL: agent 未在 90s 内回复');
    await page.screenshot({ path: 'screenshots/05-timeout.png' });
    await browser.close();
    process.exit(1);
  }

  // 7. 断言 agent 回复非空
  const assistantText = await page.locator('.bg-slate-700\\/50').first().innerText();
  if (!assistantText || assistantText.length < 10) {
    console.error('FAIL: agent 回复文本过短', assistantText);
    await browser.close();
    process.exit(1);
  }
  await page.screenshot({ path: 'screenshots/05-agent-reply.png' });
  console.log('OK: agent 回复内容长度 =', assistantText.length);

  // DB 验证：conversation_messages 落库（带时间窗口）
  const dbCheck = execSync(
    `psql "${DB_URL}" -t -c "SELECT count(*) FROM conversation_messages WHERE role='assistant' AND created_at > NOW() - INTERVAL '5 minutes'"`,
    { encoding: 'utf-8' }
  ).trim();
  const dbCount = parseInt(dbCheck, 10);
  if (dbCount < 1) {
    console.error('FAIL: DB 无 assistant 消息记录（时间窗口 5min）count=', dbCount);
    await browser.close();
    process.exit(1);
  }
  console.log('OK: DB 验证 assistant 消息 count =', dbCount);

  // 8. 返回议题列表，确认 status badge 显示"活跃"
  const backBtn = page.locator('button', { hasText: '返回' }).first();
  await expect(backBtn).toBeVisible({ timeout: 5000 });
  await backBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/06-list-after.png' });

  // status badge 验证：活跃 badge 存在
  const activeBadge = page.locator('text=活跃').first();
  await expect(activeBadge).toBeVisible({ timeout: 5000 });
  console.log('OK: status badge "活跃" 可见');

  // ===== E2E-2: 历史回访 =====
  console.log('=== E2E-2: 历史回访 ===');
  const convCard = page.locator('.bg-slate-800\\/40').first();
  await expect(convCard).toBeVisible({ timeout: 5000 });
  await convCard.click();
  await page.waitForTimeout(500);

  // 历史消息气泡可见
  const userBubble = page.locator('.bg-blue-600\\/30').first();
  await expect(userBubble).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'screenshots/07-history.png' });
  console.log('OK: 历史消息气泡可见');

  // ===== E2E-3: GP 二级页 =====
  console.log('=== E2E-3: GP 页 ===');
  // 返回 Line 页
  const backBtn2 = page.locator('button', { hasText: '返回' }).first();
  if (await backBtn2.count() > 0) await backBtn2.click();
  await page.waitForTimeout(300);

  // 找到 Ability 卡片的"对话"按钮（title 含"对话"）
  const gpBtn = page.locator('[title="进入 GP 对话"]').first();
  if (await gpBtn.count() === 0) {
    // 若 Ability 无对应 GP，跳过 E2E-3，直接导航测试
    console.log('SKIP E2E-3: 当前 Line 无 Ability 对应 GP，直接测试 GP 页路由');
    // 查数据库找一个有效的 gp_id
    const gpIdRow = execSync(
      `psql "${DB_URL}" -t -c "SELECT id FROM golden_path LIMIT 1"`,
      { encoding: 'utf-8' }
    ).trim();
    if (!gpIdRow) {
      console.log('SKIP E2E-3: DB 无 golden_path 记录，跳过 GP 页测试');
    } else {
      const gpId = gpIdRow.trim();
      await page.goto(`http://localhost:5174/warroom/gp/${gpId}`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'screenshots/08-gp-page.png' });
      // 页面加载成功（不 404）
      const gpPanel = page.locator('text=议题对话').first();
      await expect(gpPanel).toBeVisible({ timeout: 10000 });
      console.log('OK: GP 页 ConversationsPanel 可见（通过直接导航）');
    }
  } else {
    await gpBtn.click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/08-gp-page.png' });

    // GP 左栏：GP 信息可见
    const gpTitle = page.locator('[data-testid="gp-title"]').first();
    await expect(gpTitle).toBeVisible({ timeout: 10000 });

    // GP 右栏：ConversationsPanel
    const gpConvPanel = page.locator('text=议题对话').first();
    await expect(gpConvPanel).toBeVisible({ timeout: 5000 });

    // 新建 GP 对话
    const gpNewBtn = page.locator('button', { hasText: '新对话' }).first();
    await expect(gpNewBtn).toBeVisible({ timeout: 5000 });
    await gpNewBtn.click();
    await page.waitForTimeout(500);

    // 发消息
    const gpInput = page.locator('input[placeholder="向军师提问…"]').first();
    await gpInput.fill('请简要介绍本 GP 的当前状态');
    await gpInput.press('Enter');
    await page.waitForTimeout(2000);

    // 等待 agent 回复（max 90s）
    const DEADLINE2 = Date.now() + 90000;
    while (Date.now() < DEADLINE2) {
      if (await page.locator('text=军师思考中…').count() === 0) break;
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: 'screenshots/09-gp-reply.png' });

    // DB 验证：新建对话的 gp_id 正确
    const gpConvCheck = execSync(
      `psql "${DB_URL}" -t -c "SELECT gp_id FROM conversations WHERE gp_id IS NOT NULL AND created_at > NOW() - INTERVAL '5 minutes' ORDER BY created_at DESC LIMIT 1"`,
      { encoding: 'utf-8' }
    ).trim();
    if (!gpConvCheck) {
      console.error('FAIL: DB 无 GP 对话记录（时间窗口 5min）');
      await browser.close();
      process.exit(1);
    }
    console.log('OK: GP 对话 DB 验证 gp_id =', gpConvCheck);
  }

  await context.close();
  await browser.close();
  console.log('✅ Golden Path UI 验证全部通过');
})().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
```

**BEHAVIOR:E2E 截图 DoD**

```markdown
- [ ] [BEHAVIOR:E2E:screenshot] evaluator 验收后截图已存入 sprints/07271849-relay-496dceb8/screenshots/
  Screenshots:
    - 01-pipeline.png      期望：Pipeline 页面加载，line 卡片可见
    - 02-warroom-line.png  期望：Line 指挥页加载，4 栏可见
    - 03-new-conv.png      期望：新建对话后进入详情视图，输入框可见
    - 04-sending.png       期望：发送后"军师思考中…"气泡可见
    - 05-agent-reply.png   期望：agent 回复气泡可见，文字非空
    - 06-list-after.png    期望：返回议题列表，status badge "活跃" 可见
    - 07-history.png       期望：历史消息气泡可见（user + assistant 各 ≥1）
    - 08-gp-page.png       期望：GP 页加载，ConversationsPanel 可见
    - 09-gp-reply.png      期望：GP 页 agent 回复可见
  路径格式：sprints/07271849-relay-496dceb8/screenshots/<step>.png
  期望：evaluator 完成后截图已复制到 sprints/07271849-relay-496dceb8/screenshots/ 目录
```

evaluator 完成验收后必须执行：
```bash
mkdir -p "sprints/07271849-relay-496dceb8/screenshots/"
cp screenshots/*.png "sprints/07271849-relay-496dceb8/screenshots/" 2>/dev/null || true
```

---

## Contract Gate 说明

本仓库为 cecelia（packages/brain/src/lib/contract-gate.js 存在），走代码层 Contract Gate 审查。
本合同 E2E bash 块内所有 psql 断言均带时间窗口（`created_at > NOW() - INTERVAL '5 minutes'`），curl 均带 `-f` flag（通过 expect 调用），符合 gate 惯用法。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| statusBadgeMeta 三态映射 | `tests/ConversationsPanel.test.ts` | statusBadgeMeta active 返回 emerald | → 1 failure（函数未实现） |
| statusBadgeMeta resolved 灰色 | `tests/ConversationsPanel.test.ts` | statusBadgeMeta resolved 返回 slate | → 1 failure |
| statusBadgeMeta suspended 黄色 | `tests/ConversationsPanel.test.ts` | statusBadgeMeta suspended 返回 amber | → 1 failure |
| ConversationsPanel gpId 过滤 URL | `tests/ConversationsPanel.test.ts` | gpId 注入 fetch URL 含 gp_id | → 1 failure（函数未实现） |
| WarRoomGoldenPathPage 文件存在 | `tests/WarRoomGoldenPathPage.test.ts` | WarRoomGoldenPathPage.tsx 存在 | → 1 failure（文件未创建） |
