import { test, expect } from '../manual-ui/fixture';
test('旧 Inbox 漏斗合同', async ({ page, origin }) => {
  await page.goto(`${origin}/inbox`);
  await expect(page.locator('[data-testid="stage-count"]')).toHaveCount(4);
});
