/**
 * Playwright 配置 — 军师台形态对版收尾 E2E 测试
 * task_id: 184c6da1-ef57-4171-ba92-5b05711076e6
 * target_environment: mac_web (localhost:5174)
 * brain_url: localhost:5221
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
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
