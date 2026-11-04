import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '..',
  testMatch: ['cockpit-route-wire/e2e-verify.spec.ts', 'relay-07b2fd3b/inbox-e2e.spec.ts', 'capture-destination-link/capture-destination-link.spec.ts'],
  timeout: 20000, retries: 0, workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.MANUAL_UI_REPORT || '/tmp/cecelia-ci-manual-ui/playwright.json' }]],
  use: { ...devices['Desktop Chrome'], headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: process.env.MANUAL_UI_OUTPUT || '/tmp/cecelia-ci-manual-ui/artifacts',
});
