/**
 * Playwright 配置 — capture→立项去向链 E2E 回归测试
 * target_environment: mac_web（localhost:5211，本机 Playwright）
 * brain_url: localhost:5221
 *
 * 依赖：
 *   - Brain 服务运行于 localhost:5221（包含 migration 385 已应用）
 *   - Dashboard 服务运行于 localhost:5211（apps/dashboard vite dev）
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  timeout: 60_000,
  retries: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.DASHBOARD_URL || 'http://localhost:5211',
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
  outputDir: 'test-results',
});
