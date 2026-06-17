# Sprint Contract Draft (Round 1)

> Sprint: Harness Pipeline Cockpit · Phase 1 — TaskPrdPage 显示完整 PrepPRD
> journey_type: user_facing · target_environment: mac_web

## 已知约束（来自回归测试）

- [apps/dashboard/src/pages/tasks/TaskPrdPage.test.tsx] → 渲染 title 和 description（loaded state）
- [apps/dashboard/src/pages/tasks/TaskPrdPage.test.tsx] → 404 → 显示 task not found
- [apps/dashboard/src/pages/tasks/TaskPrdPage.test.tsx] → 网络错误 → 显示通用错误
- [apps/dashboard/src/pages/tasks/TaskPrdPage.test.tsx] → description 空时 fallback 到 payload.prd_summary

> 这些是已存在的回归约束：本次改动**不得回归**它们（错误态、fallback 链尾、PR 链接、状态徽章必须仍然工作）。新增的 prep_prd_body 优先级在 fallback 链最前端，旧链作为退化路径保留。

## Response Schema（推导来源: PRD 字面）

**N/A — 本任务无新增 HTTP 响应。**

本 Sprint 是纯前端渲染改动：复用既有 `GET /api/brain/tasks/:id`（不改后端、不新增端点），ASSUMPTION 明确「只读取与渲染，不改写入侧」。Reviewer 第 6 维 verification_oracle_completeness 中 HTTP schema 部分自动满分；oracle 完整性改由下方 BEHAVIOR（vitest 组件断言 + Playwright DOM 断言）承载。

### 数据契约（前端 TypeScript 类型，非 HTTP schema）

`Task.payload` 新增可选字段：
```ts
payload: {
  prd_summary?: string;     // 既有
  prep_prd_body?: string;   // 新增：Harness 写入的完整 PrepPRD Markdown 全文
} | null;
```

`pickPrdContent` 读取优先级（字面，自上而下）：
```
task.payload?.prep_prd_body   // 最高优先：完整 PrepPRD 全文
  → task.description
  → task.prd_content
  → task.payload?.prd_summary
  → ''                        // 全空：显示「无 PRD 内容」提示，不报错不空白
```

**禁用字段名**（不得在代码/断言里替换为这些同义词）：`prepPrd` / `prepPrdBody` / `prep_prd` / `prd_body` / `body`（PRD 字面规定字段名为 `prep_prd_body`，snake_case，与 payload 既有字段风格一致）。

## Golden Path

[用户从 PR body「📋 PRD」链接打开 `/tasks/:id/prd`] → [TaskPrdPage 拉取 task] → [pickPrdContent 优先读 payload.prep_prd_body] → [以 Markdown 渲染完整 PrepPRD 全文（标题/列表/表格成真实 DOM 元素）] → [用户看到有格式的完整 PrepPRD]

---

### Step 1: 用户打开 harness task 的 PRD 页，页面正常加载（不报错、不空白）

**来源**: `[FROM_PRD]` — Golden Path 第 1 步「用户点开一个 harness task 的 PRD 页（TaskPrdPage）」

**可观测行为**: 访问 `/tasks/:id/prd`，页面渲染出 task 标题、状态徽章与 PRD 区块，无 JS 报错、无空白页。

**验证命令**:
```bash
# mac_web Playwright（见 ## E2E 验收 e2e/task-prd.spec.ts）：拦截数据边界注入含 prep_prd_body 的 fixture，
# 导航后断言页面主体可见
# await expect(page.getByTestId('prd-content')).toBeVisible({ timeout: 10000 });
cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "页面加载渲染主体不报错"
# 期望：exit 0
```

**硬阈值**: PRD 主体容器在 10s 内可见。
**验证命令（硬阈值）**: `await expect(page.getByTestId('prd-content')).toBeVisible({ timeout: 10000 })`

---

### Step 2: pickPrdContent 优先读取 payload.prep_prd_body（旧字段被忽略）

**来源**: `[FROM_PRD]` — Golden Path 第 2 步「系统读取 `task.payload.prep_prd_body`（完整 PrepPRD Markdown）；该字段为空时退回旧字段」+ 范围限定第 1 条

**可观测行为**: 当 task 同时有 `payload.prep_prd_body` 和 `description` 时，页面显示 prep_prd_body 全文，**不显示** description 内容。

**验证命令**:
```bash
cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "prep_prd_body 优先于旧字段"
# 期望：exit 0（断言显示 prep_prd_body 内容、不显示 description 旧内容）
```

**硬阈值**: prep_prd_body 文本出现，description 旧文本不出现。
**验证命令（硬阈值）**: 见上 vitest 用例内 `expect(screen.getByText(/PrepPRD 全文/)).toBeInTheDocument()` 且 `expect(screen.queryByText(/OLD-description/)).toBeNull()`

---

### Step 3: 以 Markdown 渲染完整 PrepPRD（标题/列表/表格成真实 DOM，不是 `<pre>` 纯文本）

**来源**: `[FROM_PRD]` — Golden Path 第 3 步「页面以 Markdown 渲染显示完整 PrepPRD……标题/列表/表格按格式呈现（不是 `<pre>` 纯文本）」+ 边界情况第 2 条「含表格/嵌套列表/代码块均按 Markdown 正确渲染」

**可观测行为**: prep_prd_body 中的 `# 标题` 渲染为 `<h1>`（文字为「标题」，DOM 中不出现字面 `# 标题`）；`-` 列表渲染为 `<ul><li>`；GFM 表格渲染为 `<table>`；PRD 主体不再用单一 `<pre>` 包裹原始 Markdown。

**验证命令**:
```bash
cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "Markdown 渲染为真实 DOM 元素"
cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "表格与列表按 Markdown 渲染"
# 期望：两条均 exit 0
```

**硬阈值**: DOM 存在 `<h1>`/`<ul>`/`<table>`，且不存在包裹原始 Markdown 的 `<pre>`。
**验证命令（硬阈值）**: vitest 内 `getByRole('heading', { level: 1 })` 命中、`getByRole('table')` 命中、`queryByText('# Golden Path')`（字面）为 `null`。

---

### Step 4（边界）: prep_prd_body 为空 → 退回旧字段，页面仍显示已有内容

**来源**: `[FROM_PRD]` — 边界情况第 1 条「`payload.prep_prd_body` 不存在或为空 → 退回旧字段，页面仍能显示已有内容（不报错、不空白）」

**可观测行为**: task 无 prep_prd_body 但有 description（或 prd_content / prd_summary）时，页面显示该退化内容，不报错不空白。

**验证命令**:
```bash
cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "prep_prd_body 为空时退回旧字段"
# 期望：exit 0
```

**硬阈值**: 退化字段文本出现在页面。
**验证命令（硬阈值）**: vitest 内 `expect(screen.getByText(/fallback 内容/)).toBeInTheDocument()`

---

### Step 5（回归守卫）: 错误态不回归（404 / 网络错误仍正确显示）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：本次替换渲染层与 fallback 链，必须守住既有错误态行为，防止 Markdown 渲染改动连带破坏 not-found / network-error 路径（已知约束回归保护）。

**可观测行为**: 404 task 显示「Task not found」；fetch 抛错显示「Failed to load task PRD」。

**验证命令**:
```bash
cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "404 与网络错误态不回归"
# 期望：exit 0
```

**硬阈值**: 404 渲染「Task not found」；网络错误渲染「Failed to load task PRD」。

---

## E2E 验收（最终 final-e2e 跑 — mac_web Playwright）

**journey_type**: user_facing
**target_environment**: mac_web

> evaluator 模式 B 在 Mac 本机执行：启动 dashboard（localhost:5174），用 Playwright 真实浏览器打开 `/tasks/<id>/prd`。
> 数据边界（`GET /api/brain/tasks/:id`）由 `page.route` 注入含 `prep_prd_body` 的 fixture——拦截的只是**外部数据获取边界**（后端写入侧本 Sprint 明确不在范围内，见 ASSUMPTION），被测的 Golden Path 核心（pickPrdContent 优先级 + react-markdown 真实渲染管线）全部真实执行，generator 不实现则断言 FAIL。

脚本：`${SPRINT_DIR}/e2e/task-prd.spec.ts`

```javascript
// final-e2e Playwright 脚本（Mac 本机执行，连 localhost:5174）
const { test, expect } = require('@playwright/test');

const TASK_ID = 'e2e-prepprd-task';
const PREP_PRD = [
  '# PrepPRD 全文标题',
  '',
  '## Golden Path',
  '',
  '用户打开 PRD 页 → 看到完整 PrepPRD',
  '',
  '## 前置',
  '',
  '- 前置条件一',
  '- 前置条件二',
  '',
  '## 验收',
  '',
  '| 项 | 期望 |',
  '| --- | --- |',
  '| 渲染 | Markdown |',
].join('\n');

test('打开 harness task PRD 页 → 完整 PrepPRD 以 Markdown 渲染', async ({ page }) => {
  // 1. 拦截外部数据获取边界，注入含 prep_prd_body 的 task fixture
  await page.route(`**/api/brain/tasks/${TASK_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: TASK_ID,
        title: 'E2E PrepPRD Task',
        status: 'in_progress',
        priority: 'P1',
        task_type: 'harness_contract_propose',
        description: 'OLD-description-should-not-show',
        prd_content: null,
        pr_url: null,
        created_at: '2026-06-17T00:00:00Z',
        updated_at: '2026-06-17T00:00:00Z',
        completed_at: null,
        payload: { prep_prd_body: PREP_PRD },
      }),
    })
  );

  // 2. 用户打开 PRD 页
  await page.goto(`http://localhost:5174/tasks/${TASK_ID}/prd`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });

  // 3. 断言：完整 PrepPRD 全文小节标题文字可见（Golden Path / 前置 / 验收）
  await expect(page.getByText('PrepPRD 全文标题')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Golden Path')).toBeVisible();
  await expect(page.getByText('前置')).toBeVisible();
  await expect(page.getByText('验收')).toBeVisible();
  await page.screenshot({ path: 'screenshots/02-action.png' });

  // 4. 断言：是 Markdown 渲染（真实 DOM 元素），而非单一 <pre> 纯文本
  await expect(page.locator('[data-testid="prd-content"] h1')).toHaveCount(1);
  await expect(page.locator('[data-testid="prd-content"] h2').first()).toBeVisible();
  await expect(page.locator('[data-testid="prd-content"] ul li').first()).toBeVisible();
  await expect(page.locator('[data-testid="prd-content"] table')).toHaveCount(1);
  // PRD 主体不再用 <pre> 包裹原始 Markdown（不存在含字面 '# PrepPRD' 的 pre）
  await expect(page.locator('[data-testid="prd-content"] pre', { hasText: '# PrepPRD' })).toHaveCount(0);

  // 5. 旧 description 内容不应出现（prep_prd_body 优先）
  await expect(page.getByText('OLD-description-should-not-show')).toHaveCount(0);

  await page.screenshot({ path: 'screenshots/03-result.png' });
});
```

**PASS 标准**: Playwright exit 0，三张截图生成，全部断言通过。
**FAIL 标准**: 任一断言失败 / 页面空白 / DOM 中无 `<h1>`/`<table>` / PRD 仍为 `<pre>` 原始 Markdown。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（组件层） | `apps/dashboard/src/pages/tasks/TaskPrdPage.prepprd.test.tsx`（同步副本于 `${SPRINT_DIR}/tests/`） | prep_prd_body 优先 / Markdown 渲染 / 表格列表 / fallback / 错误态守卫 | 当前 `<pre>` + pickPrdContent 不读 prep_prd_body → h1/table 断言 + 优先级断言 FAIL |
| Golden Path 端到端（UI 层） | `${SPRINT_DIR}/e2e/task-prd.spec.ts` | 完整 PrepPRD 全文小节可见 + DOM 真实 Markdown 元素 | 同上 → Playwright DOM 断言 FAIL |
