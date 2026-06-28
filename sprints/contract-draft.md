# Sprint Contract Draft (Round 2) — Dashboard 首页加固定状态标识文字

## Response Schema（推导来源: PRD 字面 — 本次 sprint 无 HTTP 响应接口）

N/A — 任务无 HTTP 响应，仅涉及前端 JSX 硬编码 + Playwright UI 验证。

---

## 接缝清单（v9.3 必填 — 写断言前必答：这功能在哪几个点碰真实世界？）

| # | 接缝点 | 类型 | 真目标验证方式 |
|---|---|---|---|
| 1 | 浏览器渲染可见性 | 接缝断言（环境相关）| Playwright 打开 localhost:5174，DOM 中 `[data-testid="harness-status-banner"]` 可见且文字完整 |

逻辑断言（源码内容检查）：vitest 读文件 — CI 绿 = 真 done  
接缝断言（浏览器渲染）：Final E2E Playwright 真验 — 真机跑绿才 done

---

## 已知约束（来自回归测试）

（暂无 apps/dashboard/ 首页相关已知回归测试约束）

---

## Risks

| # | 风险 | 严重度 | Mitigation |
|---|---|---|---|
| 1 | Generator 将 banner 放入 `{isAuthenticated && ...}` 块内，导致未登录时不可见，违反 PRD"不依赖登录状态"要求 | High | BEHAVIOR 4 增加反向断言：banner 位置不在 isAuthenticated 块内；Final E2E 脚本在未登录状态下（直接访问 localhost:5174 无 session）验证 banner 可见 |

---

## Golden Path

```
[用户打开浏览器访问 localhost:5174]
  → [Dashboard 首页加载（Auth/Instance 初始化完成）]
  → [页面中可见固定文字 "Cecelia Harness 工厂线已贯通"（不依赖登录状态 / 不依赖 API 调用）]
```

---

### Step 1: 用户访问 Dashboard 首页

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步：用户访问 `localhost:5174`

**可观测行为**: 浏览器成功加载 Dashboard，页面标题为 "Perfect21" 或 "Cecelia"

**验证命令**:
```bash
# 确认本地 Dashboard 服务响应（Final E2E 前置检查）
START=$(date +%s); \
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5174"); \
END=$(date +%s); \
[ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE"; exit 1; }; \
[ $((END-START)) -lt 10 ] || { echo "FAIL: 加载超时 $((END-START))s"; exit 1; }; \
echo "OK: HTTP 200, 加载耗时 $((END-START))s"
```

**硬阈值**: HTTP 200，耗时 < 10s

---

### Step 2: 固定文字 "Cecelia Harness 工厂线已贯通" 在页面可见

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步：页面中可见文字 "Cecelia Harness 工厂线已贯通"（固定显示，不依赖登录状态或数据加载）

**可观测行为**: 无论当前登录状态如何，页面 DOM 中存在可见的固定文字 "Cecelia Harness 工厂线已贯通"，定位靠 `data-testid="harness-status-banner"`

**逻辑验证命令**（模式A evaluator，源码层，CI 绿 = 逻辑 done）:
```bash
node -e "
const c = require('fs').readFileSync('/workspace/apps/dashboard/src/App.tsx','utf8');
if (!c.includes('Cecelia Harness 工厂线已贯通')) { console.error('FAIL: 文字未在源码中'); process.exit(1); }
if (!c.includes('data-testid=\"harness-status-banner\"')) { console.error('FAIL: data-testid 缺失'); process.exit(1); }
console.log('OK');
"
```

**行为验证硬阈值**（接缝断言，由 Final E2E 执行，真机 Playwright 跑绿才 done）:
- `data-testid="harness-status-banner"` 元素在 DOM 中可见（`toBeVisible` timeout 10s）
- 文字内容完整匹配 "Cecelia Harness 工厂线已贯通"（`toHaveText` 精确匹配）

---

### Step 3: 文字不依赖动态 API 调用（纯静态渲染）

**来源**: `[FROM_PRD]` — PRD 背景段：文字"不依赖运行时数据"；边界条件：页面刷新后仍然存在（静态渲染，无动态依赖）

**可观测行为**: 源码中文字以 JSX hardcoded 字符串形式存在，实现位于 `apps/dashboard/src/App.tsx` 主布局区域外 auth guard（不在 `{isAuthenticated && ...}` 块内）

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('/workspace/apps/dashboard/src/App.tsx','utf8');
const idx = c.indexOf('harness-status-banner');
if (idx === -1) { console.error('FAIL: 元素不存在'); process.exit(1); }
const ctx = c.slice(Math.max(0, idx-100), idx+200);
if (/useState.*工厂线|useEffect.*工厂线|fetch.*工厂线/.test(ctx)) {
  console.error('FAIL: 发现动态依赖'); process.exit(1);
}
console.log('OK: 静态硬编码确认');
"
```

**硬阈值**: harness-status-banner 附近 300 字符内无 fetch/useState/useEffect 调用

---

### Step 4: 文字在页面刷新后仍然存在

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止 Generator 用 localStorage/sessionStorage 实现导致刷新丢失；确认刷新不丢失是"静态渲染"的可观察验证

**可观测行为**: 用户刷新页面后，文字仍然立即可见，不等待任何异步请求

**验证命令** (Playwright Final E2E 内执行):
```javascript
await page.reload({ waitUntil: 'networkidle' });
await expect(page.locator('[data-testid="harness-status-banner"]')).toBeVisible({ timeout: 10000 });
await expect(page.locator('[data-testid="harness-status-banner"]')).toHaveText('Cecelia Harness 工厂线已贯通');
```

**硬阈值**: 刷新后 10s 内文字可见，内容与 Step 2 完全一致

---

## E2E 验收（Final E2E — target_environment: mac_web）

**journey_type**: user_facing  
**target_environment**: mac_web  
**执行机器**: 本机 Mac，localhost:5174（Cecelia Dashboard 内网，Playwright 本机执行）

```javascript
// final-e2e Playwright 脚本 — sprints/e2e-verify.mjs
// 前提: Dashboard 已启动（cd apps/dashboard && npm run dev），服务在 localhost:5174

const { chromium, expect } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  // Step 1: 导航到 Dashboard 首页（不需要登录，文字在 auth guard 外侧）
  await page.goto('http://localhost:5174');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });

  // Step 2: 验证固定文字可见
  const banner = page.locator('[data-testid="harness-status-banner"]');
  await expect(banner).toBeVisible({ timeout: 10000 });
  await expect(banner).toHaveText('Cecelia Harness 工厂线已贯通');
  await page.screenshot({ path: 'screenshots/02-banner-visible.png' });

  // Step 4: 刷新验证静态渲染（不依赖 session/localStorage）
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="harness-status-banner"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="harness-status-banner"]')).toHaveText('Cecelia Harness 工厂线已贯通');
  await page.screenshot({ path: 'screenshots/03-after-reload.png' });

  await context.close();
  await browser.close();
  console.log('✅ Golden Path 验证通过 — Cecelia Harness 工厂线已贯通');
  process.exit(0);
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
```

**PASS 标准**: 脚本 exit 0，`[data-testid="harness-status-banner"]` 可见且文字精确匹配  
**FAIL 标准**: exit 1 OR 元素不可见 OR `toHaveText` 不匹配

---

**BEHAVIOR:E2E 截图 DoD**（mac_web user_facing sprint 合约必含）

evaluator 验收后截图存入 `${SPRINT_DIR}/screenshots/<step>.png`：
- `01-initial.png`：期望：localhost:5174 加载完成，页面主要内容可见
- `02-banner-visible.png`：期望：固定文字 "Cecelia Harness 工厂线已贯通" 在页面中可见（高亮或明显位置）
- `03-after-reload.png`：期望：刷新后同 02，文字仍可见，内容不变

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 静态文字硬编码 | `tests/harness-status-text.test.ts` | 文字存在 / data-testid / 无动态依赖 / 位置在 AppContent 且不在 isAuthenticated 块内 | → 4 failures（源码未改，文字未添加）|
