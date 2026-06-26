# Sprint Contract Draft (Round 1)

> Sprint: Dashboard 首页 Harness 工厂线贯通状态标识
> journey_type: **user_facing** ｜ target_environment: **mac_web**（本机 Playwright + 校验 staging:5223 / live:5211）

## 已知约束（来自回归测试）

- [scripts/dashboard-staging-selfcheck.sh] staging slot（:5223）必须 HTTP 200、index.html 含 `id="root"`、assets 引用全部可达 → promote 前自检门
- [scripts/dashboard-slot-server.cjs] staging/live 都是**静态 dist 直出**（SPA fallback 回 index.html）；固定文字属 React 渲染内容，会被打进 `dist/assets/*.js` bundle，**不在裸 index.html 里** → 文字落地 oracle 必须验 bundle 内容或浏览器渲染，不能 grep index.html
- [scripts/promote-dashboard.sh] promote = 原子换入本机 live dist/（OrbStack 挂载 → :5211 立即生效）；无 `.staging-pending` 拒绝 promote

## 技术上下文（Step 1.1 推导）

- Brain（localhost:5221）本轮不可达 → 跳过 registry 推导，按 PRD 字面 + 现有 dashboard 约定（`data-testid` 选择器、`@testing-library/react` + `happy-dom` + `vitest`、Vite 静态构建）。新组件命名标 `[NEW_PATTERN]`。
- 测试栈：`apps/dashboard` 已有 `vitest` / `@testing-library/react` / `happy-dom`；本 sprint 红测试用纯 fs 断言（不依赖根目录解析 DOM 库），保证从仓库根可跑。

## Response Schema（推导来源: PRD 字面）

**N/A — 任务无 HTTP 响应**（纯静态前端标识，不新增/改 Brain API，不写 DB）。
本 sprint 的 oracle 是「构建产物含文字 + 浏览器可见 + 生产 promote 真生效」，不是 JSON schema。Reviewer 第 6 维按 UI/接缝 oracle 审，不按 jq -e schema 审（PRD 无 HTTP 响应 → 第 6 维 schema 项自动满分）。

---

## 固定文字契约（不可改写，逐字）

```
Cecelia Harness 工厂线已贯通
```

- 稳定选择器：`data-testid="harness-pipeline-status"`（[NEW_PATTERN]，沿用 dashboard 现有 data-testid 约定）
- 落点：`apps/dashboard/src/` 首页常驻可见区（App 壳层；generator 定具体落点，须保证首屏可见、不依赖任何接口数据）
- 暗/亮主题均可见（边界情况硬条款）

---

## Golden Path

[主理人开 live:5211 首页] → [首页渲染固定状态标识区] → [首页可见处出现 "Cecelia Harness 工厂线已贯通"]
（背后接缝：generator 写码 → CI 全绿 → 合 main → staging:5223 部署 → staging 自检 → promote → live:5211 生效）

### Step 1: 主理人在浏览器打开 live dashboard（:5211）首页
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步「[入口] 主理人在浏览器打开 live dashboard（:5211）首页」

**可观测行为**: live dashboard 服务在线，首页可访问（HTTP 200）。

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:5211/")
[ "$CODE" = "200" ] || { echo "FAIL: live:5211 首页非 200 (=$CODE)"; exit 1; }
echo OK
```

**硬阈值**: live:5211 `/` 返回 HTTP 200。

---

### Step 2: 首页渲染固定状态标识区（文字打进生产构建产物）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步「[系统处理] 首页加载，渲染固定状态标识区」+「预期受影响文件 App.tsx」

**可观测行为**: 构建产物（dist bundle）确实包含逐字固定文字（证明 generator 真把文字写进首页常驻组件并被打包，而非空实现/假绿）。

**验证命令**:
```bash
# 本机 build 后，固定文字必须出现在打包后的 JS bundle 里（React 文本编进 assets/*.js）
cd apps/dashboard && (npm ci --prefer-offline >/dev/null 2>&1 || npm install >/dev/null 2>&1)
npm run build >/dev/null 2>&1 || { echo "FAIL: dashboard build 失败"; exit 1; }
grep -rq "Cecelia Harness 工厂线已贯通" dist/assets/ || { echo "FAIL: 构建产物未含固定文字（generator 未落地）"; exit 1; }
echo OK
```

**硬阈值**: `dist/assets/` 至少一个文件含逐字固定文字（grep -q exit 0）。

---

### Step 3: 首页可见处出现固定文字 "Cecelia Harness 工厂线已贯通"
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步「[出口/可观测结果] 首页可见处出现固定文字」+「边界情况 暗/亮主题下均需可见」

**可观测行为**: 主理人在首页能**看见**该行文字（非 display:none），暗色/亮色主题下均可见。

**验证命令**（Playwright 本机渲染，详见 `## E2E 验收`）:
```javascript
const el = page.getByTestId('harness-pipeline-status');
await expect(el).toBeVisible({ timeout: 10000 });
await expect(el).toHaveText('Cecelia Harness 工厂线已贯通');
// 暗/亮主题各断言一次 toBeVisible
```

**硬阈值**: `getByTestId('harness-pipeline-status')` 在默认 + 暗色 + 亮色三态下 `toBeVisible`，且 `toHaveText` 逐字相等。

---

### Step 4【接缝】: staging dashboard（:5223）真部署、可预览（promote 前置门）
**来源**: `[FROM_PRD]` — PRD「E2E 验收」期望点 1「staging dashboard（:5223）HTTP 200 可访问、可构建」

**可观测行为**: staging slot 服务真起来，主理人能在 :5223 预览到新版本（接缝：CI 绿 ≠ staging 真起；必须真打 :5223）。

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:5223/")
[ "$CODE" = "200" ] || { echo "FAIL: staging:5223 非 200 (=$CODE) — staging 未真部署"; exit 1; }
echo OK
```

**硬阈值**: staging:5223 `/` 返回 HTTP 200。

---

### Step 5【接缝】: promote 后 live:5211 生产真出固定文字（最终生效证据）
**来源**: `[FROM_PRD]` — PRD「E2E 验收」期望点 2「promote 后 live dashboard（:5211）首页 HTTP 200」+ 期望点 3「live 首页可见处出现固定文字」

**可观测行为**: promote 把含文字的 dist 换入生产后，live:5211 实际服务的 bundle 含逐字固定文字（证明工厂线真的把代码推到生产，而非只在本机/CI 绿）。

**验证命令**（真目标 = 生产 live:5211 实际 serve 的产物）:
```bash
# 取 live 首页 → 提取它引用的 JS bundle → 验该 bundle 真含固定文字
IDX=$(curl -sf --max-time 10 "http://localhost:5211/") || { echo "FAIL: live:5211 首页不可达"; exit 1; }
ASSET=$(printf '%s' "$IDX" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
[ -n "$ASSET" ] || { echo "FAIL: live 首页未引用 JS bundle"; exit 1; }
curl -sf --max-time 10 "http://localhost:5211${ASSET}" | grep -q "Cecelia Harness 工厂线已贯通" \
  || { echo "FAIL: live:5211 生产 bundle 未含固定文字 — promote 未把新代码推上生产"; exit 1; }
echo OK
```

**硬阈值**: live:5211 首页引用的 JS bundle 含逐字固定文字。

---

## 接缝清单（v9.3 — 碰真实世界的点 + 真目标验证方式）

> 逻辑断言（环境无关，CI/本机可验）：Step 2 构建产物含文字、Step 3 本机 Playwright 渲染可见 → CI/本机绿即真 done。
> 接缝断言（环境相关，**CI 绿 ≠ done，必须真目标验**）：

| # | 碰真实世界的点 | 真目标验证方式 | 未真验前状态 |
|---|---|---|---|
| 1 | **staging:5223 真部署** | curl :5223 真返回 200（staging slot 真起来，主理人能真预览） | `logic-done-pending` |
| 2 | **promote → live:5211 真生效** | curl live:5211 首页 → 取其引用的 JS bundle → 真含逐字固定文字（生产实际 serve 的产物，非本机 dist、非 CI 绿） | `logic-done-pending` |
| 3 | **CI 全绿是接缝前提，不是 done** | 工厂线 CI（workspace-ci.yml）全绿 + 合 main 触发 staging 部署，真观测 #1 #2 才算 done | `logic-done-pending` |

**done 判定**：接缝 #1 #2 在真目标（:5223 / :5211）真观测到 → done；任一未真验 → 整体标 `logic-done-pending`，**不得标 done**。
**禁止写死环境假设值**：本 sprint 无坐标/UIA/env 假设值；端口（5211/5223）来自现有 promote 脚本与 PRD，非臆造。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=mac_web）

**journey_type**: user_facing
**target_environment**: mac_web（Playwright 本机 + 校验 staging:5223 / live:5211 接缝）

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行）
// 逻辑层：build dashboard → vite preview :5174 → Playwright 断言文字可见（暗/亮主题）
// 接缝层：curl staging:5223 / live:5211，验生产 promote 真生效
const { chromium, expect } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const path = require('path');

const DASH = path.resolve(__dirname, '../../apps/dashboard');
const PREVIEW_PORT = 5174;
const FIXED_TEXT = 'Cecelia Harness 工厂线已贯通';

function httpCode(url) {
  try { return execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${url}"`).toString().trim(); }
  catch { return '000'; }
}

(async () => {
  // ── 逻辑层：本机构建 + 预览，证明文字真渲染、真可见（环境无关）──
  execSync('npm ci --prefer-offline || npm install', { cwd: DASH, stdio: 'inherit' });
  execSync('npm run build', { cwd: DASH, stdio: 'inherit' });

  const server = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--host'], { cwd: DASH });
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (httpCode(`http://localhost:${PREVIEW_PORT}/`) === '200') { ready = true; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ready) { server.kill('SIGKILL'); console.error('FAIL: vite preview 未就绪'); process.exit(1); }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(`http://localhost:${PREVIEW_PORT}/`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/01-initial.png' });

    const el = page.getByTestId('harness-pipeline-status');
    await expect(el).toBeVisible({ timeout: 10000 });
    await expect(el).toHaveText(FIXED_TEXT);

    // 暗/亮主题各验一次可见（边界情况硬条款）
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(el).toBeVisible();
    await page.screenshot({ path: 'screenshots/02-action.png' });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(el).toBeVisible();
    await page.screenshot({ path: 'screenshots/03-result.png' });

    console.log('✅ 逻辑层：本机构建产物文字可见（暗/亮主题）');
  } finally {
    await browser.close();
    server.kill('SIGKILL');
  }

  // ── 接缝层：真目标验证（staging:5223 / live:5211），CI 绿 ≠ done ──
  const sc = httpCode('http://localhost:5223/');
  if (sc !== '200') { console.error(`FAIL[接缝#1]: staging:5223 非 200 (=${sc}) — staging 未真部署`); process.exit(1); }

  const lc = httpCode('http://localhost:5211/');
  if (lc !== '200') { console.error(`FAIL[接缝#2]: live:5211 非 200 (=${lc}) — promote 未生效`); process.exit(1); }

  // live 生产 bundle 真含文字（证明 promote 把新代码推上生产）
  const idx = execSync('curl -sf --max-time 10 "http://localhost:5211/"').toString();
  const asset = (idx.match(/\/assets\/[A-Za-z0-9._-]+\.js/) || [])[0];
  if (!asset) { console.error('FAIL[接缝#2]: live 首页未引用 JS bundle'); process.exit(1); }
  const bundle = execSync(`curl -sf --max-time 10 "http://localhost:5211${asset}"`).toString();
  if (!bundle.includes(FIXED_TEXT)) {
    console.error('FAIL[接缝#2]: live:5211 生产 bundle 未含固定文字 — promote 未把新代码推上生产');
    process.exit(1);
  }

  console.log('✅ 接缝层：staging:5223 + live:5211 promote 真生效，生产真出固定文字');
  console.log('✅ Golden Path 端到端验证通过');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
```

**通过标准**: 脚本 exit 0（逻辑层 Playwright 三态可见 + 接缝层 staging/live 200 + live bundle 含文字）。
**接缝层失败即整体 FAIL**：staging:5223 / live:5211 任一不可达或 live bundle 不含文字 → promote 未真生效 → 标 `logic-done-pending`，禁止当 done。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 首页固定状态标识 + 工厂线贯通 | `tests/harness-pipeline-status.test.ts` | 组件存在 / 含逐字文字 + testid / App 壳层挂载 | 组件文件未创建 → 3 个 it 全 FAIL |
