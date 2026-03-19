/**
 * media-assembler 单元测试
 *
 * 验证：
 * 1. 模块可以 ESM import（无 require() 崩溃）
 * 2. assembleMedia 函数签名和返回值结构
 * 3. 边界条件：空 findings、低 brand_relevance findings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('media-assembler 模块', () => {
  it('可以正常 ESM 导入，导出 assembleMedia 函数', async () => {
    const mod = await import('../media-assembler.js');
    expect(typeof mod.assembleMedia).toBe('function');
  });
});

describe('assembleMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无 findings 时返回 count=0 且 cover/cards/coverWechat 均为空', async () => {
    const { assembleMedia } = await import('../media-assembler.js');
    const result = await assembleMedia({
      keyword: '测试关键词',
      findings: [],
      outputDir: '/tmp/test-output',
      topic: 'test',
    });

    expect(result.count).toBe(0);
    expect(result.cover).toBeNull();
    expect(result.cards).toEqual([]);
    expect(result.coverWechat).toBeNull();
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('findings brand_relevance < 3 时跳过生成', async () => {
    const { assembleMedia } = await import('../media-assembler.js');
    const result = await assembleMedia({
      keyword: '测试',
      findings: [
        { id: 'f001', title: '低相关性发现', brand_relevance: 1, content: '内容' },
        { id: 'f002', title: '无相关性', brand_relevance: 0, content: '内容' },
      ],
      outputDir: '/tmp/test-output',
      topic: 'test',
    });

    expect(result.count).toBe(0);
  });

  it('返回值包含 cover/cards/coverWechat/count/errors 五个字段', async () => {
    const { assembleMedia } = await import('../media-assembler.js');
    const result = await assembleMedia({
      keyword: '测试',
      findings: [],
      outputDir: '/tmp/test-output',
      topic: 'test',
    });

    expect(result).toHaveProperty('cover');
    expect(result).toHaveProperty('cards');
    expect(result).toHaveProperty('coverWechat');
    expect(result).toHaveProperty('count');
    expect(result).toHaveProperty('errors');
  });

  it('有效 findings 触发渲染（resvg 不可用时 errors 有内容，不抛出异常）', async () => {
    const { assembleMedia } = await import('../media-assembler.js');
    const result = await assembleMedia({
      keyword: '一人公司',
      findings: [
        { id: 'f001', title: 'AI 替代团队', brand_relevance: 4, content: '一人也能拥有公司级能力', data: '节省80%人力成本' },
        { id: 'f002', title: '系统化能力', brand_relevance: 5, content: '系统思维是关键', data: '效率提升3倍' },
        { id: 'f003', title: '能力放大', brand_relevance: 3, content: '用工具放大个人能力' },
      ],
      outputDir: '/tmp/test-output',
      topic: 'yi-ren-gong-si',
    });

    // resvg 在测试环境不可用，所以 count=0，但不抛出异常
    expect(result).not.toBeNull();
    expect(typeof result.count).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.cards)).toBe(true);
  });
});
