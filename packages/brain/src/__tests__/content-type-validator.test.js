/**
 * content-type-validator 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock content-type-registry
vi.mock('../content-types/content-type-registry.js', () => ({
  listContentTypes: vi.fn(),
  getContentType: vi.fn(),
}));

import { listContentTypes, getContentType } from '../content-types/content-type-registry.js';
import { validateContentType, validateAllContentTypes } from '../content-types/content-type-validator.js';

// ── validateContentType 测试 ──────────────────────────

describe('validateContentType', () => {
  it('有效配置返回 valid=true, errors=[]', () => {
    const config = {
      content_type: 'solo-company-case',
      images: { count: 9, format: 'svg' },
      template: {
        generate_prompt: '生成关于 {keyword} 的9张信息图',
        research_prompt: '调研 {keyword}',
      },
      review_rules: [],
      copy_rules: {},
    };
    const result = validateContentType(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('缺少 content_type 时返回错误', () => {
    const config = {
      images: { count: 9 },
      template: { generate_prompt: '生成内容' },
    };
    const result = validateContentType(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('content_type'))).toBe(true);
  });

  it('缺少 images.count 时返回错误', () => {
    const config = {
      content_type: 'solo-company-case',
      images: {},
      template: { generate_prompt: '生成内容' },
    };
    const result = validateContentType(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('images.count'))).toBe(true);
  });

  it('缺少 template.generate_prompt 时返回错误', () => {
    const config = {
      content_type: 'solo-company-case',
      images: { count: 9 },
      template: {},
    };
    const result = validateContentType(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('template.generate_prompt'))).toBe(true);
  });

  it('config 为 null 时返回错误', () => {
    const result = validateContentType(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('同时缺少多个字段时 errors 含多条', () => {
    const result = validateContentType({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ── validateAllContentTypes 测试 ──────────────────────

describe('validateAllContentTypes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('所有类型有效时 valid=true', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    getContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      images: { count: 9 },
      template: { generate_prompt: '生成内容' },
    });

    const result = await validateAllContentTypes();
    expect(result.valid).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('solo-company-case');
    expect(result.results[0].valid).toBe(true);
  });

  it('有类型无效时 valid=false', async () => {
    listContentTypes.mockResolvedValue(['bad-type']);
    getContentType.mockResolvedValue({
      content_type: 'bad-type',
      // 缺 images 和 template
    });

    const result = await validateAllContentTypes();
    expect(result.valid).toBe(false);
    expect(result.results[0].valid).toBe(false);
    expect(result.results[0].errors.length).toBeGreaterThan(0);
  });

  it('getContentType 抛出异常时 valid=false', async () => {
    listContentTypes.mockResolvedValue(['broken-type']);
    getContentType.mockRejectedValue(new Error('YAML 解析失败'));

    const result = await validateAllContentTypes();
    expect(result.valid).toBe(false);
    expect(result.results[0].errors[0]).toContain('加载失败');
  });

  it('listContentTypes 抛出异常时返回目录读取错误', async () => {
    listContentTypes.mockRejectedValue(new Error('目录不存在'));

    const result = await validateAllContentTypes();
    expect(result.valid).toBe(false);
    expect(result.results[0].name).toBe('__directory__');
  });

  it('多个类型时汇总所有结果', async () => {
    listContentTypes.mockResolvedValue(['type-a', 'type-b']);
    getContentType
      .mockResolvedValueOnce({
        content_type: 'type-a',
        images: { count: 3 },
        template: { generate_prompt: '提示词A' },
      })
      .mockResolvedValueOnce({
        content_type: 'type-b',
        // 缺 images 和 template
      });

    const result = await validateAllContentTypes();
    expect(result.valid).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].valid).toBe(true);
    expect(result.results[1].valid).toBe(false);
  });
});
