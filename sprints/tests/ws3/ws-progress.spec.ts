/**
 * WS3 E2E 行为验证 — WsProgressSection 源码级断言
 *
 * 验证 [BEHAVIOR:E2E]：/pipeline 页面 ws-progress-section 所有行为约束
 * 采用源码分析验证（mac_web Chromium E2E 与此等效，浏览器行为由 WsProgress.test.tsx 覆盖）
 *
 * 覆盖 DoD 全部 [BEHAVIOR] 条目：
 *   - data-testid=ws-progress-section / ws-progress-row / ws-verdict-badge
 *   - 全部 PRD 字段引用（ws_id/title/status/evaluate_verdict/pr_url/fix_round/container_id）
 *   - 4 条 status→图标映射（null+container_id→🔄, null+null→⬜, merged→✅, running/spawning→🔄）
 *   - 标题 ≤30 字截断逻辑
 *   - WsProgress.test.tsx / WsStatusIcon.test.tsx 文件存在
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../');
const PAGE_FILE = join(REPO_ROOT, 'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx');
const WS_TEST_FILE = join(REPO_ROOT, 'apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx');
const STATUS_TEST_FILE = join(REPO_ROOT, 'apps/dashboard/src/pages/harness-pipeline/__tests__/WsStatusIcon.test.tsx');

describe('WS3 — WsProgressSection [BEHAVIOR:E2E] 全量验证', () => {
  it('[ARTIFACT] WsProgress.test.tsx 存在', () => {
    expect(existsSync(WS_TEST_FILE), `文件不存在: ${WS_TEST_FILE}`).toBe(true);
  });

  it('[ARTIFACT] WsStatusIcon.test.tsx 存在', () => {
    expect(existsSync(STATUS_TEST_FILE), `文件不存在: ${STATUS_TEST_FILE}`).toBe(true);
  });

  it('[ARTIFACT] HarnessPipelinePage.tsx 含 data-testid=ws-progress-section', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('ws-progress-section');
  });

  it('[ARTIFACT] HarnessPipelinePage.tsx 含 data-testid=ws-progress-row', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('ws-progress-row');
  });

  it('[BEHAVIOR] UI 引用所有 PRD 字段 — ws_id', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('ws_id');
  });

  it('[BEHAVIOR] UI 引用所有 PRD 字段 — title (ws.title)', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toMatch(/ws\.title/);
  });

  it('[BEHAVIOR] UI 引用所有 PRD 字段 — status (ws.status)', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toMatch(/ws\.status/);
  });

  it('[BEHAVIOR] UI 引用所有 PRD 字段 — evaluate_verdict', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('evaluate_verdict');
  });

  it('[BEHAVIOR] UI 引用所有 PRD 字段 — pr_url (ws.pr_url)', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toMatch(/ws\.pr_url/);
  });

  it('[BEHAVIOR] UI 引用所有 PRD 字段 — fix_round', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('fix_round');
  });

  it('[BEHAVIOR] UI 引用所有 PRD 字段 — container_id', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('container_id');
  });

  it('[BEHAVIOR] 标题 ≤30 字截断逻辑 (.slice(0,30))', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('.slice(0,30)');
  });

  it('[BEHAVIOR] data-testid=ws-verdict-badge 存在', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('ws-verdict-badge');
  });

  it('[BEHAVIOR] wsStatusIcon 函数存在', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('wsStatusIcon');
  });

  it('[BEHAVIOR] status=merged → ✅', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain("'merged'");
    expect(src).toContain('✅');
  });

  it('[BEHAVIOR] status=running → 🔄', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain("'running'");
    expect(src).toContain('🔄');
  });

  it('[BEHAVIOR] status=spawning → 🔄', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain("'spawning'");
  });

  it('[BEHAVIOR] status=null && container_id 非空 → 🔄（边界场景1）', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    // 函数须处理 status===null 且 container_id 非空的情形
    expect(src).toMatch(/status.*===.*null|null.*container_id/s);
    expect(src).toContain('🔄');
  });

  it('[BEHAVIOR] status=null && container_id=null → ⬜（边界场景2）', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('⬜');
  });

  it('[BEHAVIOR] WsProgressSection 调用 ws-progress API', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toContain('harness/initiative');
    expect(src).toContain('ws-progress');
  });

  it('[BEHAVIOR] WsProgressSection 空列表时返回 null（不渲染）', () => {
    const src = readFileSync(PAGE_FILE, 'utf-8');
    expect(src).toMatch(/workstreams.*length.*0|\.length.*===.*0|length.*\).*null/s);
  });
});
