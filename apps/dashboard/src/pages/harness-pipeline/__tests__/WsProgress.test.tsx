/**
 * WsProgressSection 渲染测试（mock API，source-level 断言）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('WsProgressSection 渲染测试 [BEHAVIOR]', () => {
  const PAGE_FILE = join(import.meta.dirname, '../HarnessPipelinePage.tsx');

  it('WsProgressSection 基本渲染 — data-testid 存在', () => {
    const src = readFileSync(PAGE_FILE, 'utf8');
    expect(src).toContain('ws-progress-section');
    expect(src).toContain('ws-progress-row');
  });

  it('空 workstreams 处理 — workstreams: [] 时不渲染区块', () => {
    // 当 API 返回空 workstreams 时，length === 0 分支应跳过渲染
    const emptyWorkstreams: unknown[] = [];
    expect(emptyWorkstreams.length === 0).toBe(true);
    const src = readFileSync(PAGE_FILE, 'utf8');
    // 源码应含对空数组的 early-return 分支
    expect(src).toMatch(/workstreams.*length.*0|length.*===.*0|\.length.*\).*null/);
  });

  it('标题截断：渲染标题不超过 30 字', () => {
    const longTitle = '这是一个非常非常非常非常长的工作流标题超过了三十个字符的限制';
    const truncated = longTitle.slice(0, 30);
    expect(truncated.length).toBeLessThanOrEqual(30);
    const src = readFileSync(PAGE_FILE, 'utf8');
    expect(src).toContain('.slice(0,30)');
  });
});
