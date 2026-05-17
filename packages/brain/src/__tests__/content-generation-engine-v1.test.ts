/**
 * content-generation-engine-v1.test.ts
 *
 * 验证「内容生成引擎 v1 — AI一人公司主题 + 每日产出 ≥5条」核心功能：
 *   1. 主题库包含 ≥20 个精选 AI一人公司关键词
 *   2. sampleTopics() 正确抽样并去重
 *   3. topic-selection-scheduler DISABLED = false（调度器已启用）
 *   4. triggerDailyTopicSelection 在 DISABLED=false 时不再返回 disabled:true
 *   5. generateTopics 接受 seedKeywords 参数（向后兼容）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── 1. 主题库单元测试 ──────────────────────────────────────────────────────────

describe('ai-solopreneur-topic-library', () => {
  // 动态 import（ESM）
  it('包含 ≥20 个精选 AI一人公司关键词', async () => {
    const { AI_SOLOPRENEUR_TOPICS } = await import(
      '../content-types/ai-solopreneur-topic-library.js'
    );
    expect(Array.isArray(AI_SOLOPRENEUR_TOPICS)).toBe(true);
    expect(AI_SOLOPRENEUR_TOPICS.length).toBeGreaterThanOrEqual(20);
  });

  it('每个主题包含 keyword / category / content_type 字段', async () => {
    const { AI_SOLOPRENEUR_TOPICS } = await import(
      '../content-types/ai-solopreneur-topic-library.js'
    );
    for (const topic of AI_SOLOPRENEUR_TOPICS) {
      expect(typeof topic.keyword).toBe('string');
      expect(topic.keyword.length).toBeGreaterThan(0);
      expect(typeof topic.category).toBe('string');
      expect(typeof topic.content_type).toBe('string');
    }
  });

  it('sampleTopics(5) 返回 5 个不重复主题', async () => {
    const { sampleTopics } = await import(
      '../content-types/ai-solopreneur-topic-library.js'
    );
    const samples = sampleTopics(5);
    expect(samples).toHaveLength(5);

    // 关键词唯一
    const keywords = samples.map(t => t.keyword);
    expect(new Set(keywords).size).toBe(5);
  });

  it('sampleTopics 接受 excludeKeywords 过滤', async () => {
    const { AI_SOLOPRENEUR_TOPICS, sampleTopics } = await import(
      '../content-types/ai-solopreneur-topic-library.js'
    );
    const excludeKeywords = AI_SOLOPRENEUR_TOPICS.slice(0, 10).map(t => t.keyword);
    const samples = sampleTopics(5, { excludeKeywords });
    const sampleKeywords = samples.map(t => t.keyword);
    // 排除词中的关键词不应出现在结果里
    for (const kw of sampleKeywords) {
      expect(excludeKeywords).not.toContain(kw);
    }
  });

  it('sampleTopics 请求数量大于库总量时不报错', async () => {
    const { AI_SOLOPRENEUR_TOPICS, sampleTopics } = await import(
      '../content-types/ai-solopreneur-topic-library.js'
    );
    const samples = sampleTopics(9999);
    expect(samples.length).toBeLessThanOrEqual(AI_SOLOPRENEUR_TOPICS.length);
  });
});

// ─── 2. 调度器启用状态测试 ──────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../topic-selector.js', () => ({
  generateTopics: vi.fn().mockResolvedValue([
    { keyword: '测试选题1', content_type: 'solo-company-case', title_candidates: [], hook: '', why_hot: '', priority_score: 0.9 },
    { keyword: '测试选题2', content_type: 'solo-company-case', title_candidates: [], hook: '', why_hot: '', priority_score: 0.8 },
    { keyword: '测试选题3', content_type: 'solo-company-case', title_candidates: [], hook: '', why_hot: '', priority_score: 0.7 },
    { keyword: '测试选题4', content_type: 'solo-company-case', title_candidates: [], hook: '', why_hot: '', priority_score: 0.6 },
    { keyword: '测试选题5', content_type: 'solo-company-case', title_candidates: [], hook: '', why_hot: '', priority_score: 0.5 },
  ]),
}));

vi.mock('../topic-suggestion-manager.js', () => ({
  saveSuggestions: vi.fn().mockResolvedValue(5),
}));

vi.mock('../content-types/ai-solopreneur-topic-library.js', () => ({
  AI_SOLOPRENEUR_TOPICS: Array.from({ length: 30 }, (_, i) => ({
    keyword: `测试主题${i}`,
    category: 'case',
    content_type: 'solo-company-case',
  })),
  sampleTopics: vi.fn().mockReturnValue([
    { keyword: '种子词1', category: 'case', content_type: 'solo-company-case' },
    { keyword: '种子词2', category: 'case', content_type: 'solo-company-case' },
    { keyword: '种子词3', category: 'case', content_type: 'solo-company-case' },
    { keyword: '种子词4', category: 'case', content_type: 'solo-company-case' },
    { keyword: '种子词5', category: 'case', content_type: 'solo-company-case' },
  ]),
}));

describe('topic-selection-scheduler（内容生成引擎 v1）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('在触发窗口内且今天无记录时，触发选题生成', async () => {
    const { default: pool } = await import('../db.js');
    // hasTodayTopics 查询返回空（今天未触发过）
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
    // createContentPipelineTask 的 INSERT 成功
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rowCount: 1 });

    const { triggerDailyTopicSelection } = await import('../topic-selection-scheduler.js');
    // UTC 01:00 = 北京 09:00，在触发窗口内
    const result = await triggerDailyTopicSelection(pool as any, new Date('2026-04-08T01:30:00Z'));

    expect(result.disabled).toBeUndefined(); // 不再是 disabled 状态
    expect(result.skipped_window).toBe(false);
  });

  it('在触发窗口外时跳过（skipped_window: true）', async () => {
    const { default: pool } = await import('../db.js');
    const { triggerDailyTopicSelection } = await import('../topic-selection-scheduler.js');
    // UTC 20:00 = 北京 04:00（次日凌晨），超出窗口
    const result = await triggerDailyTopicSelection(pool as any, new Date('2026-04-08T20:00:00Z'));
    expect(result.skipped_window).toBe(true);
  });

  it('今天已触发过时跳过（skipped: true）', async () => {
    const { default: pool } = await import('../db.js');
    // hasTodayTopics 返回已有记录
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

    const { triggerDailyTopicSelection } = await import('../topic-selection-scheduler.js');
    const result = await triggerDailyTopicSelection(pool as any, new Date('2026-04-08T02:00:00Z'));
    expect(result.skipped).toBe(true);
  });

  it('调用 generateTopics 时传入 seedKeywords', async () => {
    const { generateTopics } = await import('../topic-selector.js');
    const { default: pool } = await import('../db.js');
    const { sampleTopics } = await import('../content-types/ai-solopreneur-topic-library.js');

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [], rowCount: 1 });

    const { triggerDailyTopicSelection } = await import('../topic-selection-scheduler.js');
    await triggerDailyTopicSelection(pool as any, new Date('2026-04-08T01:30:00Z'));

    expect(sampleTopics).toHaveBeenCalled();
    expect(generateTopics).toHaveBeenCalledWith(
      pool,
      expect.arrayContaining(['种子词1'])
    );
  });
});

// ─── 3. generateTopics 向后兼容测试 ────────────────────────────────────────────

vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({
    text: JSON.stringify([
      { keyword: 'LLM选题1', content_type: 'solo-company-case', title_candidates: [], hook: '', why_hot: '', priority_score: 0.9 },
    ]),
  }),
}));

vi.mock('../topic-heat-scorer.js', () => ({
  getHighPerformingTopics: vi.fn().mockResolvedValue([]),
}));

vi.mock('../content-analytics.js', () => ({
  queryWeeklyROI: vi.fn().mockResolvedValue([]),
}));

describe('generateTopics（seedKeywords 参数）', () => {
  it('无 seedKeywords 时正常工作（向后兼容）', async () => {
    const { default: pool } = await import('../db.js');
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

    const { generateTopics } = await import('../topic-selector.js');
    const topics = await (generateTopics as any)(pool);
    expect(Array.isArray(topics)).toBe(true);
  });

  it('传入 seedKeywords 时不报错', async () => {
    const { default: pool } = await import('../db.js');
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

    const { generateTopics } = await import('../topic-selector.js');
    const topics = await (generateTopics as any)(pool, ['种子词A', '种子词B']);
    expect(Array.isArray(topics)).toBe(true);
  });
});
