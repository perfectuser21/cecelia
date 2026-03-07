/**
 * Cortex 诊断输出去重测试
 *
 * 验证不同输入事件产生相同诊断输出时的去重熔断机制（DoD D1-D6）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Shared mock setup ────────────────────────────────────────────────────────

const mockPool = { query: vi.fn() };

function createLLMResponse(rootCause) {
  return {
    text: JSON.stringify({
      level: 2,
      analysis: { root_cause: rootCause, contributing_factors: [], impact_assessment: 'test' },
      actions: [],
      strategy_updates: [],
      learnings: [],
      rationale: 'test rationale',
      confidence: 0.8,
      safety: false,
    }),
  };
}

function setupAllMocks(mockCallLLM) {
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
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Cortex 诊断输出去重 - D2: 相同诊断 >=3 次后跳过 LLM', () => {
  let analyzeDeep;
  let mockCallLLM;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });

    mockCallLLM = vi.fn().mockResolvedValue(createLLMResponse('系统需要重启'));
    setupAllMocks(mockCallLLM);

    const mod = await import('../cortex.js');
    analyzeDeep = mod.analyzeDeep;
  });

  it('不同输入事件产生相同诊断，第 4 次跳过 LLM 调用', async () => {
    // 3 个不同事件，但 LLM 都返回同一个 root_cause
    await analyzeDeep({ type: 'rca_request', failed_task: { task_type: 'dev' } });
    await analyzeDeep({ type: 'rca_request', failed_task: { task_type: 'code_review' } });
    await analyzeDeep({ type: 'failure_analysis', task: { task_type: 'qa' } });
    expect(mockCallLLM).toHaveBeenCalledTimes(3);

    // 第 4 次：诊断去重触发，不调用 LLM
    const result = await analyzeDeep({ type: 'rca_request', failed_task: { task_type: 'deploy' } });
    expect(mockCallLLM).toHaveBeenCalledTimes(3); // 不增加
    expect(result._fallback).toBe(true);
  }, 30000);
});

describe('Cortex 诊断输出去重 - D4: 日志包含 "诊断去重熔断"', () => {
  let analyzeDeep;
  let mockCallLLM;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });

    mockCallLLM = vi.fn().mockResolvedValue(createLLMResponse('重复的诊断'));
    setupAllMocks(mockCallLLM);

    const mod = await import('../cortex.js');
    analyzeDeep = mod.analyzeDeep;
  });

  it('熔断触发时日志包含 "诊断去重熔断"', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await analyzeDeep({ type: 'event_a' });
    await analyzeDeep({ type: 'event_b' });
    await analyzeDeep({ type: 'event_c' });
    // 第 4 次触发去重
    await analyzeDeep({ type: 'event_d' });

    const allLogs = logSpy.mock.calls.flat().join(' ');
    expect(allLogs).toContain('诊断去重熔断');

    logSpy.mockRestore();
  }, 30000);
});

describe('Cortex 诊断输出去重 - D5: 不同诊断不被误杀', () => {
  let analyzeDeep;
  let mockCallLLM;
  let callCount;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });

    callCount = 0;
    mockCallLLM = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(createLLMResponse(`诊断结论 ${callCount}`));
    });
    setupAllMocks(mockCallLLM);

    const mod = await import('../cortex.js');
    analyzeDeep = mod.analyzeDeep;
  });

  it('每次诊断不同时，不触发去重熔断', async () => {
    await analyzeDeep({ type: 'event_1' });
    await analyzeDeep({ type: 'event_2' });
    await analyzeDeep({ type: 'event_3' });
    await analyzeDeep({ type: 'event_4' });
    await analyzeDeep({ type: 'event_5' });

    expect(mockCallLLM).toHaveBeenCalledTimes(5);
  }, 30000);
});

describe('Cortex 诊断输出去重 - D3: 缓存限制 50 条', () => {
  let analyzeDeep;
  let mockCallLLM;
  let callCount;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });

    callCount = 0;
    mockCallLLM = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 50) {
        return Promise.resolve(createLLMResponse(`唯一诊断 ${callCount}`));
      }
      return Promise.resolve(createLLMResponse('重复诊断'));
    });
    setupAllMocks(mockCallLLM);

    const mod = await import('../cortex.js');
    analyzeDeep = mod.analyzeDeep;
  });

  it('缓存超过 50 条后旧条目被淘汰', async () => {
    // 写入 50 条不同诊断
    for (let i = 0; i < 50; i++) {
      await analyzeDeep({ type: `fill_${i}` });
    }
    expect(mockCallLLM).toHaveBeenCalledTimes(50);

    // 再写 3 条相同诊断
    mockCallLLM.mockClear();
    await analyzeDeep({ type: 'new_1' });
    await analyzeDeep({ type: 'new_2' });
    await analyzeDeep({ type: 'new_3' });
    expect(mockCallLLM).toHaveBeenCalledTimes(3);

    // 第 4 条相同诊断应被熔断
    const result = await analyzeDeep({ type: 'new_4' });
    expect(mockCallLLM).toHaveBeenCalledTimes(3);
    expect(result._fallback).toBe(true);
  }, 60000);
});

describe('Cortex 诊断输出去重 - D6: 30 分钟窗口超时重置', () => {
  let analyzeDeep;
  let mockCallLLM;
  let dateNowSpy;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });

    mockCallLLM = vi.fn().mockResolvedValue(createLLMResponse('重复诊断'));
    setupAllMocks(mockCallLLM);

    const mod = await import('../cortex.js');
    analyzeDeep = mod.analyzeDeep;
  });

  afterEach(() => {
    if (dateNowSpy) {
      dateNowSpy.mockRestore();
      dateNowSpy = null;
    }
  });

  it('30 分钟窗口超时后诊断去重计数器重置', async () => {
    const baseTime = Date.now();
    let timeOffset = 0;
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => baseTime + timeOffset);

    // T=0: 3 次相同诊断
    await analyzeDeep({ type: 'evt_1' });
    await analyzeDeep({ type: 'evt_2' });
    await analyzeDeep({ type: 'evt_3' });
    expect(mockCallLLM).toHaveBeenCalledTimes(3);

    // T=0: 第 4 次应被熔断
    const blocked = await analyzeDeep({ type: 'evt_4' });
    expect(blocked._fallback).toBe(true);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);

    // T=31min: 窗口超时
    timeOffset = 31 * 60 * 1000;
    mockCallLLM.mockClear();

    // 应该重置，正常调用 LLM
    const result = await analyzeDeep({ type: 'evt_5' });
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(result._fallback).toBeUndefined();
  }, 30000);
});
