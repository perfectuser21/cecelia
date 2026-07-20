/**
 * Inbox P1 主干 — E2E 测试骨架
 * task_id: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
 * target_environment: mac_web (localhost:5174)
 * brain_url: localhost:5221
 */

import { test, expect, Page } from '@playwright/test';

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5174';

// ─── E2E-1: 新 learning 全链路可见 ──────────────────────────────────────────

test.describe('E2E-1: 新 learning 全链路可见', () => {
  const DEDUPE_KEY = `e2e-learning-${Date.now()}`;

  test('POST /captures 写入 learning → API 可查 → Dashboard 可见', async ({ page }) => {
    // Step 1: 写入 capture
    const createResp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '测试新capture学习条目',
        source: 'harness',
        nature: 'learning',
        dedupe_key: DEDUPE_KEY,
      }),
    });
    expect(createResp.status).toBe(201);
    const created = await createResp.json();
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('clarified'); // nature 有值 → clarified

    // Step 2: 验证 dedupe 幂等
    const dupeResp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '测试新capture学习条目',
        source: 'harness',
        nature: 'learning',
        dedupe_key: DEDUPE_KEY,
      }),
    });
    expect(dupeResp.status).toBe(200);
    const duped = await dupeResp.json();
    expect(duped.dedupe_hit).toBe(true);

    // Step 3: 验证列表 API 可查
    const listResp = await fetch(`${BRAIN_URL}/api/brain/captures?nature=learning`);
    expect(listResp.ok).toBe(true);
    const listData = await listResp.json();
    const target = listData.items?.find((i: any) => i.dedupe_key === DEDUPE_KEY);
    expect(target).toBeTruthy();
    expect(['clarified', 'done']).toContain(target.status);

    // Step 4: Playwright Dashboard 验证（等 triage tick 运行后执行）
    await page.goto(`${DASHBOARD_URL}/inbox`);
    await page.waitForLoadState('networkidle');
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('测试新capture学习条目');
  });
});

// ─── E2E-4: Dashboard /inbox 页漏斗渲染 ─────────────────────────────────────

test.describe('E2E-4: Dashboard /inbox 页漏斗渲染', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('访问 /inbox → 漏斗磁贴存在且含计数', async () => {
    await page.goto(`${DASHBOARD_URL}/inbox`);
    await page.waitForLoadState('networkidle');

    // 截图保存
    await page.screenshot({
      path: 'sprints/07200850-relay-07b2fd3b/screenshots/inbox-funnel.png',
      fullPage: true,
    });

    // 断言漏斗阶段文字
    const bodyText = await page.textContent('body');
    const hasFunnelText =
      (bodyText?.includes('captured') || bodyText?.includes('clarified')) ?? false;
    expect(hasFunnelText).toBe(true);
  });

  test('漏斗磁贴有非零计数值', async () => {
    await page.goto(`${DASHBOARD_URL}/inbox`);
    await page.waitForLoadState('networkidle');

    // 查找非零数字（计数磁贴）
    const countElements = page.locator('[data-testid="stage-count"]');
    const count = await countElements.count();
    // 至少存在计数元素
    expect(count).toBeGreaterThan(0);

    // 找到至少一个非零值
    let hasNonZero = false;
    for (let i = 0; i < count; i++) {
      const text = await countElements.nth(i).textContent();
      const num = parseInt(text ?? '0', 10);
      if (num > 0) {
        hasNonZero = true;
        break;
      }
    }
    // 如果没有 data-testid，降级检查文字
    if (count === 0) {
      const bodyText = await page.textContent('body');
      const nums = bodyText?.match(/\d+/g)?.map(Number).filter(n => n > 0) ?? [];
      hasNonZero = nums.length > 0;
    }
    expect(hasNonZero).toBe(true);
  });

  test('点击第一行条目 → 详情抽屉出现', async () => {
    await page.goto(`${DASHBOARD_URL}/inbox`);
    await page.waitForLoadState('networkidle');

    // 点击列表第一行
    const firstRow = page.locator('[data-testid="capture-row"]').first();
    const rowCount = await firstRow.count();

    if (rowCount > 0) {
      await firstRow.click();
      await page.waitForTimeout(500);

      // 断言抽屉出现
      const drawerText = await page.textContent('body');
      const hasDrawerContent =
        drawerText?.includes('nature') ||
        drawerText?.includes('atoms') ||
        drawerText?.includes('来源') ||
        drawerText?.includes('状态');
      expect(hasDrawerContent).toBe(true);
    } else {
      // 无条目时跳过详情测试
      test.skip(true, '无条目可点击，跳过详情抽屉测试');
    }
  });
});

// ─── FR-3: POST /captures 端点单元级验收 ────────────────────────────────────

test.describe('FR-3: POST /captures 端点', () => {
  test('source 白名单校验', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test', source: 'invalid_source' }),
    });
    expect(resp.status).toBe(400);
  });

  test('content 不为空校验', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '', source: 'harness' }),
    });
    expect(resp.status).toBe(400);
  });

  test('nature 白名单校验', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test', source: 'harness', nature: 'invalid_nature' }),
    });
    expect(resp.status).toBe(400);
  });

  test('无 nature → status=captured', async () => {
    const dedupe = `test-no-nature-${Date.now()}`;
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '自由输入无出身', source: 'api', dedupe_key: dedupe }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.status).toBe('captured');
  });

  test('有 nature → status=clarified', async () => {
    const dedupe = `test-with-nature-${Date.now()}`;
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '出身已知issue', source: 'harness', nature: 'issue', dedupe_key: dedupe }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.status).toBe('clarified');
  });
});

// ─── FR-8: captures CRUD API ─────────────────────────────────────────────────

test.describe('FR-8: captures CRUD API', () => {
  test('GET /captures 含 counts_by_stage', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures?limit=1`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data).toHaveProperty('counts_by_stage');
    expect(data.counts_by_stage).toHaveProperty('captured');
    expect(data.counts_by_stage).toHaveProperty('clarified');
    expect(data.counts_by_stage).toHaveProperty('done');
    expect(data.counts_by_stage).toHaveProperty('dropped');
  });

  test('GET /captures?stage=captured → items 仅含 captured 状态', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures?stage=captured&limit=5`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    for (const item of data.items ?? []) {
      expect(item.status).toBe('captured');
    }
  });

  test('GET /captures/:id 含 atoms 字段', async () => {
    // 先获取一个 capture id
    const listResp = await fetch(`${BRAIN_URL}/api/brain/captures?limit=1`);
    const listData = await listResp.json();
    if (!listData.items?.length) {
      test.skip(true, '无 captures 可测详情');
      return;
    }
    const captureId = listData.items[0].id;
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures/${captureId}`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data).toHaveProperty('atoms');
    expect(Array.isArray(data.atoms)).toBe(true);
  });

  test('POST /capture-atoms/:id/retry → retry_count 增加', async () => {
    // 获取一个 parked atom
    // 注：此测试依赖数据库有 parked atom，无则跳过
    const checkResp = await fetch(`${BRAIN_URL}/api/brain/captures?limit=1`);
    const checkData = await checkResp.json();
    if (!checkData.items?.length) {
      test.skip(true, '无数据可测 retry');
      return;
    }
    // 找到带 atoms 的 capture
    const captureId = checkData.items[0].id;
    const detailResp = await fetch(`${BRAIN_URL}/api/brain/captures/${captureId}`);
    const detail = await detailResp.json();
    const parkedAtom = detail.atoms?.find((a: any) => a.status === 'parked' || a.status === 'pending_review');
    if (!parkedAtom) {
      test.skip(true, '无 parked/pending_review atom 可测 retry');
      return;
    }
    const retryResp = await fetch(`${BRAIN_URL}/api/brain/capture-atoms/${parkedAtom.id}/retry`, {
      method: 'POST',
    });
    expect(retryResp.ok).toBe(true);
    const retryData = await retryResp.json();
    expect(retryData.retry_count).toBeGreaterThan(parkedAtom.retry_count ?? 0);
  });
});
