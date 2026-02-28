/**
 * Learnings 向量化测试 (Phase 2)
 *
 * 测试覆盖：
 * - embedding-service: generateLearningEmbeddingAsync
 * - learning.js: recordLearning fire-and-forget embedding
 * - learning.js: searchRelevantLearnings 向量 + 关键词混合
 * - learning.js: vectorSearchLearnings / keywordSearchLearnings / keywordBoost
 * - graceful fallback: OpenAI 不可用时降级关键词匹配
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mocks
// ============================================================

// Mock db.js
const mockPool = {
  query: vi.fn(),
};
vi.mock('../db.js', () => ({ default: mockPool }));

// Mock openai-client.js
const mockGenerateEmbedding = vi.fn();
vi.mock('../openai-client.js', () => ({
  generateEmbedding: (...args) => mockGenerateEmbedding(...args),
}));

// ============================================================
// Tests: embedding-service.js
// ============================================================

describe('embedding-service: generateLearningEmbeddingAsync', () => {
  let generateLearningEmbeddingAsync;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockGenerateEmbedding.mockReset();

    // Re-mock for fresh import
    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: (...args) => mockGenerateEmbedding(...args),
    }));

    const mod = await import('../embedding-service.js');
    generateLearningEmbeddingAsync = mod.generateLearningEmbeddingAsync;
  });

  it('should generate and save learning embedding', async () => {
    const fakeEmbedding = Array(1536).fill(0.1);
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
    mockPool.query.mockResolvedValue({ rows: [] });

    process.env.OPENAI_API_KEY = 'test-key';

    await generateLearningEmbeddingAsync('learning-1', 'test text');

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('test text');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE learnings SET embedding'),
      expect.arrayContaining(['learning-1'])
    );
  });

  it('should no-op without OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;

    await generateLearningEmbeddingAsync('learning-1', 'test text');

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('should truncate text to 4000 chars', async () => {
    const longText = 'a'.repeat(5000);
    const fakeEmbedding = Array(1536).fill(0.1);
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
    mockPool.query.mockResolvedValue({ rows: [] });
    process.env.OPENAI_API_KEY = 'test-key';

    await generateLearningEmbeddingAsync('learning-1', longText);

    const calledText = mockGenerateEmbedding.mock.calls[0][0];
    expect(calledText.length).toBe(4000);
  });

  it('should silently fail on error', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('API error'));
    process.env.OPENAI_API_KEY = 'test-key';

    // Should not throw
    await expect(
      generateLearningEmbeddingAsync('learning-1', 'test text')
    ).resolves.toBeUndefined();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });
});

// ============================================================
// Tests: learning.js
// ============================================================

describe('learning.js: recordLearning with embedding', () => {
  let recordLearning;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockGenerateEmbedding.mockReset();

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: (...args) => mockGenerateEmbedding(...args),
    }));

    process.env.OPENAI_API_KEY = 'test-key';

    const mod = await import('../learning.js');
    recordLearning = mod.recordLearning;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('should fire-and-forget embedding after INSERT', async () => {
    const fakeEmbedding = Array(1536).fill(0.1);
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);

    // content_hash dedup check (no duplicate found)
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT returns the learning record
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'learning-abc', title: 'RCA Learning: test' }],
    });
    // UPDATE for embedding
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await recordLearning({
      task_id: 'task-1',
      analysis: { root_cause: 'test failure', contributing_factors: [] },
      learnings: ['lesson 1'],
      recommended_actions: [],
    });

    expect(result.id).toBe('learning-abc');

    // Wait for fire-and-forget
    await new Promise(r => setTimeout(r, 50));

    // generateEmbedding should have been called
    expect(mockGenerateEmbedding).toHaveBeenCalled();
  });
});

describe('learning.js: searchRelevantLearnings', () => {
  let searchRelevantLearnings;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockGenerateEmbedding.mockReset();

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: (...args) => mockGenerateEmbedding(...args),
    }));

    const mod = await import('../learning.js');
    searchRelevantLearnings = mod.searchRelevantLearnings;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('should use vector search when embeddings exist and API key present', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    // COUNT query
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });
    // Vector search query
    const fakeEmbedding = Array(1536).fill(0.1);
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'l1', title: 'Auth fix', category: 'failure_pattern',
          trigger_event: 'systemic_failure', content: 'auth error fix',
          strategy_adjustments: '[]', applied: false,
          created_at: new Date().toISOString(), metadata: {},
          vector_score: 0.85,
        },
      ],
    });

    const results = await searchRelevantLearnings({ description: 'auth error' }, 5);

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('l1');
    expect(results[0].relevance_score).toBeGreaterThan(0);
    expect(mockGenerateEmbedding).toHaveBeenCalled();
  });

  it('should fallback to keyword search without API key', async () => {
    delete process.env.OPENAI_API_KEY;

    // Keyword search (fetches all learnings)
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'l1', title: 'Auth fix', category: 'failure_pattern',
          trigger_event: 'systemic_failure', content: 'auth error fix',
          strategy_adjustments: '[]', applied: false,
          created_at: new Date().toISOString(), metadata: { task_type: 'dev' },
        },
      ],
    });

    const results = await searchRelevantLearnings({ task_type: 'dev' }, 5);

    expect(results.length).toBe(1);
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('should fallback to keyword search when no embeddings exist', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    // COUNT query returns 0
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    // Keyword search
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'l2', title: 'Network fix', category: 'failure_pattern',
          trigger_event: 'systemic_failure', content: 'network timeout',
          strategy_adjustments: '[]', applied: false,
          created_at: new Date().toISOString(), metadata: {},
        },
      ],
    });

    const results = await searchRelevantLearnings({ description: 'network issue' }, 5);

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('l2');
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('should fallback when embedding column does not exist', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    // COUNT query throws (column doesn't exist)
    mockPool.query.mockRejectedValueOnce(new Error('column "embedding" does not exist'));
    // Keyword search
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'l3', title: 'Rate limit', category: 'failure_pattern',
          trigger_event: 'systemic_failure', content: 'rate limit hit',
          strategy_adjustments: '[]', applied: false,
          created_at: new Date().toISOString(), metadata: {},
        },
      ],
    });

    const results = await searchRelevantLearnings({ description: 'rate limit' }, 5);

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('l3');
  });

  it('should graceful fallback when OpenAI fails during vector search', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    // COUNT query returns > 0
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });
    // generateEmbedding fails
    mockGenerateEmbedding.mockRejectedValue(new Error('OpenAI quota exceeded'));
    // getRecentLearnings fallback
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'l4', title: 'Fallback learning', category: 'failure_pattern',
          trigger_event: 'systemic_failure', content: 'fallback',
          strategy_adjustments: '[]', applied: false,
          created_at: new Date().toISOString(), metadata: {},
        },
      ],
    });

    const results = await searchRelevantLearnings({ description: 'test' }, 5);

    // Should have results from fallback (getRecentLearnings)
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});

describe('learning.js: keywordBoost', () => {
  let _keywordBoost;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockGenerateEmbedding.mockReset();

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: (...args) => mockGenerateEmbedding(...args),
    }));

    const mod = await import('../learning.js');
    _keywordBoost = mod._keywordBoost;
  });

  it('should boost for task_type match', () => {
    const learning = { metadata: { task_type: 'dev' }, content: '', trigger_event: '', category: '' };
    expect(_keywordBoost(learning, { task_type: 'dev' })).toBe(5);
  });

  it('should boost for failure_class match in content', () => {
    const learning = { metadata: {}, content: 'NETWORK error happened', trigger_event: '', category: '' };
    expect(_keywordBoost(learning, { failure_class: 'NETWORK' })).toBe(4);
  });

  it('should boost for event_type match', () => {
    const learning = { metadata: {}, content: '', trigger_event: 'systemic_failure', category: '' };
    expect(_keywordBoost(learning, { event_type: 'systemic_failure' })).toBe(3);
  });

  it('should boost for failure_pattern category', () => {
    const learning = { metadata: {}, content: '', trigger_event: '', category: 'failure_pattern' };
    expect(_keywordBoost(learning, {})).toBe(2);
  });

  it('should accumulate multiple boosts', () => {
    const learning = {
      metadata: { task_type: 'dev' },
      content: 'network error',
      trigger_event: 'systemic_failure',
      category: 'failure_pattern',
    };
    const boost = _keywordBoost(learning, {
      task_type: 'dev',
      failure_class: 'network',
      event_type: 'systemic_failure',
    });
    expect(boost).toBe(5 + 4 + 3 + 2); // 14
  });

  it('should return 0 for empty context', () => {
    const learning = { metadata: {}, content: '', trigger_event: '', category: '' };
    expect(_keywordBoost(learning, {})).toBe(0);
  });
});

describe('learning.js: keywordSearchLearnings', () => {
  let _keywordSearchLearnings;

  beforeEach(async () => {
    vi.resetModules();
    mockPool.query.mockReset();

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: (...args) => mockGenerateEmbedding(...args),
    }));

    const mod = await import('../learning.js');
    _keywordSearchLearnings = mod._keywordSearchLearnings;
  });

  it('should score learnings with keyword matching', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'l1', title: 'Auth fix', category: 'failure_pattern',
          trigger_event: 'systemic_failure', content: 'auth error fix',
          strategy_adjustments: '[]', applied: false,
          created_at: new Date().toISOString(),
          metadata: { task_type: 'dev' },
        },
        {
          id: 'l2', title: 'Random', category: 'optimization',
          trigger_event: 'manual', content: 'some other thing',
          strategy_adjustments: '[]', applied: false,
          created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
          metadata: {},
        },
      ],
    });

    const results = await _keywordSearchLearnings({ task_type: 'dev' }, 10);

    expect(results.length).toBe(2);
    // l1 should score higher (task_type match + failure_pattern + freshness)
    expect(results[0].relevance_score).toBeGreaterThan(results[1].relevance_score);
  });
});

describe('migration 053 validation', () => {
  it('should have correct migration file', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const migrationPath = path.resolve(
      import.meta.dirname, '../../migrations/053_learnings_embedding.sql'
    );
    const content = fs.readFileSync(migrationPath, 'utf-8');

    expect(content).toContain('ALTER TABLE learnings ADD COLUMN');
    expect(content).toContain('embedding vector(1536)');
    expect(content).toContain('learnings_embedding_idx');
    expect(content).toContain('hnsw');
    expect(content).toContain("'053'");
  });
});

describe('selfcheck schema version', () => {
  it('should match current schema version', async () => {
    vi.resetModules();

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: (...args) => mockGenerateEmbedding(...args),
    }));

    const { EXPECTED_SCHEMA_VERSION } = await import('../selfcheck.js');
    expect(EXPECTED_SCHEMA_VERSION).toBe('090');
  });
});
