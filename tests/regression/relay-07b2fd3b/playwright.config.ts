/**
 * Playwright 配置 — Inbox P1 E2E 测试
 * target_environment: mac_web (localhost:5174)
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*e2e.spec.ts'],
  timeout: 60_000,
  retries: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../screenshots/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.DASHBOARD_URL || 'http://localhost:5174',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: '../screenshots/test-results',
});
