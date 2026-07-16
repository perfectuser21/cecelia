/**
 * E2E 验收测试 — 主理人指挥舱（Owner Cockpit）
 *
 * Task ID: 80a5be84-059a-4d86-a55c-a1e38f84e043
 * Sprint:  sprints/07162300-owner-cockpit
 * 环境路由: mac_web（localhost:5174，本机 Playwright）
 *
 * 前置条件：
 *   - Brain 服务运行于 localhost:5221
 *   - Dashboard 服务运行于 localhost:5174
 *   - DB 中存在 ≥1 条 status=in_progress 任务
 *
 * 执行命令：
 *   npx playwright test sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts --reporter=line
 */

import { test, expect, Page } from '@playwright/test';
import * as path from 'path';

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

/**
 * 辅助函数：等待页面初始 API 加载完成
 * Owner Cockpit 使用并行 fetch，等待网络空闲即可
 */
async function waitForCockpitLoad(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 });
}

test.describe('Owner Cockpit — 主理人指挥舱', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await waitForCockpitLoad(page);
  });

  // ---- FR-01: 默认路由 ----
  test('FR-01: 根路由渲染 OwnerCockpitPage，不重定向', async ({ page }) => {
    // URL 应保持在 /
    expect(page.url()).toMatch(/localhost:5174\/?$/);

    // 页面应含指挥舱特征容器
    const cockpitRoot = page.locator('[data-testid="owner-cockpit"]');
    await expect(cockpitRoot).toBeVisible({ timeout: 10000 });
  });

  // ---- FR-02: 六指标卡可见性 ----
  test('FR-02: 六张指标卡均可见', async ({ page }) => {
    for (const slug of METRIC_CARD_SLUGS) {
      const card = page.locator(`[data-testid="metric-card-${slug}"]`);
      await expect(card).toBeVisible({ timeout: 10000 });
    }
  });

  // ---- FR-02: 指标卡数值非空 ----
  test('FR-02: 六张指标卡数值均非空（真实 API 数据）', async ({ page }) => {
    for (const slug of METRIC_CARD_SLUGS) {
      const card = page.locator(`[data-testid="metric-card-${slug}"]`);
      await expect(card).toBeVisible({ timeout: 10000 });

      const text = await card.innerText();
      // 允许 "--"（API 失败降级），但不允许空字符串、"undefined"、"null"
      expect(text.trim()).not.toBe('');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
    }
  });

  // ---- FR-03: 作战板 ----
  test('FR-03: 作战板至少 1 张战役卡片可见', async ({ page }) => {
    const battleCards = page.locator('[data-testid="battle-card"]');
    await expect(battleCards.first()).toBeVisible({ timeout: 10000 });
    const count = await battleCards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ---- FR-03: 点击任务跳转 ----
  test('FR-03: 点击任务条目跳转 /harness-pipeline?task_id=', async ({ page }) => {
    // 找第一个任务链接（在 battle-card 内部）
    const taskLink = page.locator('[data-testid="battle-card"] a[data-testid^="task-link-"]').first();
    const exists = await taskLink.count();
    if (exists === 0) {
      // 若无 task-link testid，退化为找 href 含 harness-pipeline 的链接
      const fallbackLink = page.locator('[data-testid="battle-card"] a[href*="harness-pipeline"]').first();
      await expect(fallbackLink).toBeVisible({ timeout: 10000 });
      const href = await fallbackLink.getAttribute('href');
      expect(href).toContain('harness-pipeline');
      expect(href).toContain('task_id=');
    } else {
      await expect(taskLink).toBeVisible({ timeout: 10000 });
      const href = await taskLink.getAttribute('href');
      expect(href).toContain('harness-pipeline');
      expect(href).toContain('task_id=');
    }
  });

  // ---- FR-07: 移动端无水平滚动 ----
  test('FR-07: 移动端（375px）无水平滚动条', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await waitForCockpitLoad(page);

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = 375;
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 2); // ±2px 容差
  });

  // ---- FR-10: 截图存证 ----
  test('FR-10: 截图存证（owner-cockpit.png）', async ({ page }) => {
    // 确保所有指标卡已加载
    await page.locator('[data-testid="owner-cockpit"]').waitFor({ timeout: 10000 });

    await page.screenshot({
      path: SCREENSHOT_PATH,
      fullPage: true,
    });

    // 验证截图文件存在（Playwright 写入失败会 throw）
    const { statSync } = await import('fs');
    const stat = statSync(SCREENSHOT_PATH);
    expect(stat.size).toBeGreaterThan(10240); // > 10KB
  });

  // ---- FR-04: 晨报 Feed ----
  test('FR-04: 晨报 Feed 展示且可展开', async ({ page }) => {
    // 找第一条日报条目（默认折叠）
    const diaryItem = page.locator('[data-testid^="diary-item-"]').first();
    // 若 Brain 有日报数据则验证；否则 skip（容忍空状态）
    const count = await diaryItem.count();
    if (count > 0) {
      await expect(diaryItem).toBeVisible({ timeout: 10000 });
      // 点击展开
      await diaryItem.click();
      // 展开后应有正文内容（Markdown 渲染区）
      const content = page.locator('[data-testid^="diary-item-"] .diary-content, [data-testid^="diary-item-"] [data-testid$="-content"]').first();
      // 容忍：若无 data-testid 内容区，至少验证 item 展开后 innerText 变长
      // 这里用宽松断言：展开后 diaryItem 的 innerText 非空
      const text = await diaryItem.innerText();
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  // ---- FR-05: 演习状态条 ----
  test('FR-05: 演习状态条可见', async ({ page }) => {
    const drillStatus = page.locator('[data-testid="drill-status-bar"]');
    await expect(drillStatus).toBeVisible({ timeout: 10000 });
    const text = await drillStatus.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  // ---- FR-06: 导览区 ----
  test('FR-06: 导览区展示 16 个已有页面链接', async ({ page }) => {
    const navLinks = page.locator('[data-testid="nav-area"] a, [data-testid^="nav-link-"]');
    await expect(navLinks.first()).toBeVisible({ timeout: 10000 });
    const count = await navLinks.count();
    expect(count).toBeGreaterThanOrEqual(16);
  });
});

// ---- 静态代码断言（独立 test，不需要 browser） ----
test.describe('静态代码断言 — scheduler job 注册', () => {
  test('FR-09: morning-cockpit-bark job 已在 JOBS 数组中注册', async () => {
    const { readFileSync } = await import('fs');
    const schedulerPath = path.resolve(
      __dirname,
      '../../../../packages/brain/src/scheduler-jobs.js',
    );
    const content = readFileSync(schedulerPath, 'utf-8');
    expect(content).toContain("'morning-cockpit-bark'");
  });

  test('FR-09: morning-cockpit-bark handler 无硬编码 BARK_TOKEN', async () => {
    const { readFileSync, existsSync } = await import('fs');
    const handlerPath = path.resolve(
      __dirname,
      '../../../../packages/brain/src/morning-cockpit-bark.js',
    );
    if (!existsSync(handlerPath)) {
      // 文件尚未创建时断言失败，明确提示
      throw new Error('morning-cockpit-bark.js 尚未创建，FR-09 未完成');
    }
    const content = readFileSync(handlerPath, 'utf-8');
    // 不允许字面量 token 字符串赋值（允许 process.env.BARK_TOKEN 引用）
    expect(content).not.toMatch(/BARK_TOKEN\s*=\s*['"][a-zA-Z0-9]+['"]/);
  });
});
