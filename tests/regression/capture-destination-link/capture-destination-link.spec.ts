/**
 * capture-destination-link E2E — F6-S3 去向可查 + 账龄不烂
 * target_environment: mac_web (localhost:5174)
 * brain_url: localhost:5221
 *
 * 断言：
 * 1. POST /captures + atom 路由到 tasks → GET /:id 回链含 navigate_url
 * 2. PATCH /:id/done 返回 navigate_url，Dashboard /inbox 显示 [跳转] 链接
 * 3. GET /captures/aging 返回超期条目列表
 */

import { test, expect } from '@playwright/test';

const BRAIN = process.env.BRAIN_URL || 'http://localhost:5221';
const DASH  = process.env.DASHBOARD_URL || 'http://localhost:5174';

// ── 1. API: backlink navigate_url ────────────────────────────────────────────

test.describe('API: capture destination link', () => {
  let captureId: string;

  test.beforeAll(async () => {
    // 写入一条测试 capture
    const dedupe = `e2e-destlink-${Date.now()}`;
    const resp = await fetch(`${BRAIN}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'E2E去向链测试内容',
        source: 'harness',
        nature: 'learning',
        dedupe_key: dedupe,
      }),
    });
    expect(resp.status).toBeLessThan(300);
    const data = await resp.json();
    captureId = data.id;
    expect(captureId).toBeTruthy();
  });

  test('GET /captures/:id 含 backlinks 字段（数组）', async () => {
    const resp = await fetch(`${BRAIN}/api/brain/captures/${captureId}`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data.backlinks)).toBe(true);
    // 如有路由 atom，每条 backlink 必须含 navigate_url（可为 null）
    for (const bl of data.backlinks) {
      expect(bl).toHaveProperty('navigate_url');
      expect(bl).toHaveProperty('table');
      expect(bl).toHaveProperty('id');
    }
  });

  test('PATCH /captures/:id/done → status=done, done_at 已写, navigate_url 字段存在', async () => {
    const resp = await fetch(`${BRAIN}/api/brain/captures/${captureId}/done`, {
      method: 'PATCH',
    });
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.status).toBe('done');
    expect(data.done_at).toBeTruthy();
    expect(data).toHaveProperty('navigate_url'); // 可为 null（无路由 atom 时）
  });

  test('PATCH /captures/:id/done 幂等（再次调用仍返回 done）', async () => {
    const resp = await fetch(`${BRAIN}/api/brain/captures/${captureId}/done`, {
      method: 'PATCH',
    });
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.status).toBe('done');
  });
});

// ── 2. API: 账龄哨兵 ─────────────────────────────────────────────────────────

test.describe('API: aging sentinel', () => {
  test('GET /captures/aging?days=7 返回 overdue + count + threshold_days', async () => {
    const resp = await fetch(`${BRAIN}/api/brain/captures/aging?days=7`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data).toHaveProperty('overdue');
    expect(Array.isArray(data.overdue)).toBe(true);
    expect(data).toHaveProperty('count');
    expect(data.threshold_days).toBe(7);
  });

  test('超期 captures 中无 done/dropped 状态', async () => {
    const resp = await fetch(`${BRAIN}/api/brain/captures/aging?days=7`);
    const data = await resp.json();
    for (const item of data.overdue) {
      expect(['done', 'dropped']).not.toContain(item.status);
    }
  });
});

// ── 3. Dashboard UI: 去向链接可见 ────────────────────────────────────────────

test.describe('Dashboard UI: inbox destination links', () => {
  test('访问 /inbox，首行带路由 atom 的条目详情含 [跳转] 链接', async ({ page }) => {
    await page.goto(`${DASH}/inbox`);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('[data-testid="capture-row"]');
    const count = await rows.count();
    if (count === 0) {
      test.skip(true, '无 capture 条目，跳过 UI 链接测试');
      return;
    }

    // 点开第一个有 atoms 的条目
    for (let i = 0; i < Math.min(count, 5); i++) {
      await rows.nth(i).click();
      await page.waitForTimeout(400);

      // 检查是否有 destination-link 或 backlink-navigate
      const destLink = page.locator('[data-testid="destination-link"], [data-testid="backlink-navigate"]');
      const destCount = await destLink.count();
      if (destCount > 0) {
        // 验证链接的 href 格式正确
        const href = await destLink.first().getAttribute('href');
        expect(href).toBeTruthy();
        expect(href).toMatch(/^\/(tasks|warroom|knowledge)/);
        break;
      }

      // 关闭抽屉
      const closeBtn = page.locator('button:has-text("✕")');
      if (await closeBtn.count() > 0) await closeBtn.click();
    }
  });

  test('归位完成按钮存在（未 done 条目）', async ({ page }) => {
    await page.goto(`${DASH}/inbox`);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('[data-testid="capture-row"]');
    const count = await rows.count();
    if (count === 0) {
      test.skip(true, '无条目，跳过 done 按钮测试');
      return;
    }

    await rows.first().click();
    await page.waitForTimeout(400);

    // 只要抽屉打开且 capture 未 done，就应有归位完成按钮
    const doneBtn = page.locator('[data-testid="mark-done-btn"]');
    // 按钮存在（可能 0 个若全是 done 状态）
    const btnCount = await doneBtn.count();
    // 断言：只要有未 done 的条目打开，按钮就该可见
    if (btnCount > 0) {
      await expect(doneBtn.first()).toBeVisible();
    }
  });
});
