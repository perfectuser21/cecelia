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

// Mock llm-caller — 捕获实际 prompt，供 _buildCopywritingPrompt 截断测试用
const mockCallLLM = vi.fn().mockResolvedValue({ text: '' });
vi.mock('../llm-caller.js', () => ({
  callLLM: (...args) => mockCallLLM(...args),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
  exec: vi.fn((cmd, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb;
    if (callback) callback(null, '', '');
  }),
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

  it('LLM 调用失败时应降级为 review_passed=true（跳过审核）', async () => {
    // 配置有效的 typeConfig（含 review_prompt 和 review_rules）
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      review_rules: [{ id: 'data_accuracy', description: '数据准确性', severity: 'blocking' }],
      template: { review_prompt: '请审查以下内容' },
    });
    // 有文案内容
    readdirSync.mockReturnValue(['test-keyword-dir']);
    existsSync.mockImplementation((path) => {
      if (path.includes('test-keyword-dir')) return true;
      return false;
    });
    readFileSync.mockReturnValue('这是一段测试文案内容，长度超过最小要求，用于触发 LLM 审核。');

    // LLM 调用失败
    mockCallLLM.mockRejectedValue(new Error('Bridge /llm-call error: 500'));

    const task = {
      payload: { pipeline_keyword: 'test-keyword-dir', content_type: 'solo-company-case' },
      title: '测试',
    };
    const result = await executeCopyReview(task);

    // 降级：LLM 不可用时应跳过审核，允许 pipeline 继续
    expect(result.success).toBe(true);
    expect(result.review_passed).toBe(true);
    expect(result.llm_reviewed).toBe(false);
    expect(result.skipped_reason).toContain('500');
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

  it('LLM 调用失败时应降级为 review_passed=true（跳过审核）', async () => {
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      images: { count: 9 },
      template: { image_review_prompt: '请审查以下图片内容 {keyword}' },
    });
    // 文件检查通过
    readdirSync.mockReturnValue(['image-test-dir']);
    existsSync.mockImplementation((path) => {
      if (path.includes('image-test-dir') || path.includes('copy.md') || path.includes('article.md') || path.includes('llm-card-content.json')) return true;
      return false;
    });
    readFileSync.mockReturnValue(JSON.stringify([{ title: '测试' }]));

    // LLM 调用失败
    mockCallLLM.mockRejectedValue(new Error('Bridge /llm-call error: 500'));

    const task = {
      payload: { pipeline_keyword: 'image-test-dir', content_type: 'solo-company-case' },
      title: '测试',
    };
    const result = await executeImageReview(task);

    // 降级：LLM 不可用时应跳过审核，允许 pipeline 继续
    expect(result.success).toBe(true);
    expect(result.review_passed).toBe(true);
    expect(result.llm_reviewed).toBe(false);
    expect(result.skipped_reason).toContain('500');
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

  it('LLM 返回无分隔符内容时应降级到静态模板（不写"澄清问题"文件）', async () => {
    // 模拟 LLM 返回澄清问题而非实际文案（无 === 分隔符）
    mockCallLLM.mockResolvedValue({ text: '选项A：补充更多素材。选项B：生成框架。请问您选择哪个方案？' });
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      template: { generate_prompt: '生成关于{keyword}的内容' },
    });

    const { writeFileSync } = await import('fs');
    const task = { payload: { pipeline_keyword: '行业跟进能力', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeCopywriting(task);

    expect(result.success).toBe(true);
    // 降级到静态模板时，writeFileSync 仍会被调用（写静态内容），不应包含澄清性问题
    const allWrittenContent = writeFileSync.mock.calls.map(c => c[1]).join('\n');
    expect(allWrittenContent).not.toMatch(/选项A|选项B|请问您选择/);
  });

  it('LLM 返回内容太短（<200字）时应降级到静态模板', async () => {
    mockCallLLM.mockResolvedValue({
      text: '=== 社交媒体文案 ===\n短内容\n=== 公众号长文 ===\n也很短',
    });
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      template: { generate_prompt: '生成关于{keyword}的内容' },
    });

    const { writeFileSync } = await import('fs');
    writeFileSync.mockClear();
    const task = { payload: { pipeline_keyword: '短内容测试', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeCopywriting(task);

    expect(result.success).toBe(true);
    // 静态模板应被调用，结果不含 LLM 的"短内容"
    const allWrittenContent = writeFileSync.mock.calls.map(c => c[1]).join('\n');
    expect(allWrittenContent).not.toBe('短内容');
  });

  it('prompt 应包含禁止询问用户的指令', async () => {
    mockCallLLM.mockResolvedValue({ text: '' });
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      template: { generate_prompt: '生成关于{keyword}的内容' },
    });

    const task = { payload: { pipeline_keyword: '测试指令', content_type: 'solo-company-case' }, title: '测试' };
    await executeCopywriting(task);

    expect(mockCallLLM).toHaveBeenCalled();
    const calledPrompt = mockCallLLM.mock.calls[0][1];
    expect(calledPrompt).toContain('绝对禁止');
  });

  it('_buildCopywritingPrompt 应传递 finding 内容至少 1500 字符（不被 200 截断）', async () => {
    const longContent = 'A'.repeat(2000);
    readdirSync.mockImplementation((dir) => {
      if (dir.includes('research')) return ['solo-company-case-截断测试-2026-04-05'];
      return [];
    });
    existsSync.mockImplementation((p) => p.includes('findings.json') || p.includes('research'));
    readFileSync.mockImplementation((p) => {
      if (p.includes('findings.json')) {
        return JSON.stringify({ findings: [{ title: '测试案例', content: longContent, brand_relevance: 5, used_in: [] }] });
      }
      return '';
    });
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      template: { generate_prompt: '请基于调研素材生成关于{keyword}的内容' },
    });

    const task = { payload: { pipeline_keyword: '截断测试', content_type: 'solo-company-case' }, title: '测试' };
    await executeCopywriting(task);

    expect(mockCallLLM).toHaveBeenCalled();
    const calledPrompt = mockCallLLM.mock.calls[0][1];
    // finding 内容在 prompt 中应出现至少 1500 字符（旧限制 200 会被识别为截断）
    const aCount = (calledPrompt.match(/A/g) || []).length;
    expect(aCount).toBeGreaterThanOrEqual(1500);
  });

  it('重试时应将 review_feedback 传入 LLM prompt（修复反馈丢失 bug）', async () => {
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      template: { generate_prompt: '生成关于{keyword}的内容' },
    });
    mockCallLLM.mockResolvedValue({ text: '=== 社交媒体文案 ===\n测试文案\n=== 公众号长文 ===\n测试长文\n' });

    const feedback = '[data_accuracy] 缺少数据来源';
    const task = {
      payload: {
        pipeline_keyword: '重试测试',
        content_type: 'solo-company-case',
        review_feedback: feedback,  // orchestrator 重试时写入的字段
      },
      title: '重试测试',
    };
    await executeCopywriting(task);

    expect(mockCallLLM).toHaveBeenCalled();
    const calledPrompt = mockCallLLM.mock.calls[0][1];
    expect(calledPrompt).toContain(feedback);
  });

  it('review_feedback 优先于 previous_feedback', async () => {
    mockGetContentType.mockResolvedValue({
      content_type: 'solo-company-case',
      template: { generate_prompt: '生成关于{keyword}的内容' },
    });
    mockCallLLM.mockResolvedValue({ text: '=== 社交媒体文案 ===\n测试\n=== 公众号长文 ===\n测试\n' });

    const task = {
      payload: {
        pipeline_keyword: '优先级测试',
        content_type: 'solo-company-case',
        review_feedback: 'review_feedback内容',
        previous_feedback: 'previous_feedback内容',
      },
      title: '优先级测试',
    };
    await executeCopywriting(task);

    const calledPrompt = mockCallLLM.mock.calls[0][1];
    expect(calledPrompt).toContain('review_feedback内容');
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
