/**
 * final-e2e（模式 B）— mac_web Playwright，localhost:5174
 *
 * Golden Path：用户打开 harness task PRD 页 → 完整 PrepPRD 以 Markdown 渲染。
 * 数据获取边界（GET /api/brain/tasks/:id）用 page.route 注入 fixture——拦截的只是外部数据边界
 * （后端写入侧本 Sprint 明确不在范围内）；被测核心 pickPrdContent 优先级 + react-markdown 渲染管线
 * 全部真实执行，generator 不实现则断言 FAIL。
 */
import { test, expect } from '@playwright/test';

const TASK_ID = 'e2e-prepprd-task';
const PREP_PRD = [
  '# PrepPRD 全文标题',
  '',
  '## Golden Path',
  '',
  '用户打开 PRD 页 → 看到完整 PrepPRD',
  '',
  '## 前置',
  '',
  '- 前置条件一',
  '- 前置条件二',
  '',
  '## 验收',
  '',
  '| 项 | 期望 |',
  '| --- | --- |',
  '| 渲染 | Markdown |',
].join('\n');

test('打开 harness task PRD 页 → 完整 PrepPRD 以 Markdown 渲染', async ({ page }) => {
  await page.route(`**/api/brain/tasks/${TASK_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: TASK_ID,
        title: 'E2E PrepPRD Task',
        status: 'in_progress',
        priority: 'P1',
        task_type: 'harness_contract_propose',
        description: 'OLD-description-should-not-show',
        prd_content: null,
        pr_url: null,
        created_at: '2026-06-17T00:00:00Z',
        updated_at: '2026-06-17T00:00:00Z',
        completed_at: null,
        payload: { prep_prd_body: PREP_PRD },
      }),
    })
  );

  await page.goto(`http://localhost:5174/tasks/${TASK_ID}/prd`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });

  // 完整 PrepPRD 全文小节标题文字可见
  await expect(page.getByText('PrepPRD 全文标题')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Golden Path')).toBeVisible();
  await expect(page.getByText('前置')).toBeVisible();
  await expect(page.getByText('验收')).toBeVisible();
  await page.screenshot({ path: 'screenshots/02-action.png' });

  // Markdown 渲染为真实 DOM，而非单一 <pre> 纯文本
  await expect(page.locator('[data-testid="prd-content"] h1')).toHaveCount(1);
  await expect(page.locator('[data-testid="prd-content"] h2').first()).toBeVisible();
  await expect(page.locator('[data-testid="prd-content"] ul li').first()).toBeVisible();
  await expect(page.locator('[data-testid="prd-content"] table')).toHaveCount(1);
  await expect(
    page.locator('[data-testid="prd-content"] pre', { hasText: '# PrepPRD' })
  ).toHaveCount(0);

  // prep_prd_body 优先：旧 description 不出现
  await expect(page.getByText('OLD-description-should-not-show')).toHaveCount(0);

  await page.screenshot({ path: 'screenshots/03-result.png' });
});
