/**
 * Cortex 熔断器持久化测试
 *
 * 验证 _reflectionState 的 PostgreSQL 持久化和降级行为
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

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

const mockCallLLM = vi.fn().mockResolvedValue({
  text: JSON.stringify({
    level: 2,
    analysis: { root_cause: 'test', contributing_factors: [], impact_assessment: 'test' },
    actions: [],
    strategy_updates: [],
    learnings: [],
    rationale: 'test',
    confidence: 0.8,
    safety: false,
  }),
});
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));

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
  getSelfModel: vi.fn().mockResolvedValue('test self model'),
}));

vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn().mockReturnValue('test summary'),
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Cortex 熔断器持久化', () => {
  let analyzeDeep, _resetBreakerStateForTest;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });

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
      getSelfModel: vi.fn().mockResolvedValue('test self model'),
    }));
    vi.doMock('../memory-utils.js', () => ({
      generateL0Summary: vi.fn().mockReturnValue('test summary'),
    }));

    const mod = await import('../cortex.js');
    analyzeDeep = mod.analyzeDeep;
    _resetBreakerStateForTest = mod._resetBreakerStateForTest;
  });

  it('启动时从 DB 加载熔断器状态', async () => {
    const savedState = {
      entries: [
        { hash: 'abc123deadbeef00', count: 2, firstSeen: Date.now() - 60000, lastSeen: Date.now() - 30000 },
      ],
      updatedAt: new Date().toISOString(),
    };

    // 首次查询返回保存的状态
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ value_json: savedState }] }) // _loadBreakerState
      .mockResolvedValue({ rows: [] }); // 后续查询

    const event = { type: 'persist_load_test' };
    await analyzeDeep(event);

    // 验证加载查询被调用
    expect(mockPool.query).toHaveBeenCalledWith(
      "SELECT value_json FROM working_memory WHERE key = 'cortex_breaker_state'"
    );
  }, 30000);

  it('每次更新后写入 DB', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const event = { type: 'persist_save_test' };
    await analyzeDeep(event);

    // 验证 UPSERT 被调用（保存状态 — key 在参数中，不在 SQL 中）
    const upsertCalls = mockPool.query.mock.calls.filter(call =>
      Array.isArray(call[1]) && call[1][0] === 'cortex_breaker_state'
    );
    expect(upsertCalls.length).toBeGreaterThanOrEqual(1);

    // 验证保存的数据包含 entries
    const savedData = JSON.parse(upsertCalls[0][1][1]);
    expect(savedData.entries).toBeDefined();
    expect(Array.isArray(savedData.entries)).toBe(true);
    expect(savedData.entries.length).toBe(1);
    expect(savedData.entries[0].count).toBe(1);
  }, 30000);

  it('DB 读取失败时降级为空 Map（不阻塞）', async () => {
    // 第一次查询（加载状态）失败
    mockPool.query
      .mockRejectedValueOnce(new Error('DB connection refused'))
      .mockResolvedValue({ rows: [] }); // 后续查询正常

    const event = { type: 'persist_fallback_read_test' };
    const result = await analyzeDeep(event);

    // 不应抛错，应正常返回
    expect(result).toBeDefined();
    expect(result.level).toBe(2);
  }, 30000);

  it('DB 写入失败时降级到内存（不阻塞分析流程）', async () => {
    // 加载查询正常，但保存时失败
    let callCount = 0;
    mockPool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('cortex_breaker_state') && sql.includes('INSERT')) {
        return Promise.reject(new Error('DB write failed'));
      }
      return Promise.resolve({ rows: [] });
    });

    const event = { type: 'persist_fallback_write_test' };
    const result = await analyzeDeep(event);

    // 分析仍应成功完成
    expect(result).toBeDefined();
    expect(result.level).toBe(2);
  }, 30000);

  it('重启后恢复熔断计数：已有 3 次记录 → 第 4 次直接熔断', async () => {
    const now = Date.now();
    const savedState = {
      entries: [
        {
          hash: '', // 将在测试中动态匹配
          count: 3,
          firstSeen: now - 60000,
          lastSeen: now - 10000,
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    // 计算事件的实际 hash（与 cortex.js 内部一致）
    const crypto = await import('crypto');
    const eventKey = JSON.stringify({
      type: 'persist_resume_test',
      failure_class: null,
      task_type: null,
    });
    const expectedHash = crypto.createHash('sha256').update(eventKey).digest('hex').slice(0, 16);
    savedState.entries[0].hash = expectedHash;

    // 加载保存的状态（count=3）
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ value_json: savedState }] }) // _loadBreakerState
      .mockResolvedValue({ rows: [] }); // 后续查询

    mockCallLLM.mockClear();

    const event = { type: 'persist_resume_test' };
    const result = await analyzeDeep(event);

    // 第 4 次应熔断（count > 3），LLM 不应被调用
    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(result._fallback).toBe(true);
  }, 30000);
});
