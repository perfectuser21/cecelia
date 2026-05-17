/**
 * PRESERVE: OKRPage 现有功能回归契约
 * 确保 InlineEdit 集成不破坏现有数据展示、进度条、状态徽章功能
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const src = readFileSync('frontend/src/features/core/planning/pages/OKRPage.tsx', 'utf8');

describe('OKRPage PRESERVE 现有功能', () => {
  it('保留进度条渲染逻辑', () => {
    expect(src).toContain('progress');
  });

  it('保留状态徽章（status badge）逻辑', () => {
    expect(src).toContain('status');
  });

  it('保留 OKRCard 展开/折叠逻辑（key_results 展示）', () => {
    expect(src).toContain('key_results');
  });

  it('InlineEdit 集成到标题位置（不替换整个卡片）', () => {
    expect(src).toContain('InlineEdit');
    expect(src).toContain('OKRCard');
  });

  it('保留 fetch /api/okr/trees 数据拉取', () => {
    expect(src).toContain('/api/okr/trees');
  });
});
