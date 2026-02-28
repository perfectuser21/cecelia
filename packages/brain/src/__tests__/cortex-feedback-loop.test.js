/**
 * Cortex Feedback Loop Fixes Tests
 *
 * 验证三个反馈闭环修复：
 * 1. recordLearnings 写 learnings 表（而非 cecelia_events）
 * 2. analyzeDeep 注入 self-model 到决策上下文
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('../thalamus.js', () => ({
  ACTION_WHITELIST: {
    request_human_review: { dangerous: false, description: 'Request human review' },
  },
  validateDecision: vi.fn(),
  recordLLMError: vi.fn(),
  recordTokenUsage: vi.fn(),
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: JSON.stringify({
    level: 2,
    analysis: { root_cause: 'test', contributing_factors: [], impact_assessment: 'test' },
    actions: [],
    strategy_updates: [],
    learnings: ['Test learning from cortex'],
    rationale: 'test',
    confidence: 0.8,
    safety: false,
  }) }),
}));

vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../cortex-quality.js', () => ({
  evaluateQualityInitial: vi.fn().mockResolvedValue(null),
  generateSimilarityHash: vi.fn().mockReturnValue('abc123'),
  checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: true }),
}));

vi.mock('../policy-validator.js', () => ({
  validatePolicyJson: vi.fn().mockReturnValue({ valid: false, errors: ['test'] }),
}));

vi.mock('../self-model.js', () => ({
  getSelfModel: vi.fn().mockResolvedValue('我是 Cecelia，AI 管家系统。'),
}));

vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn().mockReturnValue('test summary'),
}));

// ── Tests: recordLearnings writes to learnings table ─────────────────────────

describe('recordLearnings writes to learnings table (FLC-3)', () => {
  let analyzeDeep;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockReset();

    // Re-apply mocks
    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../thalamus.js', () => ({
      ACTION_WHITELIST: {
        request_human_review: { dangerous: false, description: 'Request human review' },
      },
      validateDecision: vi.fn(),
      recordLLMError: vi.fn(),
      recordTokenUsage: vi.fn(),
    }));
    vi.doMock('../llm-caller.js', () => ({
      callLLM: vi.fn().mockResolvedValue({ text: JSON.stringify({
        level: 2,
        analysis: { root_cause: 'test', contributing_factors: [], impact_assessment: 'test' },
        actions: [],
        strategy_updates: [],
        learnings: ['Cortex learned: retry on NETWORK failure'],
        rationale: 'test',
        confidence: 0.8,
        safety: false,
      }) }),
    }));
    vi.doMock('../learning.js', () => ({
      searchRelevantLearnings: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../cortex-quality.js', () => ({
      evaluateQualityInitial: vi.fn().mockResolvedValue(null),
      generateSimilarityHash: vi.fn().mockReturnValue('abc123'),
      checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: true }),
    }));
    vi.doMock('../policy-validator.js', () => ({
      validatePolicyJson: vi.fn().mockReturnValue({ valid: false, errors: ['test'] }),
    }));
    vi.doMock('../self-model.js', () => ({
      getSelfModel: vi.fn().mockResolvedValue('我是 Cecelia。'),
    }));
    vi.doMock('../memory-utils.js', () => ({
      generateL0Summary: vi.fn().mockReturnValue('summary'),
    }));

    const mod = await import('../cortex.js');
    analyzeDeep = mod.analyzeDeep;
  });

  function setupPoolMocks({ dedupResult = [] } = {}) {
    // 1. decision_log SELECT (recent decisions)
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 2. system_status SELECT
    mockPool.query.mockResolvedValueOnce({ rows: [{ tasks_in_progress: 0, recent_failures: 0, active_goals: 1 }] });
    // 3. searchRelevantAnalyses → cortex_analyses SELECT
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 4. logCortexDecision → INSERT INTO decision_log
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 5. recordLearnings: content_hash dedup check
    mockPool.query.mockResolvedValueOnce({ rows: dedupResult });
    if (dedupResult.length === 0) {
      // 6. recordLearnings: INSERT INTO learnings
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'learn-1' }] });
    }
  }

  it('recordLearnings writes to learnings table, not cecelia_events', async () => {
    setupPoolMocks();

    await analyzeDeep({ type: 'test_event' });

    // Verify learnings table was written (not cecelia_events for learning type)
    const insertCalls = mockPool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO learnings')
    );
    const cecyeliaEventsCalls = mockPool.query.mock.calls.filter(
      call => typeof call[0] === 'string' &&
        call[0].includes('INSERT INTO cecelia_events') &&
        (call[1]?.[0] === 'learning' || (Array.isArray(call[1]) && call[1][1] === 'cortex' && JSON.stringify(call[1][2] || '').includes('"learning"')))
    );

    expect(insertCalls.length).toBeGreaterThan(0);
    expect(cecyeliaEventsCalls.length).toBe(0);
  });

  it('recordLearnings INSERT includes category=cortex_insight', async () => {
    setupPoolMocks();

    await analyzeDeep({ type: 'rca_request' });

    const insertCall = mockPool.query.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO learnings')
    );
    expect(insertCall).toBeDefined();
    // The INSERT query should contain 'cortex_insight' category
    expect(insertCall[0]).toContain('cortex_insight');
  });

  it('recordLearnings deduplicates by content_hash', async () => {
    setupPoolMocks({ dedupResult: [{ id: 'existing-1' }] });

    await analyzeDeep({ type: 'test_event' });

    const insertCalls = mockPool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO learnings')
    );
    // INSERT should be skipped due to deduplication
    expect(insertCalls.length).toBe(0);
  });
});

// ── Tests: analyzeDeep injects self-model ────────────────────────────────────

describe('analyzeDeep injects self-model (FLC-2)', () => {
  let analyzeDeep;
  let mockCallLLM;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockReset();

    mockCallLLM = vi.fn().mockResolvedValue({ text: JSON.stringify({
      level: 2,
      analysis: { root_cause: 'test', contributing_factors: [], impact_assessment: 'test' },
      actions: [],
      strategy_updates: [],
      learnings: [],
      rationale: 'test',
      confidence: 0.8,
      safety: false,
    }) });

    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.doMock('../thalamus.js', () => ({
      ACTION_WHITELIST: {
        request_human_review: { dangerous: false, description: 'Request human review' },
      },
      validateDecision: vi.fn(),
      recordLLMError: vi.fn(),
      recordTokenUsage: vi.fn(),
    }));
    vi.doMock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));
    vi.doMock('../learning.js', () => ({
      searchRelevantLearnings: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../cortex-quality.js', () => ({
      evaluateQualityInitial: vi.fn().mockResolvedValue(null),
      generateSimilarityHash: vi.fn().mockReturnValue('abc123'),
      checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: true }),
    }));
    vi.doMock('../policy-validator.js', () => ({
      validatePolicyJson: vi.fn().mockReturnValue({ valid: false, errors: ['test'] }),
    }));
    vi.doMock('../self-model.js', () => ({
      getSelfModel: vi.fn().mockResolvedValue('我是 Cecelia，AI 管家，关注 OKR 进展。'),
    }));
    vi.doMock('../memory-utils.js', () => ({
      generateL0Summary: vi.fn().mockReturnValue('summary'),
    }));

    const mod = await import('../cortex.js');
    analyzeDeep = mod.analyzeDeep;
  });

  it('injects self_model into LLM prompt context', async () => {
    // 1. decision_log SELECT
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 2. system_status SELECT
    mockPool.query.mockResolvedValueOnce({ rows: [{ tasks_in_progress: 0, recent_failures: 0, active_goals: 1 }] });
    // 3. searchRelevantAnalyses → cortex_analyses SELECT
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 4. logCortexDecision → INSERT INTO decision_log
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await analyzeDeep({ type: 'test_event' });

    // Verify callLLM was called with a prompt containing self-model content
    expect(mockCallLLM).toHaveBeenCalledWith(
      'cortex',
      expect.stringContaining('我是 Cecelia'),
      expect.any(Object)
    );
  });
});
