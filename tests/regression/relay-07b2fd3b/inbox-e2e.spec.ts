import { test, expect, content } from '../manual-ui/fixture';

// inbox/index.ts 和 gtd/index.ts 已退役漏斗/详情抽屉：入口依次转交办台。
// 当前合同保留旧入口可达及历史数据可见；后端CRUD由隔离API集成测试负责。
for (const path of ['/inbox', '/gtd/inbox']) {
  test(`${path}旧入口进入交办台并可读历史记录`, async ({ page, origin }, info) => {
    await page.goto(`${origin}${path}`);
    await expect(page).toHaveURL(`${origin}/workbench/inbox`);
    await expect(page.getByRole('textbox', { name: '交办内容' })).toBeVisible();
    await expect(page.getByRole('button', { name: '提交交办' })).toBeVisible();
    await page.getByRole('link', { name: '旧记录' }).click();
    await expect(page).toHaveURL(`${origin}/workbench/inbox?view=history`);
    await expect(page.getByText(content, { exact: true })).toBeVisible();
    await expect(page.getByText('Raw Input', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('inbox-history.png'), fullPage: true });
    await page.getByRole('link', { name: '返回交办台' }).click();
    await expect(page.getByRole('textbox', { name: '交办内容' })).toBeVisible();
  });
}
