import { test, expect, captureId, initiativeId, initiative, content } from '../manual-ui/fixture';

// 现行真实入口为交办台历史记录与 /gtd/initiatives/:id；无旧 /planning/initiatives 路由。
test('历史capture归位选立项、去向跳转、反向记录和返回交办台', async ({ page, origin, api }, info) => {
  await page.goto(`${origin}/workbench/inbox?view=history`);
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  await page.getByTestId(`capture-done-btn-${captureId}`).click();
  await expect(page.getByText('选择去向立项', { exact: true })).toBeVisible();
  await page.getByPlaceholder('搜索立项...').fill('不存在的立项');
  await expect(page.getByText('无匹配立项', { exact: true })).toBeVisible();
  expect(api.patches).toEqual([]);
  await page.getByPlaceholder('搜索立项...').fill('浏览器');
  await page.getByRole('button', { name: initiative.title, exact: true }).click();
  await expect.poll(() => api.patches).toEqual([{ status: 'done', destination_type: 'initiative', destination_id: initiativeId }]);
  await page.getByTestId(`capture-destination-link-${captureId}`).click();
  await expect(page).toHaveURL(`${origin}/gtd/initiatives/${initiativeId}`);
  const section = page.getByTestId('initiative-captures-section');
  await expect(section).toBeVisible();
  await expect(section.getByTestId(`initiative-capture-${captureId}`)).toContainText(content);
  await expect(section).toContainText('(1)');
  await expect(section).not.toContainText('其他立项记录不得混入');
  await page.screenshot({ path: info.outputPath('capture-destination-backlink.png'), fullPage: true });
  await page.getByTestId('back-to-inbox-link').click();
  await expect(page).toHaveURL(`${origin}/workbench/inbox`);
  await expect(page.getByRole('textbox', { name: '交办内容' })).toBeVisible();
});
