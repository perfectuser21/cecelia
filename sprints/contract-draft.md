# Sprint Contract Draft (Round 1) — Cecelia Dashboard 首页固定状态标识文字

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应（纯静态 UI 变更，无新增 API 端点）

---

## 已知约束（来自回归测试）

- [sprints/06171618-harness-pipeline-cockpit/e2e/task-prd.spec.ts] → 访问 `/tasks/:id/prd` 不需 auth mock，路由公开；证明 App.tsx 路由对未登录用户不会全部重定向
- [frontend/e2e/login.spec.ts] → mock 登录成功 → 侧栏渲染（AuthContext 现已改为 LOCAL_ADMIN 自动登录，实际 E2E 无需任何 auth mock）

---

## 接缝清单（v9.3 强制）

| # | 接缝点 | 真实世界位置 | 真目标验证方式 |
|---|---|---|---|
| 1 | localhost:5174 dev server 可访问 | 本机 Vite dev server | E2E 脚本启动前 `curl -sf http://localhost:5174` 返回 200；超时 = FAIL |
| 2 | 浏览器渲染 App.tsx 可见区 | mac_web Playwright headless Chromium | `page.getByTestId('harness-status-banner').isInViewport()` 真实验证 |

> 本 sprint 为纯前端静态 UI 变更，无 DB 写入、无外部 API 调用、无真机 RPA。两个接缝均在 mac_web 本机验证，CI 绿 = 真 done。

---

## Golden Path

[访问 localhost:5174] → [App 渲染认证后布局] → [固定状态文字可见，无需滚动]

---

### Step 1: 用户访问 localhost:5174，Dashboard 加载

**来源**: `[FROM_PRD]` — PRD "Golden Path" 段第一条：「浏览器访问 localhost:5174，完成认证」

**可观测行为**: 浏览器返回 200，Dashboard HTML 正常加载，AuthContext 自动以 LOCAL_ADMIN 身份登录，无重定向到 /login

**验证命令**:
```bash
curl -sf http://localhost:5174 -o /dev/null || { echo "FAIL: Dashboard 未就绪"; exit 1; }
echo "OK: localhost:5174 可访问"
```

**硬阈值**: HTTP 200，curl exit 0

---

### Step 2: App.tsx 认证后布局渲染，侧边栏可见

**来源**: `[FROM_PRD]` — PRD "假设"段：「首页指用户登录 Dashboard 后默认看到的界面，实现位置为 App.tsx 的 authenticated 布局区域（header 内或 main 区域顶部）」

**可观测行为**: Playwright 访问 localhost:5174，networkidle 后认证后布局 DOM 区域渲染完成（`aside` 侧边栏元素存在）

**验证命令**:
```bash
# 模式A — source 层验证认证布局已被 isAuthenticated 门控
grep -q 'isAuthenticated &&' apps/dashboard/src/App.tsx \
  || { echo "FAIL: App.tsx 认证门控不存在"; exit 1; }
echo "OK: 认证门控结构存在"
```

**硬阈值**: grep exit 0

---

### Step 3: 固定状态文字 'Cecelia Harness 工厂线已贯通' 可见，无需滚动

**来源**: `[FROM_PRD]` — PRD "Golden Path" 第 3 条：「页面上存在文字元素，内容精确为 Cecelia Harness 工厂线已贯通，用户无需滚动即可看到」

**可观测行为**: 页面 DOM 中存在内容精确为 `Cecelia Harness 工厂线已贯通` 的文字元素（带 `data-testid="harness-status-banner"`），元素位于初始视口内，无需滚动

**验证命令**:
```bash
grep -q 'Cecelia Harness 工厂线已贯通' apps/dashboard/src/App.tsx \
  || { echo "FAIL: App.tsx 未含目标文字"; exit 1; }
grep -q 'data-testid="harness-status-banner"' apps/dashboard/src/App.tsx \
  || { echo "FAIL: App.tsx 未含 data-testid"; exit 1; }
echo "OK: App.tsx 源码包含目标文字和 testid"
```

**硬阈值**: grep 两条均 exit 0

---

### Step 4: 文字为静态硬编码，不依赖网络请求

**来源**: `[FROM_PRD]` — PRD "边界情况"段：「文字为静态硬编码，无需数据请求，不受网络状态影响」

**可观测行为**: App.tsx 源文件直接内联目标文字，无 API call / useEffect fetch / useState 绑定该文字

**验证命令**:
```bash
# 反向检查：目标文字不在 fetch/useEffect/useState 回调中（静态断言）
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/App.tsx', 'utf8');
if (!c.includes('Cecelia Harness 工厂线已贯通')) {
  console.error('FAIL: 文字不存在'); process.exit(1);
}
// 确认该文字不在 useEffect 内（静态 JSX 而非异步获取）
const effectBlocks = c.match(/useEffect\([^)]*=>[^)]*\)/gs) || [];
if (effectBlocks.some(b => b.includes('Cecelia Harness 工厂线已贯通'))) {
  console.error('FAIL: 文字在 useEffect 内，违反静态硬编码要求'); process.exit(1);
}
console.log('OK: 文字为静态硬编码');
" || exit 1
```

**硬阈值**: node exit 0，文字存在且不在 useEffect 内

---

## E2E 验收（final-e2e — mac_web Playwright 本机真实浏览器，localhost:5174）

**journey_type**: user_facing
**target_environment**: mac_web

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行，需提前启动 Vite dev server）
// 运行方式：node sprints/e2e-verify.js
// 前提：cd apps/dashboard && npm run dev（localhost:5174）已运行
const { chromium, expect } = require('@playwright/test');

(async () => {
  // 0. 前置守卫：dev server 必须就绪
  const http = require('http');
  await new Promise((resolve, reject) => {
    http.get('http://localhost:5174', (res) => {
      if (res.statusCode >= 200 && res.statusCode < 400) resolve(null);
      else reject(new Error('dev server unhealthy status=' + res.statusCode));
    }).on('error', (e) => reject(new Error('dev server 不可访问: ' + e.message)));
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. 访问首页（Auth 自动通过 — LOCAL_ADMIN 自动登录，无需 feishu QR）
  await page.goto('http://localhost:5174');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });

  // 2. 验证认证后布局已渲染（侧边栏存在）
  await expect(page.locator('aside')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/02-layout.png' });

  // 3. 核心断言：固定状态文字精确匹配且在初始视口内
  const banner = page.getByTestId('harness-status-banner');
  await expect(banner).toBeVisible({ timeout: 10000 });
  await expect(banner).toHaveText('Cecelia Harness 工厂线已贯通');
  const inViewport = await banner.isInViewport();
  if (!inViewport) {
    console.error('FAIL: 文字元素不在初始视口内，用户需滚动才可见');
    process.exit(1);
  }
  await page.screenshot({ path: 'screenshots/03-banner-visible.png' });

  // 4. 切换 dark mode，验证元素仍存在于 DOM（PRD 边界情况：light/dark 均可见）
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: 'screenshots/04-dark-mode.png' });
  await expect(banner).toBeVisible({ timeout: 5000 });

  await context.close();
  await browser.close();
  console.log('✅ Golden Path UI 验证通过');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 首页固定状态文字 | `sprints/tests/harness-status-banner.test.ts` | 文字存在 + testid 存在 | → 2 failures（App.tsx 未含目标文字）|
