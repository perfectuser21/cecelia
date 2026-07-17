import { test, expect } from '@playwright/test'

test('指挥舱首页 — 真首页渲染验收', async ({ page }) => {
  await page.goto('http://localhost:5211/')

  // 根容器
  await expect(page.locator('[data-testid="owner-cockpit"]')).toBeVisible({ timeout: 10000 })

  // 六指标卡 ≥6 个
  const metricCards = page.locator('[data-testid^="metric-card-"]')
  await expect(metricCards).toHaveCountGreaterThan(5)

  // 作战板
  await expect(page.locator('[data-testid="battle-card"]')).toBeVisible()

  // 截图存档
  await page.screenshot({ path: 'test-results/cockpit-e2e.png', fullPage: true })
})
