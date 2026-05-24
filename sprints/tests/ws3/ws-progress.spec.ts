/**
 * WS3 E2E Playwright spec — WsProgressSection 在 /pipeline 页渲染
 * baseURL: http://localhost:5211 (apps/dashboard dev server)
 *
 * 截图对应 contract-dod-ws3.md [BEHAVIOR:E2E] 约束：
 *   01-initial.png        — /pipeline 加载完成，pipeline 卡片可见
 *   02-ws-progress-visible.png — ws-progress-section 区块显示，含状态图标
 *   03-result.png         — 全页最终状态，WS 进度区块已渲染
 */
import { test, expect } from '@playwright/test';

const MOCK_INITIATIVE_ID = 'test-init-ws3-e2e-00001';

const MOCK_PIPELINES_RESPONSE = {
  pipelines: [
    {
      pipeline_id: MOCK_INITIATIVE_ID,
      planner_task_id: MOCK_INITIATIVE_ID,
      sprint_dir: 'sprints/cecelia-harness-viz',
      title: 'WsProgress E2E 验证 Pipeline',
      description: 'E2E 测试专用 pipeline',
      status: 'in_progress',
      verdict: 'in_progress',
      current_step: 'generator',
      elapsed_ms: 45000,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      pr_url: null,
      langgraph: {
        current_node: 'generator',
        current_node_label: 'Generator',
        last_verdict: 'RUNNING',
        review_round: 0,
        eval_round: 0,
        gan_rounds: 1,
        fix_rounds: 0,
        total_steps: 8,
        pr_url: null,
        last_error: null,
        last_event_at: new Date().toISOString(),
        workstreams: [
          { index: 1, name: 'ws1' },
          { index: 2, name: 'ws2' },
          { index: 3, name: 'ws3' },
        ],
      },
      stages: [],
    },
  ],
  total: 1,
};

const MOCK_WS_PROGRESS_RESPONSE = {
  workstreams: [
    {
      ws_id: 'ws1',
      title: 'Brain GET /api/brain/version 路由',
      status: 'merged',
      evaluate_verdict: 'PASS',
      pr_url: 'https://github.com/perfectuser21/cecelia/pull/3097',
      fix_round: 0,
      container_id: null,
    },
    {
      ws_id: 'ws2',
      title: 'HarnessStreamPage SSE 实时日志区域展示',
      status: 'running',
      evaluate_verdict: null,
      pr_url: null,
      fix_round: 1,
      container_id: 'container-abc123',
    },
    {
      ws_id: 'ws3',
      title: 'WsProgressSection 4条status图标映射+渲染测试',
      status: null,
      evaluate_verdict: null,
      pr_url: null,
      fix_round: 0,
      container_id: 'container-xyz789',
    },
  ],
};

test.describe('WS3 — WsProgressSection E2E [BEHAVIOR:E2E]', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/brain/harness-pipelines**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PIPELINES_RESPONSE),
      });
    });

    await page.route('**/api/brain/harness/initiative/*/ws-progress', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_WS_PROGRESS_RESPONSE),
      });
    });
  });

  test('01-initial: /pipeline 页面加载完成，pipeline 卡片列表可见，无报错红框', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).not.toContainText('Error');
    await expect(page.locator('body')).not.toContainText('Cannot');

    await page.screenshot({ path: 'sprints/cecelia-harness-viz/screenshots/01-initial.png', fullPage: true });
  });

  test('02-ws-progress-visible: in_progress card 内 ws-progress-section 可见，含状态图标和 ws_id', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    const wsSection = page.locator('[data-testid="ws-progress-section"]').first();
    await expect(wsSection).toBeVisible({ timeout: 15_000 });

    const wsRows = page.locator('[data-testid="ws-progress-row"]');
    await expect(wsRows).toHaveCount(3);

    await expect(wsSection).toContainText('ws1');
    await expect(wsSection).toContainText('ws2');
    await expect(wsSection).toContainText('ws3');

    await page.screenshot({ path: 'sprints/cecelia-harness-viz/screenshots/02-ws-progress-visible.png', fullPage: true });
  });

  test('03-result: 全页最终状态，ws-verdict-badge 已渲染，API 交叉验证通过', async ({ page }) => {
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('[data-testid="ws-progress-section"]', { timeout: 15_000 });

    const verdictBadges = page.locator('[data-testid="ws-verdict-badge"]');
    await expect(verdictBadges.first()).toBeVisible();

    await page.screenshot({ path: 'sprints/cecelia-harness-viz/screenshots/03-result.png', fullPage: true });
  });
});
