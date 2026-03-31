/**
 * content-pipeline-llm.test.js
 *
 * 验证四个 executor 阶段的 Claude callLLM 调用逻辑：
 * - executeCopywriting: 调用 callLLM 生成文案，支持 previous_feedback 注入
 * - executeCopyReview: 调用 callLLM 返回 rule_scores 逐条评分
 * - executeGenerate: 调用 callLLM 生成卡片内容描述
 * - executeImageReview: 调用 callLLM 审核内容质量
 * - LLM 失败时降级到本地逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

// Mock content type registry
const mockGetContentType = vi.fn().mockResolvedValue(null);
vi.mock('../packages/brain/src/content-types/content-type-registry.js', () => ({
  getContentType: (...args) => mockGetContentType(...args),
}));

// Mock callLLM
const mockCallLLM = vi.fn();
vi.mock('../packages/brain/src/llm-caller.js', () => ({
  callLLM: (...args) => mockCallLLM(...args),
}));

import {
  executeCopywriting,
  executeCopyReview,
  executeGenerate,
  executeImageReview,
} from '../packages/brain/src/content-pipeline-executors.js';

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';

// 完整 typeConfig（含 generate_prompt / review_prompt）
const FULL_TYPE_CONFIG = {
  content_type: 'solo-company-case',
  images: { count: 9, style: 'professional-infographic' },
  template: {
    generate_prompt: '为 {keyword} 生成内容',
    review_prompt: '审查以下内容是否符合标准',
    image_review_prompt: '审核图片内容质量',
  },
  review_rules: [
    { id: 'data_accuracy', description: '数据准确', severity: 'blocking' },
    { id: 'story_arc', description: '故事弧清晰', severity: 'warning' },
  ],
  copy_rules: { min_word_count: { short_copy: 300, long_form: 1000 } },
};

describe('executeCopywriting — Claude 调用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    mockCallLLM.mockReset();
  });

  it('有 generate_prompt 时应调用 callLLM', async () => {
    mockGetContentType.mockResolvedValue(FULL_TYPE_CONFIG);
    mockCallLLM.mockResolvedValue({ text: '=== 社交媒体文案 ===\n文案内容\n=== 公众号长文 ===\n长文内容' });

    const task = { payload: { pipeline_keyword: '独立创作者', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeCopywriting(task);

    expect(mockCallLLM).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.llm_generated).toBe(true);
  });

  it('previous_feedback 应注入到 callLLM prompt', async () => {
    mockGetContentType.mockResolvedValue(FULL_TYPE_CONFIG);
    mockCallLLM.mockResolvedValue({ text: '=== 社交媒体文案 ===\n内容\n=== 公众号长文 ===\n长文' });

    const task = {
      payload: {
        pipeline_keyword: '测试关键词',
        content_type: 'solo-company-case',
        previous_feedback: '上次缺少具体数据，请补充',
      },
      title: '测试',
    };
    await executeCopywriting(task);

    const [, promptArg] = mockCallLLM.mock.calls[0];
    expect(promptArg).toContain('上次缺少具体数据，请补充');
    expect(promptArg).toContain('上次审查意见');
  });

  it('无 generate_prompt 时不调用 callLLM，降级到静态模板', async () => {
    mockGetContentType.mockResolvedValue({ ...FULL_TYPE_CONFIG, template: {} });

    const task = { payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeCopywriting(task);

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.llm_generated).toBe(false);
  });

  it('callLLM 失败时降级到静态模板，不中断 pipeline', async () => {
    mockGetContentType.mockResolvedValue(FULL_TYPE_CONFIG);
    mockCallLLM.mockRejectedValue(new Error('LLM timeout'));

    const task = { payload: { pipeline_keyword: '测试', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeCopywriting(task);

    expect(result.success).toBe(true);
    expect(result.llm_generated).toBe(false);
  });

  it('无 findings 时仍然成功（降级路径）', async () => {
    mockGetContentType.mockResolvedValue(null);
    readdirSync.mockReturnValue([]);

    const task = { payload: { pipeline_keyword: '无素材关键词' }, title: '测试' };
    const result = await executeCopywriting(task);

    expect(result.success).toBe(true);
  });
});

describe('executeCopyReview — Claude 调用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    mockCallLLM.mockReset();
  });

  it('有 review_prompt 时应调用 callLLM 返回 rule_scores', async () => {
    mockGetContentType.mockResolvedValue(FULL_TYPE_CONFIG);
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify({
        rule_scores: [
          { id: 'data_accuracy', score: 8, pass: true, comment: '数据充分' },
          { id: 'story_arc', score: 6, pass: true, comment: '故事弧尚可' },
        ],
        overall_pass: true,
        summary: '内容质量良好',
      }),
    });

    // 模拟找到产出目录
    readdirSync.mockReturnValue(['2026-03-31-测试']);
    existsSync.mockImplementation((p) => p.includes('2026-03-31') || p.includes('copy.md') || p.includes('article.md'));
    readFileSync.mockReturnValue('这是一段包含能力和数字123的测试文案内容，长度超过三百字...' + 'x'.repeat(500));

    const task = { payload: { pipeline_keyword: '2026-03-31-测试', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeCopyReview(task);

    expect(mockCallLLM).toHaveBeenCalledOnce();
    expect(result.rule_scores).toBeDefined();
    expect(result.llm_reviewed).toBe(true);
    expect(result.review_passed).toBe(true);
  });

  it('callLLM 失败时降级到静态规则检查', async () => {
    mockGetContentType.mockResolvedValue(FULL_TYPE_CONFIG);
    mockCallLLM.mockRejectedValue(new Error('LLM error'));

    readdirSync.mockReturnValue(['test-dir']);
    existsSync.mockImplementation((p) => p.includes('test-dir') || p.includes('copy.md'));
    readFileSync.mockReturnValue('含有能力和AI和系统关键词和数字123的测试文案' + 'x'.repeat(400));

    const task = { payload: { pipeline_keyword: 'test-dir', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeCopyReview(task);

    expect(result.success).toBe(true);
    expect(result.llm_reviewed).toBe(false);
    expect(result.rule_scores).toBeNull();
  });

  it('找不到产出目录时返回 review_passed=false', async () => {
    readdirSync.mockReturnValue([]);
    existsSync.mockReturnValue(false);

    const task = { payload: { pipeline_keyword: '不存在的关键词' }, title: '测试' };
    const result = await executeCopyReview(task);

    expect(result.success).toBe(true);
    expect(result.review_passed).toBe(false);
    expect(result.issues).toContain('找不到产出目录');
  });
});

describe('executeGenerate — Claude 调用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    mockCallLLM.mockReset();
  });

  it('有 generate_prompt 时应调用 callLLM 生成卡片内容', async () => {
    mockGetContentType.mockResolvedValue(FULL_TYPE_CONFIG);
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify({ cards: [{ index: 1, title: '封面', content: '内容', highlight: '数据' }] }),
    });

    readdirSync.mockReturnValue(['2026-03-31-test']);
    existsSync.mockReturnValue(true);

    const task = { payload: { pipeline_keyword: '2026-03-31-test', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeGenerate(task);

    expect(mockCallLLM).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.image_count).toBe(9);
    expect(result.image_style).toBe('professional-infographic');
    expect(result.llm_content).toBe(true);
  });

  it('callLLM 失败时降级，返回 llm_content=false 但不报错', async () => {
    mockGetContentType.mockResolvedValue(FULL_TYPE_CONFIG);
    mockCallLLM.mockRejectedValue(new Error('LLM timeout'));

    readdirSync.mockReturnValue(['test-dir']);
    existsSync.mockReturnValue(true);

    const task = { payload: { pipeline_keyword: 'test-dir', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeGenerate(task);

    expect(result.success).toBe(true);
    expect(result.image_count).toBe(9);
    expect(result.image_style).toBe('professional-infographic');
    expect(result.llm_content).toBe(false);
  });
});

describe('executeImageReview — Claude 调用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue(null);
    mockCallLLM.mockReset();
  });

  it('有 image_review_prompt 且文案存在时应调用 callLLM', async () => {
    mockGetContentType.mockResolvedValue(FULL_TYPE_CONFIG);
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify({ review_passed: true, issues: [], suggestions: ['建议增加数据'], quality_score: 8 }),
    });

    readdirSync.mockReturnValue(['test-dir']);
    existsSync.mockImplementation((p) => p.includes('test-dir') || p.includes('copy.md') || p.includes('article.md'));
    readFileSync.mockReturnValue('{"cards":[{"index":1,"title":"测试卡片"}]}');

    const task = { payload: { pipeline_keyword: 'test-dir', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeImageReview(task);

    expect(mockCallLLM).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.llm_review).toBeDefined();
    expect(result.llm_review.quality_score).toBe(8);
  });

  it('callLLM 失败时降级到文件检查', async () => {
    mockGetContentType.mockResolvedValue(FULL_TYPE_CONFIG);
    mockCallLLM.mockRejectedValue(new Error('LLM error'));

    readdirSync.mockReturnValue(['test-dir']);
    existsSync.mockImplementation((p) => p.includes('test-dir') || p.includes('copy.md') || p.includes('article.md'));
    readFileSync.mockReturnValue('{}');

    const task = { payload: { pipeline_keyword: 'test-dir', content_type: 'solo-company-case' }, title: '测试' };
    const result = await executeImageReview(task);

    expect(result.success).toBe(true);
    expect(result.llm_review).toBeNull();
  });
});
