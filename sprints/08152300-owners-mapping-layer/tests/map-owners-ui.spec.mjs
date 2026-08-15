// Level-2 声明驱动渲染 UI 断言（mac_web / Playwright chromium）。
// 由 ## E2E 验收 段在 vite preview(5174) 就绪后以 `node` 执行。
import { chromium, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5174';
const SHOTS = process.env.SPRINT_SHOTS || 'sprints/08152300-owners-mapping-layer/screenshots';
const OWNED_FILE = 'packages/brain/src/map/radius.test.js';

const browser = await chromium.launch();
const page = await browser.newPage();
let failed = false;
try {
  // MapPage 默认 scope=cecelia（useState('cecelia')），无需 query 参数
  await page.goto(`${BASE}/map`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: `${SHOTS}/01-map-initial.png` });

  const mj5 = page.getByRole('button', { name: /MJ5/ }).first();
  await expect(mj5).toBeVisible({ timeout: 15000 });
  await mj5.click();

  await expect(page.getByText(/Level 2/)).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/02-mj5-level2.png` });

  // 声明驱动：Level-2 事实锚点列表出现真实文件路径（非 UUID 串）
  await expect(page.getByText(OWNED_FILE, { exact: false }).first())
    .toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/03-owned-paths.png` });
  console.log('UI PASS: Level-2 MJ5 owned path visible');
} catch (error) {
  failed = true;
  console.error('UI FAIL:', error && error.message ? error.message : error);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
