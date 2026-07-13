# Sprint Contract Draft (Round 1)

## Golden Path

[用户打开 Harness 进度页] → [系统请求 relay-runs API] → [渲染七棒进度条列表] → [15秒自动刷新]

---

## 已知约束（来自回归测试）

- [HarnessPipelineDetailPage.langgraph.test.tsx] → langgraph.enabled=true 时渲染 "LangGraph" badge
- [HarnessPipelineDetailPage.test.ts] → 页面正常加载、API 请求失败时展示错误态
- [RoadmapPage.test.tsx] → 渲染页面标题、列表为空时展示空态
- （relay-progress 暂无历史已完成 ability 回归约束）

---

## Response Schema（推导来源: PRD 字面）

### Endpoint: GET /api/brain/orchestrator/relay-runs

**Success (HTTP 200)**:
```json
[
  {
    "initiative_id": "<string>",
    "phase": "<string>",
    "judge_verdict": "<string|null>",
    "cost_usd": "<number|null>"
  }
]
```

- `initiative_id` (string, 必填): 来源——PRD 明确（ASSUMPTION 段）
- `phase` (string, 必填): 来源——PRD 明确；值可能含 `A_` 前缀，UI 需剥离
- `judge_verdict` (string|null, 可选): 来源——PRD 明确（ASSUMPTION 段）
- `cost_usd` (number|null, 可选): 来源——PRD 明确（ASSUMPTION 段）

**禁用字段名**: [`id`, `verdict`, `cost`, `phase_label`, `status`]

**Empty (HTTP 200)**:
```json
[]
```
空数组 = 无活跃 relay，UI 显示空态文案"暂无进行中的 relay"

**Error (HTTP 4xx/5xx)**:
```json
{"error": "<string>"}
```

---

## 接缝清单

本 sprint 碰真实世界的接缝：

1. **GET /api/brain/orchestrator/relay-runs**：Vite proxy `/api/brain` → `localhost:5221`；E2E 必须在 localhost:5174 真实 Playwright 环境跑，断言 DOM 渲染（不得用 page.route() stub）
2. **15秒自动刷新**：setInterval 触发重新 fetch；E2E 用 Playwright fake timer 或等待第二次请求确认

以上两条均为「逻辑断言」（浏览器内代码逻辑），通过 mac_web Playwright 真实浏览器验证即满足接缝要求。无真机 RPA / 生产 env 接缝。

---

## Golden Path Steps

### Step 1: 用户打开「Harness 进度」页面

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步「用户打开 Cecelia Dashboard 的「Harness 进度」页」

**可观测行为**: 浏览器导航到 `/relay-progress`，页面标题或进度容器可见；系统向 `/api/brain/orchestrator/relay-runs` 发起 GET 请求

**验证命令**:
```bash
# mac_web Playwright — 断言进度容器存在
await page.goto('http://localhost:5174/relay-progress');
await page.waitForLoadState('networkidle');
await expect(page.locator('[data-testid="relay-progress-container"]')).toBeVisible({ timeout: 10000 });
```

**硬阈值**: 页面加载后 10s 内 `relay-progress-container` 可见；API 请求状态码为 200

---

### Step 2: 系统请求 relay-runs API 并渲染七棒进度条

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步「系统请求 GET /api/brain/orchestrator/relay-runs → 渲染活跃 initiative 列表」

**可观测行为**: 当 API 返回非空列表时，每个 initiative 显示一行七段横向进度条，段标签依次：`planning → gan → generate → evaluate → judge → merge → report`；当前 phase 高亮，已完成段实色，未到段灰色

**验证命令**:
```bash
# Playwright — 断言七段 phase 标签存在（DOM 中有七个 phase 标签元素）
const phases = ['planning', 'gan', 'generate', 'evaluate', 'judge', 'merge', 'report'];
for (const phase of phases) {
  await expect(page.locator(`[data-testid="phase-label-${phase}"]`).first()).toBeVisible({ timeout: 5000 });
}
```

**硬阈值**: DOM 中 7 个 phase 标签全部可见（至少有一条 relay 时）

---

### Step 3: 每行显示 initiative_id 短码 + phase + verdict + cost

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步「每行附 initiative_id 短码（前 8 位）+ 当前 phase 文字 + verdict（若有）+ cost（若有）」

**可观测行为**: 每条 relay 行显示 initiative_id 前 8 位字符串；phase 文字剥离 `A_` 前缀后显示；若 judge_verdict 非 null 则显示；若 cost_usd 非 null 则显示

**验证命令**:
```bash
# Playwright — 断言 initiative 短码渲染（api 返回 initiative_id 前8位出现在页面）
# 实际短码由 E2E 脚本从 API 响应中动态取得
const apiResp = await page.request.get('http://localhost:5221/api/brain/orchestrator/relay-runs');
const runs = await apiResp.json();
if (runs.length > 0) {
  const shortId = runs[0].initiative_id.substring(0, 8);
  await expect(page.locator(`text=${shortId}`)).toBeVisible({ timeout: 5000 });
}
```

**硬阈值**: API 返回有数据时，第一条 initiative_id 前 8 位必须出现在 DOM 中

---

### Step 4: phase 含 A_ 前缀时 UI 剥离展示

**来源**: `[FROM_PRD]` — PRD 边界情况「phase 值含前缀（如 `A_planning`）：UI 剥离前缀显示为 `planning`」

**可观测行为**: 当 phase 值为 `A_planning` 时，页面显示 `planning`，不显示 `A_planning`

**验证命令**:
```bash
# vitest 单元测试（逻辑断言，环境无关）
# stripPhasePrefix('A_planning') === 'planning'
# stripPhasePrefix('planning') === 'planning'
# stripPhasePrefix('A_generate') === 'generate'
# 见 tests/relay-progress.test.tsx
```

**硬阈值**: `stripPhasePrefix` 函数对含 `A_` 前缀输入返回剥离后字符串

---

### Step 5: 无活跃 relay 时显示空态文案

**来源**: `[FROM_PRD]` — PRD 边界情况「无活跃 relay：显示"暂无进行中的 relay"空态文案」

**可观测行为**: API 返回空数组时，页面显示文案「暂无进行中的 relay」，不渲染进度条行

**验证命令**:
```bash
# Playwright — mock fetch 返回 [] → 断言空态文案
# （在真实 Playwright 环境中，需确保 API 无活跃数据，或在 Playwright spec 中拦截——
#   注意：不使用 page.route() stub，空态逻辑通过 vitest 单元测试覆盖）
await expect(page.locator('[data-testid="relay-progress-empty"]')).toBeVisible({ timeout: 5000 });
# 期望文案
await expect(page.locator('[data-testid="relay-progress-empty"]')).toHaveText('暂无进行中的 relay');
```

**硬阈值**: 空态文案 `暂无进行中的 relay` 可见

---

### Step 6: API 请求失败时显示错误提示

**来源**: `[FROM_PRD]` — PRD 边界情况「API 请求失败：显示错误提示，不崩溃」以及 NFR「API 失败需在页面显示错误提示，不静默失败」

**可观测行为**: 当 fetch 失败时，页面渲染错误提示区域，页面不崩溃（无 React Error Boundary 触发），进度条不渲染

**验证命令**:
```bash
# vitest 单元测试（逻辑断言）
# fetch 返回 !ok → 组件 state.error 非 null → 渲染 [data-testid="relay-progress-error"]
# 见 tests/relay-progress.test.tsx
```

**硬阈值**: fetch 失败时错误提示元素可见，不 throw

---

### Step 7: 页面每 15 秒自动刷新

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步「页面每 15 秒自动刷新，进度条随 relay 推进移动」、NFR「自动刷新间隔 15 秒（PrepPRD 明确）」

**可观测行为**: 页面组件使用 `setInterval` 或 `useEffect` 依赖每 15000ms 重新调用 relay-runs API

**验证命令**:
```bash
# 静态锚点检查（grep 级回归防线）
node -e "
const c = require('fs').readFileSync(
  'apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx', 'utf8'
);
if (!c.includes('15000')) { console.error('FAIL: 未找到 15000ms 刷新间隔'); process.exit(1); }
if (!c.includes('relay-runs')) { console.error('FAIL: 未找到 relay-runs 端点引用'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 组件代码含 `15000`（毫秒）刷新间隔常量；组件代码引用 `relay-runs` 端点

---

## E2E 验收（最终 final-e2e 跑 — mac_web 模板）

**journey_type**: user_facing
**target_environment**: mac_web（Playwright 本机真实浏览器，localhost:5174）

<!-- GOLDEN_SMOKE_ABILITY_SLUG: relay-progress-dashboard -->
<!-- GOLDEN_SMOKE_TARGET_ENV: mac_web -->

<!-- GOLDEN_SMOKE_SCENARIO: relay-progress-happy-path -->
### Scenario: 有活跃 relay 时渲染进度条

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行，localhost:5174）
// 文件：sprints/07050450-relay-progress-dashboard/tests/e2e-relay-progress.spec.ts
const { chromium, expect, request } = require('@playwright/test');

(async () => {
  // 1. 先查真实后端，确认有无活跃 relay
  const apiContext = await request.newContext();
  const apiResp = await apiContext.get('http://localhost:5221/api/brain/orchestrator/relay-runs');
  if (!apiResp.ok()) {
    console.error('FAIL: relay-runs API 返回非 2xx', apiResp.status());
    process.exit(1);
  }
  const runs = await apiResp.json();
  console.log(`relay-runs 返回 ${runs.length} 条数据`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // 2. 导航到进度页
  await page.goto('http://localhost:5174/relay-progress');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'sprints/07050450-relay-progress-dashboard/screenshots/01-initial.png' });

  // 3. 断言进度容器可见
  await expect(page.locator('[data-testid="relay-progress-container"]')).toBeVisible({ timeout: 10000 });

  if (runs.length > 0) {
    // 4a. 有数据：断言七段 phase 标签存在
    const phases = ['planning', 'gan', 'generate', 'evaluate', 'judge', 'merge', 'report'];
    for (const phase of phases) {
      await expect(page.locator(`[data-testid="phase-label-${phase}"]`).first()).toBeVisible({ timeout: 5000 });
    }
    await page.screenshot({ path: 'sprints/07050450-relay-progress-dashboard/screenshots/02-phases.png' });

    // 5. 断言 initiative 短码渲染
    const shortId = runs[0].initiative_id.substring(0, 8);
    await expect(page.locator(`text=${shortId}`)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'sprints/07050450-relay-progress-dashboard/screenshots/03-short-id.png' });
  } else {
    // 4b. 无数据：断言空态文案
    await expect(page.locator('[data-testid="relay-progress-empty"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="relay-progress-empty"]')).toHaveText('暂无进行中的 relay');
    await page.screenshot({ path: 'sprints/07050450-relay-progress-dashboard/screenshots/02-empty.png' });
    console.log('空态验证通过');
  }

  await context.close();
  await browser.close();
  await apiContext.dispose();
  console.log('✅ Golden Path UI 验证通过');
})();
```

<!-- GOLDEN_SMOKE_SCENARIO: relay-progress-empty-state -->
### Scenario: 无活跃 relay 时显示空态文案（单元测试覆盖）

由 `tests/relay-progress.test.tsx` vitest 覆盖（fetch mock 返回 `[]`，断言空态元素可见并含文案「暂无进行中的 relay」）。

<!-- GOLDEN_SMOKE_SCENARIO: relay-progress-phase-strip -->
### Scenario: A_ 前缀剥离逻辑（单元测试覆盖）

由 `tests/relay-progress.test.tsx` vitest 覆盖（`stripPhasePrefix('A_planning')` === `'planning'`）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/relay-progress.test.tsx` | 前缀 / 空态 / 错误态 / 15 秒 | → 4+ failures（RelayProgressPage 未实现时） |
| E2E Playwright | `tests/e2e-relay-progress.spec.ts` | Step 1 | → test failures（页面/API 未实现时） |

---

## Risks

- Risk 1: relay-runs API 端点不可达 → mitigation: E2E 开始前 curl -sf localhost:5221/api/brain/orchestrator/relay-runs 探活；端点 404 则测试 fail-fast
- Risk 2: Vite proxy /api/brain 未配置 → mitigation: generator 需确认 vite.config.ts 中已有 proxy 配置（/api/brain → localhost:5221）
- Risk 3: 空态验证在 CI 中可能无真实数据 → mitigation: 单元测试已用 fetch mock 覆盖空数组 [] 路径，E2E 空态验证为可选
