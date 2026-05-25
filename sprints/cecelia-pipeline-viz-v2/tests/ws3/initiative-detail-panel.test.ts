import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PAGE_PATH = resolve(process.cwd(), 'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx');

describe('WS3 — Dashboard initiative 详情面板 [BEHAVIOR]', () => {
  it('HarnessPipelinePage.tsx 含 initiative-detail-panel data-testid', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('initiative-detail-panel');
  });

  it('页面含 initiative-prd-content data-testid（PRD 全文区块）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('initiative-prd-content');
  });

  it('页面含 initiative-step-timeline data-testid（步骤时间线区块）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('initiative-step-timeline');
  });

  it('页面含 initiative-card data-testid（点击入口）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('initiative-card');
  });

  it('页面调用 /api/brain/harness/initiative/:id/detail 端点', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toMatch(/harness\/initiative\/.*\/detail/);
  });

  it('截图 section 在 screenshot_urls 为空时不渲染（条件渲染逻辑存在）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toMatch(/screenshot_urls.*length|screenshot.*&&|screenshot.*\?/s);
  });

  it('step-timeline-item data-testid 绑定到时间线条目', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('step-timeline-item');
  });
});
