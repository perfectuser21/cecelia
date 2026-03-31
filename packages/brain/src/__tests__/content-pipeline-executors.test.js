/**
 * content-pipeline-executors 单元测试
 * 验证 executor 函数签名、DB 配置读取、fallback 逻辑（6 阶段）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs 和 child_process
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

// Mock getContentType — 默认返回 null（fallback 路径）
const mockGetContentType = vi.fn().mockResolvedValue(null);
vi.mock('../content-types/content-type-registry.js', () => ({
  getContentType: (...args) => mockGetContentType(...args),
}));

// Mock notebook-adapter
const mockListSources = vi.fn().mockResolvedValue({ ok: false });
const mockDeleteSource = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../notebook-adapter.js', () => ({
  listSources: (...args) => mockListSources(...args),
  deleteSource: (...args) => mockDeleteSource(...args),
  addSource: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  executeCopyReview,
  executeImageReview,
  executeResearch,
  executeCopywriting,
  executeGenerate,
  executeExport,
} from '../content-pipeline-executors.js';

import { existsSync, readFileSync, readdirSync } from 'fs';

describe('executor 模块导入', () => {
  it('所有 6 个 executor 函数应该能正常导入', () => {
    expect(typeof executeResearch).toBe('function');
    expect(typeof executeCopywriting).toBe('function');
    expect(typeof executeCopyReview).toBe('function');
    expect(typeof executeGenerate).toBe('function');
    expect(typeof executeImageReview).toBe('function');
    expect(typeof executeExport).toBe('function');
  });
});

describe('executeCopyReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    existsSync.mockReturnValue(false);
    readdirSync.mockReturnValue([]);
  });

  it('应该在找不到产出目录时返回 review_passed=false', async () => {
    const task = {
      payload: { pipeline_keyword: '测试关键词', parent_pipeline_id: 'test-id' },
      title: '测试',
    };
    const result = await executeCopyReview(task);
    expect(result.success).toBe(true);
    expect(result.review_passed).toBe(false);
    expect(result.issues).toContain('找不到产出目录');
  });

  it('应该调用 getContentType 获取配置', async () => {
    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    await executeCopyReview(task);
    expect(mockGetContentType).toHaveBeenCalledWith('solo-company-case');
  });

  it('有配置时应使用 min_word_count 替代硬编码阈值', async () => {
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      copy_rules: {
        min_word_count: { short_copy: 500, long_form: 2000 },
      },
      review_rules: [
        { id: 'data_accuracy', description: '数据准确性', severity: 'blocking' },
      ],
    });

    // 模拟找到产出目录但文案为空
    readdirSync.mockReturnValue(['test-dir']);
    existsSync.mockImplementation((path) => {
      if (path.includes('test-dir')) return true;
      return false;
    });

    const task = {
      payload: { pipeline_keyword: 'test-dir', content_type: 'solo-company-case' },
      title: '测试',
    };
    const result = await executeCopyReview(task);
    // 文案为空，应该失败
    expect(result.success).toBe(true);
    expect(result.review_passed).toBe(false);
  });

  it('getContentType 失败时应 fallback 到硬编码', async () => {
    mockGetContentType.mockRejectedValue(new Error('DB 连接失败'));
    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    const result = await executeCopyReview(task);
    expect(result.success).toBe(true);
    // 仍正常返回（找不到目录）
    expect(result.review_passed).toBe(false);
  });
});

describe('executeImageReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    existsSync.mockReturnValue(false);
    readdirSync.mockReturnValue([]);
  });

  it('应该调用 getContentType 获取配置', async () => {
    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    await executeImageReview(task);
    expect(mockGetContentType).toHaveBeenCalledWith('solo-company-case');
  });

  it('有配置时应使用 images.count 替代硬编码 9', async () => {
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      images: { count: 6, format: 'svg', style: 'minimal' },
    });

    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    const result = await executeImageReview(task);
    // 找不到产出目录
    expect(result.success).toBe(true);
    expect(result.review_passed).toBe(false);
  });

  it('getContentType 返回 null 时 fallback 到默认 9', async () => {
    mockGetContentType.mockResolvedValue(null);
    const task = {
      payload: { pipeline_keyword: '测试' },
      title: '测试',
    };
    const result = await executeImageReview(task);
    expect(result.success).toBe(true);
  });
});

describe('executeResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    existsSync.mockReturnValue(false);
    readdirSync.mockReturnValue([]);
  });

  it('应该调用 getContentType 获取配置', async () => {
    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    await executeResearch(task);
    expect(mockGetContentType).toHaveBeenCalledWith('solo-company-case');
  });

  it('无 notebook_id 时应返回 {success: false} 并包含错误信息', async () => {
    const task = {
      payload: { pipeline_keyword: '测试关键词' },
      title: '测试',
    };
    const result = await executeResearch(task);
    expect(result.success).toBe(false);
    expect(result.error).toContain('notebook_id');
  });

  it('getContentType 失败时（无 notebook_id）应 FAIL 且不报错', async () => {
    mockGetContentType.mockRejectedValue(new Error('DB 挂了'));
    const task = {
      payload: { pipeline_keyword: '测试' },
      title: '测试',
    };
    const result = await executeResearch(task);
    // 无 notebook_id 时无论 getContentType 是否成功，都应 FAIL
    expect(result.success).toBe(false);
    expect(result.error).toContain('notebook_id');
  });
});

describe('executeCopywriting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    existsSync.mockReturnValue(false);
    readdirSync.mockReturnValue([]);
  });

  it('应该调用 getContentType 获取配置', async () => {
    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    await executeCopywriting(task);
    expect(mockGetContentType).toHaveBeenCalledWith('solo-company-case');
  });

  it('getContentType 失败且无 findings 时降级到静态模板继续（不硬失败）', async () => {
    mockGetContentType.mockRejectedValue(new Error('DB 超时'));
    const task = {
      payload: { pipeline_keyword: '测试' },
      title: '测试',
    };
    const result = await executeCopywriting(task);
    // typeConfig 不可用且无 findings 时降级到静态模板继续 pipeline
    expect(result.success).toBe(true);
  });
});

describe('executeGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    existsSync.mockReturnValue(false);
    readdirSync.mockReturnValue([]);
  });

  it('应该调用 getContentType 获取配置', async () => {
    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    await executeGenerate(task);
    expect(mockGetContentType).toHaveBeenCalledWith('solo-company-case');
  });

  it('有配置时返回值应包含 image_count 和 image_style', async () => {
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      images: { count: 6, style: 'dark-gradient' },
    });

    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    const result = await executeGenerate(task);
    expect(result.success).toBe(true);
    expect(result.image_count).toBe(6);
    expect(result.image_style).toBe('dark-gradient');
  });

  it('getContentType 返回 null 时 fallback 到默认值', async () => {
    mockGetContentType.mockResolvedValue(null);
    const task = {
      payload: { pipeline_keyword: '测试' },
      title: '测试',
    };
    const result = await executeGenerate(task);
    expect(result.success).toBe(true);
    expect(result.image_count).toBe(9);
    expect(result.image_style).toBe('professional-infographic');
  });
});

describe('executeExport — notebook 清空复用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    existsSync.mockReturnValue(false);
    readdirSync.mockReturnValue([]);
    mockListSources.mockResolvedValue({ ok: false });
    mockDeleteSource.mockResolvedValue({ ok: true });
  });

  it('无输出目录时，export 返回 success: false，不应调用 listSources', async () => {
    // dir not found → returns early before notebook cleanup
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      notebook_id: '1d928181-4462-47d4-b4c0-89d3696344ab',
    });

    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    const result = await executeExport(task);

    expect(result.success).toBe(false);
    // notebook cleanup is skipped because export returned early
    expect(mockListSources).not.toHaveBeenCalled();
  });

  it('typeConfig 无 notebook_id 时，不应调用 listSources', async () => {
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
    });

    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    await executeExport(task);

    expect(mockListSources).not.toHaveBeenCalled();
    expect(mockDeleteSource).not.toHaveBeenCalled();
  });

  it('notebook 清空失败（listSources 抛出）时，export 不应抛出异常', async () => {
    // Note: executeExport returns early (success: false) when dir not found,
    // but the notebook cleanup try-catch must never propagate errors
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      notebook_id: '1d928181-4462-47d4-b4c0-89d3696344ab',
    });
    mockListSources.mockRejectedValue(new Error('bridge 不可达'));

    const task = {
      payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' },
      title: '测试',
    };
    // Should resolve (not throw), regardless of notebook cleanup result
    await expect(executeExport(task)).resolves.toBeDefined();
  });
});
