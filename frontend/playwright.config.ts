import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5212',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 5212,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_FEISHU_APP_ID: process.env.VITE_FEISHU_APP_ID ?? 'ci_test_app_id',
      VITE_SUPER_ADMIN_FEISHU_IDS: '',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
