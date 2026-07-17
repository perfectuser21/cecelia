import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5174';
const SCREENSHOT_PATH = path.resolve(process.cwd(), 'owner-cockpit.png');

const METRIC_CARD_SLUGS = [
  'completion-rate',
  'canary-green-days',
  'gate-fires',
  'merge-to-deploy',
  'queue-health',
  'blocked-count',
];

async function waitForCockpitLoad(page: any) {
  await page.waitForLoadState('networkidle', { timeout: 15000 });
}

test.describe('Owner Cockpit — 主理人指挥舱', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await waitForCockpitLoad(page);
  });

  test('FR-01: 根路由渲染 OwnerCockpitPage，不重定向', async ({ page }) => {
    expect(page.url()).toMatch(/localhost:5174\/?$/);
    const cockpitRoot = page.locator('[data-testid="owner-cockpit"]');
    await expect(cockpitRoot).toBeVisible({ timeout: 10000 });
  });

  test('FR-02: 六张指标卡均可见', async ({ page }) => {
    for (const slug of METRIC_CARD_SLUGS) {
      const card = page.locator(`[data-testid="metric-card-${slug}"]`);
      await expect(card).toBeVisible({ timeout: 10000 });
    }
  });

  test('FR-02: 六张指标卡数值均非空（真实 API 数据）', async ({ page }) => {
    for (const slug of METRIC_CARD_SLUGS) {
      const card = page.locator(`[data-testid="metric-card-${slug}"]`);
      await expect(card).toBeVisible({ timeout: 10000 });
      const text = await card.innerText();
      expect(text.trim()).not.toBe('');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
    }
  });

  test('FR-03: 作战板至少 1 张战役卡片可见', async ({ page }) => {
    const resp = await page.request.get('http://localhost:5221/api/brain/tasks?status=in_progress');
    const body = await resp.json();
    const tasks = Array.isArray(body) ? body : (body?.tasks ?? []);
    if (tasks.length === 0) {
      test.skip();
      return;
    }
    const battleCards = page.locator('[data-testid="battle-card"]');
    await expect(battleCards.first()).toBeVisible({ timeout: 10000 });
    const count = await battleCards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('FR-03: 点击任务条目跳转 /harness-pipeline?task_id=', async ({ page }) => {
    const resp = await page.request.get('http://localhost:5221/api/brain/tasks?status=in_progress');
    const body = await resp.json();
    const tasks = Array.isArray(body) ? body : (body?.tasks ?? []);
    if (tasks.length === 0) {
      test.skip();
      return;
    }
    const taskLink = page.locator('[data-testid="battle-card"] a[data-testid^="task-link-"]').first();
    const fallbackLink = page.locator('[data-testid="battle-card"] a[href*="harness-pipeline"]').first();
    const primaryExists = await taskLink.count();
    const linkToClick = primaryExists > 0 ? taskLink : fallbackLink;
    await expect(linkToClick).toBeVisible({ timeout: 10000 });
    await linkToClick.click();
    await expect(page).toHaveURL(/harness-pipeline.*task_id=/, { timeout: 10000 });
  });

  test('FR-07: 移动端（375px）无水平滚动条', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await waitForCockpitLoad(page);
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375 + 2);
  });

  test('FR-10: 截图存证（owner-cockpit.png）', async ({ page }) => {
    await page.locator('[data-testid="owner-cockpit"]').waitFor({ timeout: 10000 });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    const stat = fs.statSync(SCREENSHOT_PATH);
    expect(stat.size).toBeGreaterThan(10240);
  });

  test('FR-04: 晨报 Feed 展示且可展开', async ({ page }) => {
    const resp = await page.request.get('http://localhost:5221/api/brain/design-docs?type=diary&limit=7');
    const body = await resp.json();
    const docs = Array.isArray(body) ? body : (body?.docs ?? body?.data ?? []);
    if (docs.length === 0) {
      test.skip();
      return;
    }
    const diaryItem = page.locator('[data-testid^="diary-item-"]').first();
    await expect(diaryItem).toBeVisible({ timeout: 10000 });
    await diaryItem.click();
    const contentEl = page.locator('[data-testid$="-content"]').first();
    await expect(contentEl).toBeVisible({ timeout: 5000 });
  });

  test('FR-05: 演习状态条可见', async ({ page }) => {
    const drillStatus = page.locator('[data-testid="drill-status-bar"]');
    await expect(drillStatus).toBeVisible({ timeout: 10000 });
    const text = await drillStatus.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('FR-06: 导览区展示 16 个已有页面链接', async ({ page }) => {
    const navLinks = page.locator('[data-testid="nav-area"] a, [data-testid^="nav-link-"]');
    await expect(navLinks.first()).toBeVisible({ timeout: 10000 });
    const count = await navLinks.count();
    expect(count).toBeGreaterThanOrEqual(16);
  });
});

test.describe('静态代码断言 — scheduler job 注册', () => {
  test('FR-09: morning-cockpit-bark job 已在 JOBS 数组中注册', async () => {
    const content = fs.readFileSync('/workspace/packages/brain/src/scheduler-jobs.js', 'utf-8');
    expect(content).toContain("'morning-cockpit-bark'");
  });

  test('FR-09: morning-cockpit-bark handler 无硬编码 BARK_TOKEN', async () => {
    const handlerPath = '/workspace/packages/brain/src/morning-cockpit-bark.js';
    if (!fs.existsSync(handlerPath)) {
      throw new Error('morning-cockpit-bark.js 尚未创建，FR-09 未完成');
    }
    const content = fs.readFileSync(handlerPath, 'utf-8');
    expect(content).not.toMatch(/BARK_TOKEN\s*=\s*['"][a-zA-Z0-9]+['"]/);
  });
});
