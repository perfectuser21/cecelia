import { test, expect } from '@playwright/test'

// 仅面向专用隔离前端；不默认连接本机生产代理。
const origin = process.env.DEBT_01_COCKPIT_ORIGIN
if (!origin) throw new Error('请显式设置隔离前端 DEBT_01_COCKPIT_ORIGIN')
const target = new URL(origin)
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)
  || !target.port || Number(target.port) < 1024 || ['5211', '5221', '5222'].includes(target.port)) {
  throw new Error('指挥舱验收仅允许专用本机非生产端口')
}

test('指挥舱概览 — 真实页面渲染验收', async ({ page }, testInfo) => {
  await page.goto(new URL('/workbench/overview', target).href)

  await expect(page.locator('[data-testid="owner-cockpit"]')).toBeVisible({ timeout: 10000 })
  const metricCards = page.locator('[data-testid^="metric-card-"]')
  await expect.poll(() => metricCards.count()).toBeGreaterThan(5)
  await expect(page.locator('[data-testid="battle-card"]')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('cockpit-e2e.png'), fullPage: true })
})
