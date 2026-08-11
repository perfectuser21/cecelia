import { expect, test } from '@playwright/test';

test('HK 生产入口 WebKit 私密新上下文等待刷新后保持 /workbench/tasks', async ({ browser, browserName }) => {
  expect(browserName).toBe('webkit');
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto('http://100.86.118.99:5211/workbench/tasks', { waitUntil: 'networkidle', timeout: 20_000 });
  expect(new URL(page.url()).pathname).toBe('/workbench/tasks');
  await page.waitForTimeout(10_000);
  expect(new URL(page.url()).pathname).toBe('/workbench/tasks');
  await page.reload({ waitUntil: 'networkidle', timeout: 20_000 });
  await page.waitForTimeout(10_000);
  expect(new URL(page.url()).pathname).toBe('/workbench/tasks');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await page.screenshot({ path: 'sprints/08111145-kernel-be8babea/screenshots/hk-workbench-tasks.png', fullPage: true });
  await context.close();
});

