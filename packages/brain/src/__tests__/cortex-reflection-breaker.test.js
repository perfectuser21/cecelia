/**
 * Cortex 反思熔断测试
 *
 * 验证 analyzeDeep 内容哈希去重 + 重复次数熔断机制（DoD D1-D6）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// ── 共用 mock pool setup ────────────────────────────────────────────────────────

function setupMockPool() {
  mockPool.query.mockResolvedValue({ rows: [] });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Cortex 反思熔断 - D3: 第 4 次相同事件跳过 LLM', () => {
  let analyzeDeep;

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
  });

  it('前 3 次正常调用 LLM，第 4 次触发熔断不调用 LLM', async () => {
    setupMockPool();
    mockCallLLM.mockClear();

    const event = { type: 'rca_breaker_d3_test' };

    // 前 3 次正常
    await analyzeDeep(event);
    await analyzeDeep(event);
    await analyzeDeep(event);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);

    // 第 4 次熔断，LLM 不应被调用
    const result = await analyzeDeep(event);
    expect(mockCallLLM).toHaveBeenCalledTimes(3); // 不增加
    expect(result._fallback).toBe(true);
  }, 30000);
});

describe('Cortex 反思熔断 - D4: 熔断日志包含 "反思熔断"', () => {
  let analyzeDeep;

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
  });

  it('熔断触发时日志包含 "反思熔断"', async () => {
    setupMockPool();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const event = { type: 'rca_breaker_d4_test' };

    // 触发 4 次
    for (let i = 0; i < 4; i++) {
      await analyzeDeep(event);
    }

    const allLogs = logSpy.mock.calls.flat().join(' ');
    expect(allLogs).toContain('反思熔断');

    logSpy.mockRestore();
  }, 30000);
});

describe('Cortex 反思熔断 - D6: 30 分钟窗口超时后 count 重置', () => {
  let analyzeDeep;
  let dateNowSpy;

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
  });

  afterEach(() => {
    if (dateNowSpy) {
      dateNowSpy.mockRestore();
      dateNowSpy = null;
    }
  });

  it('时间窗口超过 30 分钟后 count 重置，不触发熔断', async () => {
    setupMockPool();
    mockCallLLM.mockClear();

    const baseTime = Date.now();
    let timeOffset = 0;
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => baseTime + timeOffset);

    const event = { type: 'rca_breaker_d6_test' };

    // T=0: 触发 3 次填满窗口
    await analyzeDeep(event);
    await analyzeDeep(event);
    await analyzeDeep(event);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);

    // T=4: 第 4 次应熔断
    const blocked = await analyzeDeep(event);
    expect(blocked._fallback).toBe(true);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);

    // T=31min: 窗口超时
    timeOffset = 31 * 60 * 1000;
    mockCallLLM.mockClear();

    // 应该重置，正常调用 LLM
    const result = await analyzeDeep(event);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(result.rationale || '').not.toContain('反思熔断');
  }, 30000);
});
