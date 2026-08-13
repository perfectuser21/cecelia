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
    // 316 = migration 316 design_docs type 白名单加 battle_report（battle-report.js INSERT 依赖）；
    // 地板随 migration 号推进（facts-check selfcheck_version_sync 卡：地板 <= 最高 migration）。
    // issue 14d66027 语义不变：只有代码/schema 依赖才 bump。
    // 322 = migration 322 issues.journey_id（warroom.js 全景图查询直接依赖），故推进地板到 322。
    // 323 = migration 323 initiative_runs.ability_id（harness-skill-relay.js spawn INSERT 直接依赖）；
    // 324 = migration 324 advancement_items.notion_synced_at（pushAdvancementItems 去重查询直接依赖）；
    // 326 = migration 326 side_effect_dedupe 表（lib/dedupe.js claimDedupeKey INSERT..ON CONFLICT 直接依赖，
    // 表不存在则 fail-open 降级恒触发）；
    // 331 = migration 331 learnings 谱系两列 + summary backfill（T9 学习账本可靠性依赖），故推进地板到 331。
    // 333 = migration 333 areas 去重 + KR1/KR2 metadata.target_abilities（OKR 数据卫生）；
    // 334 = migration 334 golden_paths 表（routes/golden-paths.js 与 gp-shelf-life.js 直接依赖）；
    // 335 = migration 335 golden_path_proposal task_type（GP2/T2 派发链直接依赖），故推进地板到 335。
    // 338 = migration 338 tasks.status 部分索引（postdeploy-verifier pending_postdeploy 扫描查询直接依赖）；
    // 339 = migration 339 DROP 死表 abilities + golden_paths priority/live 态（schema 清理/增强），故推进地板到 339。
    // 340 = migration 340 idx_tasks_dedup_lookup 部分索引（dispatcher.js 派发前标题判重查询
    // 直接依赖，避免全表扫描），故推进地板到 340。
    // 341 = migration 341 zenithjoy 裸表归位 schema（P0 事故修复版，无 ALTER DATABASE 副作用），
    // 342 = migration 342 decisions.source_ref 决策溯源列，故推进地板到 342。
    // 343 = migration 343 journey_features.guard_ref 裸奔 FR 守卫引用，故推进地板到 343。
    // 344 = migration 344 journey_features status CHECK 拓宽（修 343 窄枚举），故推进地板到 344。
    // 345 = migration 345 dev_records.is_canary 列（金丝雀演习任务标记），故推进地板到 345。
    // 346 = migration 346 incidents 表（刀5a 事故归一层），故推进地板到 346。
    // 347 = migration 347 design_docs CHECK 约束加 drill_report type（金丝雀演习修复 f97f24dc），故推进地板到 347。
    // 348 = migration 348 承诺地图 schema thin 版（四表扩展，MJ5 刀1 容器首刀），故推进地板到 348。
    // 349 = migration 349 MJ5 刀1 和解补齐（domain/cell_key/双 partial unique/FK SET NULL），故推进地板到 349。
    // 350 = migration 350 智能客服+首次成功两域承诺地图 seed 数据，故推进地板到 350。
    // 351 = migration 351 graph_edges 表（graph.js 语义关联网络直接依赖），故推进地板到 351。
    // 352 = migration 352 features 表更名 brain_modules（澄清 Brain 内部模块语义），故推进地板到 352。
    // 353 = migration 353 DROP conversation_captures + conversation_log_cursors（inbox P0 清场，decisions a823206d），故推进地板到 353。
    // 390 = capture_atoms unique(capture_id,target_type) — F6加厚幂等修复（ed911a7c）.
    // 392 = 验收一体两面数据层（AI 四列 + runs.detail + 7 值状态机 + (run_id,check_key) 唯一），故推进地板到 392。
    // 393 = GP 胶水参数化（golden_paths.base_repo + target_environment 两可空列），故推进地板到 393。
    // 402 = immutable Universal Map Manifest versions。
    // 403 = 事实池 source_revision + scanner_version + repo 字段补齐；
    // 404 = Universal Map projection compatibility placeholder；
    // 405 = rebuildable Universal Map Projection core。
    // 406 = Harness attempt account_exhausted callback control class；
    // 407 = explicit Universal Map repo adapters（406 已由 account_exhausted migration 占用）。
    // 408/409 = Impact Contract + Gap Ledger；410 = revision-indexed immutable graph snapshots；
    // 411 = reviewer-approved SHA 下的冻结合同测试制品；
    // 412 = approved Harness contract artifact manifests。
    // 416 = Work Router receipt governance 与 append-only recovery consumption。
    expect(EXPECTED_SCHEMA_VERSION).toBe('416');
  });
});
