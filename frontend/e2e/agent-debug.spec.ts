import { test, expect } from '@playwright/test';

test('访问 /agent-debug → agent-status-bar 渲染并显示 Online/Offline', async ({ page }) => {
  // Mock Brain health 接口，CI 里无真实 Brain 服务
  await page.route('/api/brain/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    })
  );

  await page.goto('/agent-debug');

  const statusBar = page.locator('[data-testid="agent-status-bar"]');
  await expect(statusBar).toBeVisible({ timeout: 5000 });

  // 状态文字必须稳定到 Online 或 Offline（不能永远停在"检测中..."）
  await expect(statusBar).toContainText(/Online|Offline/, { timeout: 5000 });
});
