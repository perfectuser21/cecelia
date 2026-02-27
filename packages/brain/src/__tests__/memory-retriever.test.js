/**
 * Tests for Memory Retriever - 统一记忆检索器
 *
 * 覆盖：
 * D1: buildMemoryContext 返回格式化 block
 * D2: Token 预算截断
 * D3: 时间衰减
 * D4: 简单去重
 * D5: Mode weight
 * D6: 数据源适配器
 * D7: Graceful fallback
 * D8: similarity.js created_at
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  timeDecay,
  simpleDedup,
  jaccardSimilarity,
  estimateTokens,
  buildMemoryContext,
  generateL0Summary,
  searchEpisodicMemory,
  HALF_LIFE,
  MODE_WEIGHT,
  _loadActiveProfile,
  _loadRecentEvents,
  _formatItem,
} from '../memory-retriever.js';

// Mock db.js
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: {
    query: (...args) => mockQuery(...args),
  }
}));

// Mock similarity.js
const mockSearchWithVectors = vi.fn();
vi.mock('../similarity.js', () => {
  return {
    default: class MockSimilarityService {
      constructor() {}
      searchWithVectors(...args) { return mockSearchWithVectors(...args); }
    }
  };
});

// Mock learning.js
const mockSearchRelevantLearnings = vi.fn();
vi.mock('../learning.js', () => ({
  searchRelevantLearnings: (...args) => mockSearchRelevantLearnings(...args),
  getRecentLearnings: vi.fn().mockResolvedValue([]),
}));

// Mock user-profile.js（避免干扰 loadActiveProfile 的 goals 查询）
const mockLoadUserProfile = vi.fn();
const mockFormatProfileSnippet = vi.fn();
vi.mock('../user-profile.js', () => ({
  loadUserProfile: (...args) => mockLoadUserProfile(...args),
  formatProfileSnippet: (...args) => mockFormatProfileSnippet(...args),
}));

// Mock memory-router.js（已有测试不感知路由逻辑）
vi.mock('../memory-router.js', () => ({
  routeMemory: vi.fn().mockReturnValue({
    intentType: 'general',
    strategy: { semantic: true, episodic: true, events: true, episodicBudget: 250, semanticBudget: 400, eventsBudget: 150 },
  }),
  INTENT_TYPES: { SELF_REFLECTION: 'self_reflection', TASK_QUERY: 'task_query', STATUS_CHECK: 'status_check', GENERAL: 'general' },
  MEMORY_STRATEGY: {},
}));


beforeEach(() => {
  vi.clearAllMocks();
  mockSearchWithVectors.mockResolvedValue({ matches: [] });
  mockSearchRelevantLearnings.mockResolvedValue([]);
  mockQuery.mockResolvedValue({ rows: [] });
  // 默认：用户画像为空（不影响已有测试）
  mockLoadUserProfile.mockResolvedValue(null);
  mockFormatProfileSnippet.mockReturnValue('');
});

// ============================================================
// D1: timeDecay 函数
// ============================================================

describe('timeDecay', () => {
  it('当天创建的记忆衰减因子接近 1', () => {
    const now = new Date().toISOString();
    const decay = timeDecay(now, 30);
    expect(decay).toBeGreaterThan(0.95);
  });

  it('30天前的记忆衰减到约 50%（半衰期=30天）', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const decay = timeDecay(thirtyDaysAgo, 30);
    expect(decay).toBeCloseTo(0.5, 1);
  });

  it('90天前的记忆衰减到约 12.5%（半衰期=30天）', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const decay = timeDecay(ninetyDaysAgo, 30);
    expect(decay).toBeCloseTo(0.125, 1);
  });

  it('learnings 半衰期 90 天：90天前约 50%', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const decay = timeDecay(ninetyDaysAgo, 90);
    expect(decay).toBeCloseTo(0.5, 1);
  });

  it('halfLife=Infinity 时不衰减（返回 1）', () => {
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
    const decay = timeDecay(yearAgo, Infinity);
    expect(decay).toBe(1);
  });

  it('createdAt 为 null 时返回 1', () => {
    expect(timeDecay(null, 30)).toBe(1);
  });

  it('halfLife 为 0 时返回 1（安全处理）', () => {
    expect(timeDecay(new Date().toISOString(), 0)).toBe(1);
  });
});

// ============================================================
// D2: jaccardSimilarity
// ============================================================

describe('jaccardSimilarity', () => {
  it('完全相同的文本返回 1', () => {
    expect(jaccardSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('完全不同的文本返回 0', () => {
    expect(jaccardSimilarity('abc def', 'xyz uvw')).toBe(0);
  });

  it('部分重叠的文本返回 0 到 1 之间', () => {
    const sim = jaccardSimilarity('hello world foo', 'hello world bar');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('空文本返回 0', () => {
    expect(jaccardSimilarity('', 'hello')).toBe(0);
    expect(jaccardSimilarity(null, 'hello')).toBe(0);
  });
});

// ============================================================
// D3: simpleDedup
// ============================================================

describe('simpleDedup', () => {
  it('去除高度相似的候选', () => {
    const scored = [
      { text: 'fix login auth token expired bug', finalScore: 0.9 },
      { text: 'fix login auth token expired issue', finalScore: 0.8 },  // 与第一条高度相似
      { text: 'database connection pool optimization', finalScore: 0.7 },
    ];
    const result = simpleDedup(scored, 0.7);
    // 第二条应该被去掉（与第一条 Jaccard > 0.7）
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result[0].text).toBe('fix login auth token expired bug');
  });

  it('不同内容的候选全部保留', () => {
    const scored = [
      { text: 'aaa bbb ccc', finalScore: 0.9 },
      { text: 'xxx yyy zzz', finalScore: 0.8 },
      { text: 'ppp qqq rrr', finalScore: 0.7 },
    ];
    const result = simpleDedup(scored, 0.8);
    expect(result.length).toBe(3);
  });

  it('空列表返回空', () => {
    expect(simpleDedup([], 0.8)).toEqual([]);
  });
});

// ============================================================
// D4: estimateTokens
// ============================================================

describe('estimateTokens', () => {
  it('返回合理的 token 估算', () => {
    const text = '这是一段测试文本 this is test text';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(100);
  });

  it('空文本返回 0', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });
});

// ============================================================
// D5: _formatItem
// ============================================================

describe('formatItem', () => {
  it('格式化 task 类型', () => {
    const line = _formatItem({ source: 'task', title: '修复 bug', description: '紧急修复' });
    expect(line).toContain('[任务]');
    expect(line).toContain('修复 bug');
  });

  it('格式化 learning 类型', () => {
    const line = _formatItem({ source: 'learning', title: '经验教训', description: '不要硬编码' });
    expect(line).toContain('[经验]');
  });

  it('格式化 event 类型', () => {
    const line = _formatItem({ source: 'event', title: '[task_failed]', description: '超时' });
    expect(line).toContain('[事件]');
  });
});

// ============================================================
// D6: HALF_LIFE 和 MODE_WEIGHT 配置
// ============================================================

describe('常量配置', () => {
  it('HALF_LIFE 中 goals/capabilities 不衰减', () => {
    expect(HALF_LIFE.okr).toBe(Infinity);
    expect(HALF_LIFE.capability).toBe(Infinity);
  });

  it('HALF_LIFE 中 task=30, learning=90', () => {
    expect(HALF_LIFE.task).toBe(30);
    expect(HALF_LIFE.learning).toBe(90);
  });

  it('MODE_WEIGHT plan 模式 OKR 权重最高', () => {
    expect(MODE_WEIGHT.okr.plan).toBe(1.5);
    expect(MODE_WEIGHT.okr.plan).toBeGreaterThan(MODE_WEIGHT.task.plan);
  });

  it('MODE_WEIGHT debug 模式 event 和 learning 权重最高', () => {
    expect(MODE_WEIGHT.event.debug).toBe(1.5);
    expect(MODE_WEIGHT.learning.debug).toBe(1.5);
  });
});

// ============================================================
// D7: loadActiveProfile
// ============================================================

describe('loadActiveProfile', () => {
  it('chat 模式也应注入 OKR 焦点（不再跳过）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { title: 'Cecelia 管家系统', status: 'in_progress', progress: 50 },
      ]
    });
    const result = await _loadActiveProfile({ query: mockQuery }, 'chat');
    expect(result).toContain('OKR 焦点');
    expect(result).toContain('Cecelia 管家系统');
    expect(mockQuery).toHaveBeenCalled();
  });

  it('chat 模式 goals 为空时返回空字符串', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await _loadActiveProfile({ query: mockQuery }, 'chat');
    expect(result).toBe('');
  });

  it('有 goals 时返回 OKR 焦点', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { title: '完成 Task Intelligence', status: 'in_progress', progress: 60 },
        { title: 'Quality Monitor v2', status: 'pending', progress: 0 },
      ]
    });
    const result = await _loadActiveProfile({ query: mockQuery }, 'plan');
    expect(result).toContain('OKR 焦点');
    expect(result).toContain('Task Intelligence');
  });

  it('无 goals 时返回空', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await _loadActiveProfile({ query: mockQuery }, 'execute');
    expect(result).toBe('');
  });

  it('DB 查询失败时优雅降级', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));
    const result = await _loadActiveProfile({ query: mockQuery }, 'plan');
    expect(result).toBe('');
  });
});

// ============================================================
// D3: loadActiveProfile — 用户画像注入
// ============================================================

describe('loadActiveProfile — 用户画像注入', () => {
  it('D3-1: 有 profile 时 block 包含用户姓名', async () => {
    mockLoadUserProfile.mockResolvedValueOnce({
      display_name: '徐啸 / Alex Xu',
      focus_area: 'Cecelia',
      preferred_style: 'detailed',
    });
    mockFormatProfileSnippet.mockReturnValueOnce('## 主人信息\n你正在和 徐啸 / Alex Xu 对话。\n');
    mockQuery.mockResolvedValueOnce({ rows: [] }); // goals 为空

    const result = await _loadActiveProfile({ query: mockQuery }, 'chat');

    expect(result).toContain('徐啸 / Alex Xu');
    expect(mockLoadUserProfile).toHaveBeenCalledWith(expect.any(Object), 'owner');
  });

  it('D3-2: 无 profile 时 block 不含 "正在和" 片段', async () => {
    mockLoadUserProfile.mockResolvedValueOnce(null);
    mockFormatProfileSnippet.mockReturnValueOnce('');
    mockQuery.mockResolvedValueOnce({ rows: [] }); // goals 为空

    const result = await _loadActiveProfile({ query: mockQuery }, 'chat');

    expect(result).not.toContain('正在和');
  });

  it('D3-3: 有 profile 且有 OKR 时两者都注入', async () => {
    mockLoadUserProfile.mockResolvedValueOnce({ display_name: '徐啸', focus_area: 'Cecelia' });
    mockFormatProfileSnippet.mockReturnValueOnce('## 主人信息\n你正在和 徐啸 对话。\n');
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: 'Cecelia 管家系统', status: 'in_progress', progress: 50 }],
    });

    const result = await _loadActiveProfile({ query: mockQuery }, 'chat');

    expect(result).toContain('徐啸');
    expect(result).toContain('OKR 焦点');
  });
});

// ============================================================
// D8: loadRecentEvents
// ============================================================

describe('loadRecentEvents', () => {
  it('execute 模式查询 24h 内事件', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: '1', event_type: 'task_failed', source: 'executor', payload: { error: 'timeout' }, created_at: new Date() },
      ]
    });
    const result = await _loadRecentEvents({ query: mockQuery }, 'test query', 'execute');
    expect(result.length).toBe(1);
    expect(result[0].source).toBe('event');
    // 验证 SQL 中包含 24 hours
    const sqlCall = mockQuery.mock.calls[0][0];
    expect(sqlCall).toContain('24 hours');
  });

  it('debug 模式查询 72h 内事件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await _loadRecentEvents({ query: mockQuery }, 'test', 'debug');
    const sqlCall = mockQuery.mock.calls[0][0];
    expect(sqlCall).toContain('72 hours');
  });

  it('DB 失败时返回空数组', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));
    const result = await _loadRecentEvents({ query: mockQuery }, 'test', 'execute');
    expect(result).toEqual([]);
  });
});

// ============================================================
// D9: buildMemoryContext 集成
// ============================================================

describe('buildMemoryContext', () => {
  it('query 为空时返回空 block', async () => {
    const { block, meta } = await buildMemoryContext({ query: '', mode: 'execute', pool: { query: mockQuery } });
    expect(block).toBe('');
    expect(meta.injected).toBe(0);
  });

  it('pool 为空时返回空 block', async () => {
    const { block } = await buildMemoryContext({ query: 'test', mode: 'execute', pool: null });
    expect(block).toBe('');
  });

  it('有结果时返回格式化的 block', async () => {
    mockSearchWithVectors.mockResolvedValueOnce({
      matches: [
        { id: '1', level: 'task', title: '实现登录', description: 'JWT 认证', score: 0.8, created_at: new Date().toISOString(), status: 'completed' },
      ]
    });
    // events query
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // goals query
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { block, meta } = await buildMemoryContext({
      query: '用户认证',
      mode: 'execute',
      tokenBudget: 800,
      pool: { query: mockQuery },
    });

    expect(block).toContain('相关历史上下文');
    expect(block).toContain('实现登录');
    expect(meta.injected).toBeGreaterThan(0);
    expect(meta.tokenUsed).toBeLessThanOrEqual(800);
  });

  it('token 预算截断生效', async () => {
    // 创建大量候选
    const manyMatches = [];
    for (let i = 0; i < 50; i++) {
      manyMatches.push({
        id: `${i}`,
        level: 'task',
        title: `任务 ${i}: 这是一个很长的标题用来占据更多 token 空间 - 重复内容 ${i}`,
        description: `详细描述 ${i}: 包含大量信息的描述用来确保超出 token 预算`,
        score: 0.9 - i * 0.01,
        created_at: new Date().toISOString(),
        status: 'completed',
      });
    }
    mockSearchWithVectors.mockResolvedValueOnce({ matches: manyMatches });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // events
    mockQuery.mockResolvedValueOnce({ rows: [] }); // goals

    const { meta } = await buildMemoryContext({
      query: 'test',
      mode: 'execute',
      tokenBudget: 200,
      pool: { query: mockQuery },
    });

    expect(meta.tokenUsed).toBeLessThanOrEqual(200);
    expect(meta.injected).toBeLessThan(50);
  });

  it('mode=plan 时 profile 包含 OKR', async () => {
    mockSearchWithVectors.mockResolvedValueOnce({ matches: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // events
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: '目标A', status: 'in_progress', progress: 50 }]
    }); // goals

    const { block } = await buildMemoryContext({
      query: 'planning query',
      mode: 'plan',
      pool: { query: mockQuery },
    });

    expect(block).toContain('OKR 焦点');
    expect(block).toContain('目标A');
  });

  it('mode=chat 时 profile 包含 OKR（不再跳过）', async () => {
    mockSearchWithVectors.mockResolvedValueOnce({ matches: [] });
    mockQuery.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('goals')) {
        return Promise.resolve({ rows: [{ title: 'Cecelia 目标A', status: 'in_progress', progress: 30 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { block } = await buildMemoryContext({
      query: 'chat query',
      mode: 'chat',
      pool: { query: mockQuery },
    });

    expect(block).toContain('OKR');
    expect(block).toContain('目标A');
  });

  it('所有数据源失败时 graceful fallback', async () => {
    mockSearchWithVectors.mockRejectedValueOnce(new Error('OpenAI down'));
    mockQuery.mockRejectedValue(new Error('DB down'));

    const { block, meta } = await buildMemoryContext({
      query: 'test',
      mode: 'execute',
      pool: { query: mockQuery },
    });

    // 不 crash，返回空
    expect(block).toBe('');
    expect(meta.candidates).toBe(0);
  });

  it('时间衰减影响最终评分', async () => {
    const now = new Date().toISOString();
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();

    mockSearchWithVectors.mockResolvedValueOnce({
      matches: [
        { id: '1', level: 'task', title: '旧任务', description: 'old', score: 0.9, created_at: sixtyDaysAgo, status: 'completed' },
        { id: '2', level: 'task', title: '新任务', description: 'new', score: 0.7, created_at: now, status: 'in_progress' },
      ]
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // events
    mockQuery.mockResolvedValueOnce({ rows: [] }); // goals

    const { block } = await buildMemoryContext({
      query: 'test',
      mode: 'execute',
      pool: { query: mockQuery },
    });

    // 新任务（score 0.7 × decay ≈1 × weight 1.2 = 0.84）应排在旧任务（0.9 × decay ≈0.25 × 1.2 = 0.27）前面
    const lines = block.split('\n').filter(l => l.startsWith('- ['));
    if (lines.length >= 2) {
      expect(lines[0]).toContain('新任务');
    }
  });

  it('meta.sources 记录注入了哪些数据源', async () => {
    mockSearchWithVectors.mockResolvedValueOnce({
      matches: [
        { id: '1', level: 'task', title: '任务A', description: 'desc', score: 0.8, created_at: new Date().toISOString(), status: 'completed' },
      ]
    });
    mockSearchRelevantLearnings.mockResolvedValueOnce([
      { id: '2', title: '经验B', content: 'auth error fix', relevance_score: 20, created_at: new Date().toISOString() },
    ]);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // events
    mockQuery.mockResolvedValueOnce({ rows: [] }); // goals

    const { meta } = await buildMemoryContext({
      query: 'auth error',
      mode: 'debug',
      pool: { query: mockQuery },
    });

    expect(meta.sources).toBeDefined();
    expect(meta.injected).toBeGreaterThan(0);
  });
});

// ============================================================
// D9: generateL0Summary
// ============================================================

describe('generateL0Summary', () => {
  it('D9-1: 正常文本截断为 100 字符', () => {
    const long = 'A'.repeat(200);
    const result = generateL0Summary(long);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('D9-2: 空字符串返回空字符串', () => {
    expect(generateL0Summary('')).toBe('');
    expect(generateL0Summary(null)).toBe('');
    expect(generateL0Summary(undefined)).toBe('');
  });

  it('D9-3: 多余空白被合并', () => {
    const text = '  hello   world  ';
    expect(generateL0Summary(text)).toBe('hello world');
  });

  it('D9-4: 短文本直接返回', () => {
    const text = '反思洞察：今天 CI 通过了';
    expect(generateL0Summary(text)).toBe(text.trim());
  });
});

// ============================================================
// D10: searchEpisodicMemory
// ============================================================

describe('searchEpisodicMemory', () => {
  it('D10-1: pool 为 null 返回空数组', async () => {
    const result = await searchEpisodicMemory(null, '任务状态');
    expect(result).toEqual([]);
  });

  it('D10-2: query 为空返回空数组', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await searchEpisodicMemory(mockPool, '');
    expect(result).toEqual([]);
  });

  it('D10-3: 正常返回片段记忆记录', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'uuid-1',
            content: '[反思洞察] CI 今天连续失败，需要检查测试配置',
            summary: '[反思洞察] CI 今天连续失败',
            importance: 8,
            memory_type: 'long',
            created_at: new Date().toISOString(),
          },
          {
            id: 'uuid-2',
            content: '[反思洞察] Alex 最近对任务调度很感兴趣',
            summary: null,  // 历史记录无 summary
            importance: 6,
            memory_type: 'long',
            created_at: new Date().toISOString(),
          },
        ],
      }),
    };

    const result = await searchEpisodicMemory(mockPool, 'CI 失败', 500);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe('episodic');
  });

  it('D10-4: DB 错误时 graceful fallback 返回空数组', async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('DB connection error')),
    };
    const result = await searchEpisodicMemory(mockPool, '任务');
    expect(result).toEqual([]);
  });

  it('D10-5: token 预算控制（小预算只返回少量记录）', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `uuid-${i}`,
      content: `[反思洞察] 记录内容 ${i} `.repeat(10), // 每条约 100 字符
      summary: `摘要 ${i}`,
      importance: 5,
      memory_type: 'long',
      created_at: new Date().toISOString(),
    }));
    const mockPool = { query: vi.fn().mockResolvedValue({ rows }) };

    // 极小 token 预算
    const result = await searchEpisodicMemory(mockPool, '反思', 50);
    expect(result.length).toBeLessThan(10);
  });
});
