import { test, expect, type Page } from '@playwright/test';

const DASHBOARD = 'http://localhost:5173';

test('renders realtime log area on /pipeline/:id', async ({ page }: { page: Page }) => {
  await page.goto(`${DASHBOARD}/pipeline/test-task-id`);
  await expect(page.locator('[data-testid="realtime-log"]')).toBeVisible({ timeout: 5000 });
});

test('uses planner_task_id in EventSource URL, not initiative_id or taskId', async ({ page }: { page: Page }) => {
  const streamRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('harness/stream')) {
      streamRequests.push(req.url());
    }
  });

  await page.goto(`${DASHBOARD}/pipeline/test-task-id`);
  await page.waitForTimeout(2000);

  const streamUrl = streamRequests.find((u) => u.includes('harness/stream'));
  expect(streamUrl).toBeDefined();
  expect(streamUrl).toContain('planner_task_id=test-task-id');
  expect(streamUrl).not.toContain('initiative_id=');
  expect(streamUrl).not.toContain('taskId=');
  expect(streamUrl).not.toContain('task_id=');
});

test('appends log-entry row when node_update event received', async ({ page }: { page: Page }) => {
  await page.goto(`${DASHBOARD}/pipeline/test-task-id`);
  await expect(page.locator('[data-testid="realtime-log"]')).toBeVisible({ timeout: 5000 });
  // Expect at least one log-entry to appear after SSE connects
  await expect(page.locator('[data-testid="log-entry"]').first()).toBeVisible({ timeout: 10000 });
});

test('shows completion status text when pipeline done', async ({ page }: { page: Page }) => {
  // Requires a completed task ID in the system
  await page.goto(`${DASHBOARD}/pipeline/completed-task-id`);
  await expect(page.locator('text=/Pipeline 已完成|Pipeline 失败/')).toBeVisible({ timeout: 10000 });
});
