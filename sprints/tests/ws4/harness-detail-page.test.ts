import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const TEST_INITIATIVE_ID = 'bbbbbbbb-cccc-dddd-eeee-ff0000000001';
const DONE_INITIATIVE_ID = 'dddddddd-eeee-ffff-0000-aa0000000002';

test.describe('WS4 — Dashboard HarnessDetailPage /harness/:id [BEHAVIOR]', () => {
  test('renders realtime log — /harness/:id 页面含 data-testid=realtime-log', async ({ page }) => {
    await page.goto(`${BASE_URL}/harness/${TEST_INITIATIVE_ID}`);
    await expect(page.locator('[data-testid="realtime-log"]')).toBeVisible({ timeout: 5000 });
  });

  test('uses initiative_id — EventSource URL 含 initiative_id 参数，不含 taskId/task_id/id', async ({ page }) => {
    const sseRequests: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/harness/stream')) sseRequests.push(req.url());
    });
    await page.goto(`${BASE_URL}/harness/${TEST_INITIATIVE_ID}`);
    await page.waitForTimeout(2000);
    expect(sseRequests.length).toBeGreaterThan(0);
    const url = sseRequests[0];
    expect(url).toContain(`initiative_id=${TEST_INITIATIVE_ID}`);
    expect(url).not.toMatch(/[?&]taskId=/);
    expect(url).not.toMatch(/[?&]task_id=/);
    expect(url).not.toMatch(/[?&]id=/);
  });

  test('appends node_update row — 收到 node_update 事件后追加 data-testid=log-entry 节点行', async ({ page }) => {
    await page.goto(`${BASE_URL}/harness/${TEST_INITIATIVE_ID}`);
    await expect(
      page.locator('[data-testid="realtime-log"] [data-testid="log-entry"]').first()
    ).toBeVisible({ timeout: 8000 });
  });

  test('shows completion status — pipeline 完成后显示"Pipeline 已完成"或"Pipeline 失败"', async ({ page }) => {
    await page.goto(`${BASE_URL}/harness/${DONE_INITIATIVE_ID}`);
    await expect(
      page.locator('text=Pipeline 已完成').or(page.locator('text=Pipeline 失败'))
    ).toBeVisible({ timeout: 8000 });
  });
});
