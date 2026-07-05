/**
 * e2e-relay-progress.spec.ts — Relay 进度条 Dashboard E2E 验收
 * target_environment: mac_web（Playwright 本机，localhost:5174）
 *
 * 覆盖 Golden Path：
 *   Scenario 1: 有活跃 relay 时渲染七棒进度条 + initiative 短码
 *   Scenario 2: 无活跃 relay 时显示空态文案（API 无数据时自动走此分支）
 *
 * 运行方式：
 *   npx playwright test sprints/07050450-relay-progress-dashboard/tests/e2e-relay-progress.spec.ts
 *
 * 前提：
 *   - Cecelia Dashboard 已在 localhost:5174 运行（VITE_SKIP_AUTH=true）
 *   - Brain API 已在 localhost:5221 运行
 *   - Vite proxy: /api/brain → localhost:5221（vite.config.ts 已配置）
 *
 * 注意：禁止使用 page.route() 拦截 API 请求，所有请求打真实后端。
 */

import { test, expect, request } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
const BRAIN_URL = process.env.E2E_BRAIN_URL ?? 'http://localhost:5221';
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');

// 确保截图目录存在
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

test.describe('Relay 进度条 Dashboard — Golden Path E2E', () => {
  let runs: Array<{
    initiative_id: string;
    phase: string;
    judge_verdict: string | null;
    cost_usd: number | null;
  }>;

  test.beforeAll(async () => {
    // 先查真实后端，获取 relay-runs 数据（决定走 happy-path 还是 empty-path）
    const apiContext = await request.newContext({ baseURL: BRAIN_URL });
    const apiResp = await apiContext.get('/api/brain/orchestrator/relay-runs');
    expect(apiResp.ok(), `relay-runs API 返回非 2xx: ${apiResp.status()}`).toBeTruthy();
    runs = await apiResp.json();
    console.log(`[E2E] relay-runs 返回 ${runs.length} 条数据`);
    await apiContext.dispose();
  });

  test('Step 1: 导航到进度页，relay-progress-container 可见', async ({ page }) => {
    await page.goto(`${BASE_URL}/relay-progress`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-initial.png') });

    await expect(page.locator('[data-testid="relay-progress-container"]')).toBeVisible({ timeout: 10000 });
  });

  test('Step 2/3: 有活跃 relay 时 — 七棒 phase 标签可见 + initiative 短码渲染', async ({ page }) => {
    test.skip(runs.length === 0, '无活跃 relay，走 empty-path 测试');

    await page.goto(`${BASE_URL}/relay-progress`);
    await page.waitForLoadState('networkidle');

    // 断言七段 phase 标签
    const phases = ['planning', 'gan', 'generate', 'evaluate', 'judge', 'merge', 'report'];
    for (const phase of phases) {
      await expect(
        page.locator(`[data-testid="phase-label-${phase}"]`).first()
      ).toBeVisible({ timeout: 5000 });
    }
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-phases.png') });

    // 断言 initiative 短码（前 8 位）出现在 DOM
    const shortId = runs[0].initiative_id.substring(0, 8);
    await expect(page.locator(`text=${shortId}`)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-short-id.png') });
  });

  test('Step 5: 无活跃 relay 时 — 空态文案"暂无进行中的 relay"可见', async ({ page }) => {
    test.skip(runs.length > 0, '有活跃 relay，走 happy-path 测试');

    await page.goto(`${BASE_URL}/relay-progress`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="relay-progress-empty"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="relay-progress-empty"]')).toHaveText('暂无进行中的 relay');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-empty.png') });
  });

  test('Step 4: phase A_ 前缀已剥离 — 页面不出现 A_ 前缀文案', async ({ page }) => {
    test.skip(runs.length === 0, '无活跃 relay，无法验证 phase 剥离');

    await page.goto(`${BASE_URL}/relay-progress`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="relay-progress-container"]')).toBeVisible({ timeout: 10000 });

    // 页面文本中不应出现 A_ 前缀的 phase 名
    const pageContent = await page.locator('[data-testid="relay-progress-container"]').textContent();
    // 断言页面内容不含 A_planning / A_generate 等带前缀形式
    const hasPrefix = /\bA_[a-z]/.test(pageContent ?? '');
    expect(hasPrefix, `页面出现了 A_ 前缀的 phase 文案: "${pageContent}"`).toBe(false);
  });

  test('多租户：多条 initiative 均渲染各自短码', async ({ page }) => {
    test.skip(runs.length < 2, '活跃 relay 不足 2 条，跳过多租户验证');

    await page.goto(`${BASE_URL}/relay-progress`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="relay-progress-container"]')).toBeVisible({ timeout: 10000 });

    // 验证至少前两条 initiative 的短码均出现在页面
    for (const run of runs.slice(0, 2)) {
      const shortId = run.initiative_id.substring(0, 8);
      await expect(page.locator(`text=${shortId}`)).toBeVisible({ timeout: 5000 });
    }
  });
});
