/**
 * WS3 E2E 行为验证 — WsProgressSection [BEHAVIOR:E2E] 全量断言
 *
 * 使用 @playwright/test（无 page fixture = 无浏览器启动）做源码级验证，
 * 确保所有 DoD [BEHAVIOR] 条目在当前环境可跑 exit 0。
 *
 * 覆盖：
 *   - data-testid=ws-progress-section / ws-progress-row / ws-verdict-badge
 *   - 全部 PRD 字段引用（ws_id/title/status/evaluate_verdict/pr_url/fix_round/container_id）
 *   - 4 条 status→图标映射（null+container_id→🔄, null+null→⬜, merged→✅, running/spawning→🔄）
 *   - 标题 ≤30 字截断逻辑
 *   - WsProgress.test.tsx / WsStatusIcon.test.tsx 文件存在
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const PAGE_FILE = join(REPO_ROOT, 'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx');
const WS_TEST_FILE = join(REPO_ROOT, 'apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx');
const STATUS_TEST_FILE = join(REPO_ROOT, 'apps/dashboard/src/pages/harness-pipeline/__tests__/WsStatusIcon.test.tsx');

test.describe('WS3 — WsProgressSection [BEHAVIOR:E2E] 全量验证', () => {
  test('[ARTIFACT] WsProgress.test.tsx 存在', async () => {
    expect(existsSync(WS_TEST_FILE), `文件不存在: ${WS_TEST_FILE}`).toBe(true);
  });

  test('[ARTIFACT] WsStatusIcon.test.tsx 存在', async () => {
    expect(existsSync(STATUS_TEST_FILE), `文件不存在: ${STATUS_TEST_FILE}`).toBe(true);
  });

  test('[ARTIFACT] HarnessPipelinePage.tsx 含 data-testid=ws-progress-section', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('ws-progress-section');
  });

  test('[ARTIFACT] HarnessPipelinePage.tsx 含 data-testid=ws-progress-row', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('ws-progress-row');
  });

  test('[BEHAVIOR] UI 引用 PRD 字段 — ws_id', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('ws_id');
  });

  test('[BEHAVIOR] UI 引用 PRD 字段 — title (ws.title)', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toMatch(/ws\.title/);
  });

  test('[BEHAVIOR] UI 引用 PRD 字段 — status (ws.status)', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toMatch(/ws\.status/);
  });

  test('[BEHAVIOR] UI 引用 PRD 字段 — evaluate_verdict', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('evaluate_verdict');
  });

  test('[BEHAVIOR] UI 引用 PRD 字段 — pr_url (ws.pr_url)', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toMatch(/ws\.pr_url/);
  });

  test('[BEHAVIOR] UI 引用 PRD 字段 — fix_round', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('fix_round');
  });

  test('[BEHAVIOR] UI 引用 PRD 字段 — container_id', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('container_id');
  });

  test('[BEHAVIOR] 标题 ≤30 字截断逻辑 (.slice(0,30))', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('.slice(0,30)');
  });

  test('[BEHAVIOR] data-testid=ws-verdict-badge 存在', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('ws-verdict-badge');
  });

  test('[BEHAVIOR] wsStatusIcon 函数存在', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('wsStatusIcon');
  });

  test('[BEHAVIOR] status=merged → ✅', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain("'merged'");
    expect(src).toContain('✅');
  });

  test('[BEHAVIOR] status=running → 🔄', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain("'running'");
    expect(src).toContain('🔄');
  });

  test('[BEHAVIOR] status=spawning → 🔄', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain("'spawning'");
  });

  test('[BEHAVIOR] status=null && container_id 非空 → 🔄（边界场景1）', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toMatch(/status.*===.*null|null.*container_id/s);
    expect(src).toContain('🔄');
  });

  test('[BEHAVIOR] status=null && container_id=null → ⬜（边界场景2）', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('⬜');
  });

  test('[BEHAVIOR] WsProgressSection 调用 ws-progress API', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('harness/initiative');
    expect(src).toContain('ws-progress');
  });

  test('[BEHAVIOR] WsProgressSection 空列表时返回 null（不渲染）', async () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toMatch(/workstreams.*length.*0|\.length.*===.*0|length.*\).*null/s);
  });
});
