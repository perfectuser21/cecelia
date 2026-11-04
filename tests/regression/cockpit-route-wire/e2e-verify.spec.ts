import { test, expect } from '../manual-ui/fixture';

test('指挥舱真实路由、带值指标、作战任务与晨报展开', async ({ page, origin }, info) => {
  await page.goto(`${origin}/workbench/overview`);
  await expect(page.getByTestId('owner-cockpit')).toBeVisible();
  await expect(page.locator('[data-testid^="metric-card-"]')).toHaveCount(6);
  await expect(page.getByTestId('metric-card-completion-rate')).toContainText('75%');
  await expect(page.getByTestId('metric-card-completion-rate')).toContainText('12');
  await expect(page.getByTestId('battle-card')).toHaveCount(3);
  await expect(page.getByTestId('task-link-fixture-in_progress')).toHaveText('隔离任务-in_progress');
  await expect(page.getByTestId('task-link-fixture-blocked')).toHaveText('隔离任务-blocked');
  await page.getByTestId('diary-item-fixture-diary').getByRole('button').click();
  await expect(page.getByTestId('diary-item-fixture-diary-content')).toHaveText('浏览器点开后的晨报正文');
  await page.screenshot({ path: info.outputPath('cockpit.png'), fullPage: true });
});

test('指标接口断线显示缺值，其他任务仍真实显示', async ({ page, origin, api }, info) => {
  api.failStats = true;
  await page.goto(`${origin}/workbench/overview`);
  await expect(page.getByTestId('metric-card-completion-rate')).toContainText('--');
  await expect(page.getByTestId('metric-card-completion-rate')).not.toContainText('75%');
  await expect(page.getByTestId('task-link-fixture-in_progress')).toBeVisible();
  await page.screenshot({ path: info.outputPath('cockpit-stats-failure.png'), fullPage: true });
});
