/**
 * WS2 TDD Red Phase — Playwright
 * HarnessPipelineDetailPage SSE 日志区尚未实现，以下所有 test 应 FAIL
 * Generator 实现 EventSource + SSE log UI 后变 Green
 *
 * baseURL: http://localhost:5211 (apps/dashboard dev server)
 */
import { test, expect } from '@playwright/test';

const MOCK_TASK_ID = 'test-pipeline-00000000-0000-0000-sse1';

const SSE_MOCK_BODY = [
  'event: node_update',
  'data: {"node":"proposer","label":"Proposer","attempt":1,"ts":"2026-05-16T10:00:00Z"}',
  '',
  'event: node_update',
  'data: {"node":"generator","label":"Generator","attempt":1,"ts":"2026-05-16T10:01:00Z"}',
  '',
  'event: done',
  'data: {"status":"completed","verdict":"PASS"}',
  '',
  '',
].join('\n');

test.describe('WS2 — SSE 实时日志区 [BEHAVIOR]', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/brain/harness/stream**', route => {
      const url = route.request().url();
      (page as unknown as Record<string, unknown>)._interceptedSseUrl = url;
      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        },
        body: SSE_MOCK_BODY,
      });
    });

    await page.route('**/api/brain/harness/pipeline/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pipeline_id: MOCK_TASK_ID,
          status: 'in_progress',
          tasks: [],
        }),
      });
    });

    await page.route('**/api/brain/harness/pipeline-detail**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pipeline_id: MOCK_TASK_ID, stages: [], langgraph: { enabled: false } }),
      });
    });
  });

  test('EventSource URL 含 planner_task_id query 参数（禁用 id/taskId/pipeline_id）', async ({ page }) => {
    let capturedUrl = '';
    await page.route('**/api/brain/harness/stream**', async (route) => {
      capturedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: SSE_MOCK_BODY,
      });
    });

    await page.goto(`/pipeline/${MOCK_TASK_ID}`);
    await page.waitForTimeout(3000);

    expect(capturedUrl).toContain('planner_task_id=');
    expect(capturedUrl).not.toMatch(/[?&](id|taskId|task_id|pipeline_id|tid)=/);
  });

  test('SSE 日志区可见 — [data-testid="sse-log"] 在详情页渲染', async ({ page }) => {
    await page.goto(`/pipeline/${MOCK_TASK_ID}`);
    await expect(page.locator('[data-testid="sse-log"]')).toBeVisible({ timeout: 10_000 });
  });

  test('日志行含节点 label — node_update 事件后日志区含 "Proposer" 文字', async ({ page }) => {
    await page.goto(`/pipeline/${MOCK_TASK_ID}`);
    const logArea = page.locator('[data-testid="sse-log"]');
    await expect(logArea).toBeVisible({ timeout: 10_000 });
    await expect(logArea).toContainText('Proposer', { timeout: 8_000 });
    await expect(logArea).toContainText('Generator', { timeout: 8_000 });
  });

  test('完成消息 — event: done 后页面含 "Pipeline 已完成" 文本', async ({ page }) => {
    await page.goto(`/pipeline/${MOCK_TASK_ID}`);
    await expect(page.getByText(/Pipeline 已完成/)).toBeVisible({ timeout: 15_000 });
  });

  test('verdict 显示 — done.verdict="PASS" 时页面含 "PASS" 文本', async ({ page }) => {
    // SSE_MOCK_BODY 中 done event data 含 "verdict":"PASS"，UI 必须渲染该文本
    await page.goto(`/pipeline/${MOCK_TASK_ID}`);
    await expect(page.getByText(/PASS/)).toBeVisible({ timeout: 15_000 });
  });
});
