import { test, expect } from '@playwright/test';

/**
 * Relay 进度条页面 E2E 测试
 * 环境：mac_web（本机 Playwright，baseURL: http://localhost:5174）
 * Task ID: d56d5ad9-0e03-4106-8b38-23507bb14dc6
 */

const RELAY_RUNS_API = '**/orchestrator/relay-runs**';

const MOCK_SINGLE_RUN = {
  runs: [
    {
      initiative_id: 'abcd1234-0000-0000-0000-000000000000',
      current_phase: 'generate',
      phases: {
        planning: 'completed',
        gan: 'completed',
        generate: 'running',
        evaluate: 'pending',
        judge: 'pending',
        merge: 'pending',
        report: 'pending',
      },
    },
  ],
};

const MOCK_EMPTY_RUNS = { runs: [] };

// TC-1：进度条容器可见
test('TC-1: [data-testid="relay-progress-list"] 元素可见', async ({ page }) => {
  await page.goto('/relay-progress');

  const list = page.locator('[data-testid="relay-progress-list"]');
  await expect(list).toBeVisible({ timeout: 10_000 });
});

// TC-2：七段 phase 标签均在 DOM
test('TC-2: 七段 phase 标签（Planning/GAN/Generate/Evaluate/Judge/Merge/Report）全部在 DOM', async ({ page }) => {
  await page.goto('/relay-progress');

  const phases = ['Planning', 'GAN', 'Generate', 'Evaluate', 'Judge', 'Merge', 'Report'];

  for (const phase of phases) {
    // 大小写不敏感匹配
    const locator = page.locator(`text=${phase}`).or(
      page.locator(`text=${phase.toLowerCase()}`)
    ).or(
      page.locator(`text=${phase.toUpperCase()}`)
    );
    await expect(locator.first()).toBeVisible({ timeout: 10_000 });
  }
});

// TC-3：mock API 返回一条 initiative，短码 abcd1234 渲染可见
test('TC-3: mock API 返回一条 initiative，短码 abcd1234 渲染可见', async ({ page }) => {
  await page.route(RELAY_RUNS_API, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SINGLE_RUN),
    })
  );

  await page.goto('/relay-progress');

  // 短码：initiative_id 前 8 位 = "abcd1234"
  await expect(page.locator('text=abcd1234')).toBeVisible({ timeout: 10_000 });
});

// TC-4：mock API 返回空数组，空态文案可见
test('TC-4: mock API 返回空数组，"暂无进行中的 relay" 文案可见', async ({ page }) => {
  await page.route(RELAY_RUNS_API, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_EMPTY_RUNS),
    })
  );

  await page.goto('/relay-progress');

  await expect(page.locator('text=暂无进行中的 relay')).toBeVisible({ timeout: 10_000 });
});
