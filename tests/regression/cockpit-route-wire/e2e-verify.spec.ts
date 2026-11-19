import { test, expect } from '../manual-ui/fixture';

test('指挥舱真实路由、带值指标、作战任务与晨报展开', async ({ page, origin }, info) => {
  await page.goto(`${origin}/workbench/overview`);
  await expect(page.getByTestId('owner-cockpit')).toBeVisible();
  await expect(page.locator('[data-testid^="metric-card-"]')).toHaveCount(3);
  await expect(page.getByTestId('metric-card-queue-health')).toContainText('1');
  await expect(page.getByTestId('battle-card')).toHaveCount(3);
  await expect(page.getByTestId('task-link-fixture-in_progress')).toHaveText('隔离任务-in_progress');
  await expect(page.getByTestId('task-link-fixture-blocked')).toHaveText('隔离任务-blocked');
  await page.getByTestId('diary-item-fixture-diary').getByRole('button').click();
  await expect(page.getByTestId('diary-item-fixture-diary-content')).toHaveText('浏览器点开后的晨报正文');
  await page.screenshot({ path: info.outputPath('cockpit.png'), fullPage: true });
});
