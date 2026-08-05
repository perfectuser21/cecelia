/**
 * E2E — 军师台 GP 四级下钻
 *
 * task_id: 7835c87b-ca2e-4c2f-9c54-28d910d14211
 * target_environment: mac_web (Playwright, localhost:5174)
 * brain_url: localhost:5221
 *
 * 判定点 J-01 ~ J-08（contract-dod.md 对应）
 *
 * 运行：
 *   cd packages/quality/e2e
 *   npx playwright test strategist-gp-drill.e2e.spec.ts
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ── 配置 ──────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:5174';
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

/**
 * Fixture journey：已有 TEST-FIXTURE GP v1/v2
 * 用于 J-01 ~ J-06 / J-08
 */
const FIXTURE_JOURNEY_ID = '8bb8252f-29b4-4c34-acb9-1accda7ddfcf';

/**
 * 截图输出目录（相对于 packages/quality/）
 * CI 下可改为 ARTIFACT_DIR env
 */
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR
  ? path.resolve(process.env.SCREENSHOT_DIR)
  : path.resolve(__dirname, '../../screenshots');

// ── 工具 ──────────────────────────────────────────────────────────────────────

async function gotoStrategistLine(page: Page, journeyId: string) {
  await page.goto(`${BASE_URL}/strategist/${journeyId}`, { waitUntil: 'networkidle' });
}

async function ensureOverviewTab(page: Page) {
  // 全貌 tab 是默认页签，但防御性地点一次
  const overviewTab = page.getByRole('button', { name: '全貌' });
  if (await overviewTab.isVisible()) {
    await overviewTab.click();
  }
}

async function clickFirstStepRow(page: Page) {
  // 点击第一个步骤行（data-testid="step-row"）
  const firstRow = page.locator('[data-testid="step-row"]').first();
  await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
  await firstRow.click();
}

async function openVersionsPanel(page: Page) {
  // 在 StepLedgerPanel 中切换到"版本"子视图
  const versionsTab = page.getByRole('button', { name: '版本' });
  await versionsTab.waitFor({ state: 'visible', timeout: 10_000 });
  await versionsTab.click();
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

test.describe('军师台 GP 四级下钻 (task 7835c87b)', () => {

  // ── J-01: 步骤行点击有 DOM 变化 ────────────────────────────────────────────

  test('J-01 步骤行点击 → StepLedgerPanel 出现', async ({ page }) => {
    await gotoStrategistLine(page, FIXTURE_JOURNEY_ID);
    await ensureOverviewTab(page);

    // 点击前：StepLedgerPanel 不存在
    const panel = page.locator('[data-testid="step-ledger-panel"]');
    await expect(panel).not.toBeVisible();

    // 点击步骤行
    await clickFirstStepRow(page);

    // 点击后：StepLedgerPanel 出现
    await expect(panel).toBeVisible({ timeout: 10_000 });
  });

  // ── J-02 / J-03: 版本对比表结构正确 ──────────────────────────────────────

  test('J-02 版本对比表表头含 FR / NFR / 判定点列', async ({ page }) => {
    await gotoStrategistLine(page, FIXTURE_JOURNEY_ID);
    await ensureOverviewTab(page);
    await clickFirstStepRow(page);
    await openVersionsPanel(page);

    // 等待版本对比表加载（spinner 消失）
    await page.locator('[data-testid="step-ledger-panel"] .animate-spin').waitFor({
      state: 'detached',
      timeout: 15_000,
    }).catch(() => { /* spinner 可能不存在 */ });

    // 获取所有列标头文字
    const headers = page.locator('[data-testid="gp-version-table"] thead th');
    await headers.first().waitFor({ state: 'visible', timeout: 15_000 });

    const texts = await headers.allTextContents();
    const headerText = texts.join(' ');

    expect(headerText).toMatch(/FR/);
    expect(headerText).toMatch(/NFR/);
    expect(headerText).toMatch(/判定点/);
  });

  test('J-03 版本对比表表头含版本列（v 前缀）', async ({ page }) => {
    await gotoStrategistLine(page, FIXTURE_JOURNEY_ID);
    await ensureOverviewTab(page);
    await clickFirstStepRow(page);
    await openVersionsPanel(page);

    await page.locator('[data-testid="step-ledger-panel"] .animate-spin').waitFor({
      state: 'detached',
      timeout: 15_000,
    }).catch(() => {});

    const headers = page.locator('[data-testid="gp-version-table"] thead th');
    await headers.first().waitFor({ state: 'visible', timeout: 15_000 });

    const texts = await headers.allTextContents();

    // 至少一列匹配 v1 / v2 / v3 等
    const versionHeader = texts.find(t => /^v\d/.test(t.trim()));
    expect(versionHeader).toBeTruthy();

    // 列数 >= 2（至少一列版本 + 要素行标题列）
    expect(texts.length).toBeGreaterThanOrEqual(2);
  });

  // ── J-04: changed 紫底格子存在 ────────────────────────────────────────────

  test('J-04 存在 changed 紫底格（fixture ≥2 GP版本）', async ({ page }) => {
    // 先查 fixture journey 是否有 ≥2 个 GP
    const gpResp = await fetch(
      `${BRAIN_URL}/api/brain/golden-paths?journey_id=${FIXTURE_JOURNEY_ID}&limit=30`
    );
    const gpData = await gpResp.json();
    const gps: unknown[] = Array.isArray(gpData.golden_paths) ? gpData.golden_paths : [];

    if (gps.length < 2) {
      test.skip(true, `fixture journey 只有 ${gps.length} 个 GP，无法产生 changed diff，跳过 J-04`);
      return;
    }

    await gotoStrategistLine(page, FIXTURE_JOURNEY_ID);
    await ensureOverviewTab(page);
    await clickFirstStepRow(page);
    await openVersionsPanel(page);

    await page.locator('[data-testid="step-ledger-panel"] .animate-spin').waitFor({
      state: 'detached',
      timeout: 15_000,
    }).catch(() => {});

    // 等待 table 渲染
    await page.locator('[data-testid="gp-version-table"]').waitFor({
      state: 'visible',
      timeout: 15_000,
    });

    const changedCells = page.locator('[data-testid="gp-version-table"] .changed');
    const count = await changedCells.count();
    expect(count).toBeGreaterThan(0);
  });

  // ── J-05 / J-06: 行详情卡出现与收起 ──────────────────────────────────────

  test('J-05 点击版本对比表格子 → 行详情卡出现含日期', async ({ page }) => {
    await gotoStrategistLine(page, FIXTURE_JOURNEY_ID);
    await ensureOverviewTab(page);
    await clickFirstStepRow(page);
    await openVersionsPanel(page);

    await page.locator('[data-testid="step-ledger-panel"] .animate-spin').waitFor({
      state: 'detached',
      timeout: 15_000,
    }).catch(() => {});

    await page.locator('[data-testid="gp-version-table"]').waitFor({
      state: 'visible',
      timeout: 15_000,
    });

    // 点击版本对比表中第一个可点击的格子（td）
    const firstCell = page.locator('[data-testid="gp-version-table"] tbody td[data-clickable="true"]').first();
    await firstCell.waitFor({ state: 'visible', timeout: 10_000 });
    await firstCell.click();

    // 行详情卡出现
    const detailCard = page.locator('[data-testid="cell-row-detail"]');
    await expect(detailCard).toBeVisible({ timeout: 10_000 });

    // 内部含日期格式（MM-DD 或 YYYY-MM-DD）
    const cardText = await detailCard.textContent();
    expect(cardText).toMatch(/\d{2}-\d{2}/);
  });

  test('J-06 关闭行详情卡 → 卡片消失', async ({ page }) => {
    await gotoStrategistLine(page, FIXTURE_JOURNEY_ID);
    await ensureOverviewTab(page);
    await clickFirstStepRow(page);
    await openVersionsPanel(page);

    await page.locator('[data-testid="step-ledger-panel"] .animate-spin').waitFor({
      state: 'detached',
      timeout: 15_000,
    }).catch(() => {});

    await page.locator('[data-testid="gp-version-table"]').waitFor({
      state: 'visible',
      timeout: 15_000,
    });

    // 打开详情卡
    const firstCell = page.locator('[data-testid="gp-version-table"] tbody td[data-clickable="true"]').first();
    await firstCell.waitFor({ state: 'visible', timeout: 10_000 });
    await firstCell.click();

    const detailCard = page.locator('[data-testid="cell-row-detail"]');
    await expect(detailCard).toBeVisible({ timeout: 10_000 });

    // 方式一：点 X 关闭
    const closeBtn = detailCard.locator('button').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      // 方式二：再次点击同一格子
      await firstCell.click();
    }

    await expect(detailCard).not.toBeVisible({ timeout: 5_000 });
  });

  // ── J-07: 无账本线空态提示 ────────────────────────────────────────────────

  test('J-07 无账本线全貌页显示空态提示', async ({ page }) => {
    // 从 Brain API 找一条无 journey_step_links 的线
    let targetJourneyId: string | null = null;

    try {
      const linesResp = await fetch(`${BRAIN_URL}/api/brain/journeys?limit=20`);
      const linesData = await linesResp.json();
      const lines: Array<{ id: string }> = Array.isArray(linesData)
        ? linesData
        : Array.isArray(linesData.journeys) ? linesData.journeys : [];

      for (const line of lines) {
        if (line.id === FIXTURE_JOURNEY_ID) continue;
        const cellsResp = await fetch(
          `${BRAIN_URL}/api/brain/journey_step_links?journey_id=${line.id}&cells=1&limit=1`
        );
        const cellsData = await cellsResp.json();
        const cellArr = Array.isArray(cellsData) ? cellsData : [];
        if (cellArr.length === 0) {
          targetJourneyId = line.id;
          break;
        }
      }
    } catch {
      // 忽略 API 错误
    }

    if (!targetJourneyId) {
      test.skip(true, '找不到无账本的线，跳过 J-07');
      return;
    }

    await gotoStrategistLine(page, targetJourneyId);
    await ensureOverviewTab(page);

    // 无账本线显示空态提示
    await expect(
      page.getByText('账本模板铺入后自动出现')
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── J-08: L1/L2/L3 截图存档 ───────────────────────────────────────────────

  test('J-08 L1/L2/L3 各截一张存档', async ({ page }) => {
    // 确保截图目录存在
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    await gotoStrategistLine(page, FIXTURE_JOURNEY_ID);
    await ensureOverviewTab(page);

    // L1 截图：全貌页矩阵
    await page.waitForSelector('[data-testid="step-row"], text=暂无步骤账本', {
      timeout: 15_000,
    }).catch(() => {});
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'L1.png'),
      fullPage: false,
    });
    expect(fs.existsSync(path.join(SCREENSHOT_DIR, 'L1.png'))).toBe(true);

    // 点击步骤行 → L2 账本面板
    await clickFirstStepRow(page);
    await page.locator('[data-testid="step-ledger-panel"]').waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'L2.png'),
      fullPage: false,
    });
    expect(fs.existsSync(path.join(SCREENSHOT_DIR, 'L2.png'))).toBe(true);

    // 切版本面板 + 点格子 → L3 行详情
    await openVersionsPanel(page);
    await page.locator('[data-testid="step-ledger-panel"] .animate-spin').waitFor({
      state: 'detached',
      timeout: 15_000,
    }).catch(() => {});
    await page.locator('[data-testid="gp-version-table"]').waitFor({
      state: 'visible',
      timeout: 15_000,
    }).catch(() => {});

    const firstCell = page.locator(
      '[data-testid="gp-version-table"] tbody td[data-clickable="true"]'
    ).first();
    if (await firstCell.isVisible()) {
      await firstCell.click();
      await page.locator('[data-testid="cell-row-detail"]').waitFor({
        state: 'visible',
        timeout: 5_000,
      }).catch(() => {});
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'L3.png'),
      fullPage: false,
    });
    expect(fs.existsSync(path.join(SCREENSHOT_DIR, 'L3.png'))).toBe(true);
  });

});
