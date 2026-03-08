/**
 * Cortex 输出去重熔断测试
 *
 * 验证 analyzeDeep 对 LLM 输出内容做去重，相同 root_cause >=2 次自动熔断
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

const SAME_ROOT_CAUSE = 'Database connection pool exhausted due to leaked connections';

const mockCallLLM = vi.fn().mockResolvedValue({
  text: JSON.stringify({
    level: 2,
    analysis: { root_cause: SAME_ROOT_CAUSE, contributing_factors: [], impact_assessment: 'test' },
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

function setupMockPool() {
  mockPool.query.mockResolvedValue({ rows: [] });
}

// ── D1: _outputDedupState 独立于 _reflectionState ─────────────────────────────

describe('D1: _outputDedupState 独立于 _reflectionState', () => {
  let _checkOutputDedup, _checkReflectionBreaker, _resetReflectionState, _resetOutputDedupState;

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
    _checkOutputDedup = mod._checkOutputDedup;
    _checkReflectionBreaker = mod._checkReflectionBreaker;
    _resetReflectionState = mod._resetReflectionState;
    _resetOutputDedupState = mod._resetOutputDedupState;
  });

  it('输出去重和输入去重使用独立的 Map', async () => {
    setupMockPool();

    // 触发输出去重
    const outputResult = await _checkOutputDedup('output_hash_1');
    expect(outputResult.duplicate).toBe(false);

    // 触发输入去重
    const inputResult = await _checkReflectionBreaker('input_hash_1');
    expect(inputResult.open).toBe(false);

    // 重置输出不影响输入
    _resetOutputDedupState();
    const inputAfterReset = await _checkReflectionBreaker('input_hash_1');
    expect(inputAfterReset.count).toBe(2); // 累计

    // 重置输入不影响输出
    _resetReflectionState();
    // 输出已被 reset，再次触发应从 1 开始
    const outputAfterReset = await _checkOutputDedup('output_hash_1');
    expect(outputAfterReset.count).toBe(1);
  }, 30000);
});

// ── D2: _computeOutputHash 哈希一致性 ──────────────────────────────────────────

describe('D2: _computeOutputHash 哈希一致性', () => {
  let _computeOutputHash;

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
    _computeOutputHash = mod._computeOutputHash;
  });

  it('相同 root_cause 产生相同 hash', () => {
    const d1 = { analysis: { root_cause: 'Connection pool exhausted' } };
    const d2 = { analysis: { root_cause: 'Connection pool exhausted' } };
    expect(_computeOutputHash(d1)).toBe(_computeOutputHash(d2));
  });

  it('大小写不影响 hash（normalize）', () => {
    const d1 = { analysis: { root_cause: 'Pool Exhausted' } };
    const d2 = { analysis: { root_cause: 'pool exhausted' } };
    expect(_computeOutputHash(d1)).toBe(_computeOutputHash(d2));
  });

  it('不同 root_cause 产生不同 hash', () => {
    const d1 = { analysis: { root_cause: 'Connection pool exhausted' } };
    const d2 = { analysis: { root_cause: 'Memory leak in worker thread' } };
    expect(_computeOutputHash(d1)).not.toBe(_computeOutputHash(d2));
  });

  it('hash 长度为 16 字符', () => {
    const d = { analysis: { root_cause: 'test' } };
    expect(_computeOutputHash(d)).toHaveLength(16);
  });
});

// ── D3: _checkOutputDedup 阈值 ≥2 ─────────────────────────────────────────────

describe('D3: _checkOutputDedup 阈值 ≥2', () => {
  let _checkOutputDedup, _resetOutputDedupState;

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
    _checkOutputDedup = mod._checkOutputDedup;
    _resetOutputDedupState = mod._resetOutputDedupState;
  });

  it('第 1 次 duplicate=false，第 2 次 duplicate=true', async () => {
    setupMockPool();

    const r1 = await _checkOutputDedup('same_hash');
    expect(r1.duplicate).toBe(false);
    expect(r1.count).toBe(1);

    const r2 = await _checkOutputDedup('same_hash');
    expect(r2.duplicate).toBe(true);
    expect(r2.count).toBe(2);
  }, 30000);

  it('不同 hash 互不影响', async () => {
    setupMockPool();

    await _checkOutputDedup('hash_a');
    const r = await _checkOutputDedup('hash_b');
    expect(r.duplicate).toBe(false);
    expect(r.count).toBe(1);
  }, 30000);
});

// ── D4: analyzeDeep 输出重复时返回 fallback ──────────────────────────────────────

describe('D4: analyzeDeep 输出重复时返回 fallback', () => {
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

  it('第 1 次正常返回，第 2 次相同 root_cause 触发输出去重', async () => {
    setupMockPool();
    mockCallLLM.mockClear();

    // 使用不同的事件类型避免输入级熔断
    const event1 = { type: 'output_dedup_test_1' };
    const event2 = { type: 'output_dedup_test_2' };

    // 第 1 次正常
    const r1 = await analyzeDeep(event1);
    expect(r1._fallback).toBeUndefined();
    expect(r1.analysis.root_cause).toBe(SAME_ROOT_CAUSE);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);

    // 第 2 次不同事件但 LLM 返回相同 root_cause → 输出去重熔断
    const r2 = await analyzeDeep(event2);
    expect(mockCallLLM).toHaveBeenCalledTimes(2); // LLM 被调用了（输入不同）
    expect(r2._fallback).toBe(true);
    expect(r2.rationale).toContain('输出去重');
  }, 30000);

  it('不同 root_cause 不触发输出去重', async () => {
    setupMockPool();
    mockCallLLM.mockClear();

    // 第 1 次返回 root_cause A
    mockCallLLM.mockResolvedValueOnce({
      text: JSON.stringify({
        level: 2,
        analysis: { root_cause: 'Cause A', contributing_factors: [], impact_assessment: 'test' },
        actions: [],
        strategy_updates: [],
        learnings: [],
        rationale: 'test',
        confidence: 0.8,
        safety: false,
      }),
    });

    // 第 2 次返回 root_cause B（不同）
    mockCallLLM.mockResolvedValueOnce({
      text: JSON.stringify({
        level: 2,
        analysis: { root_cause: 'Cause B', contributing_factors: [], impact_assessment: 'test' },
        actions: [],
        strategy_updates: [],
        learnings: [],
        rationale: 'test',
        confidence: 0.8,
        safety: false,
      }),
    });

    const r1 = await analyzeDeep({ type: 'test_diff_1' });
    const r2 = await analyzeDeep({ type: 'test_diff_2' });

    expect(r1._fallback).toBeUndefined();
    expect(r2._fallback).toBeUndefined();
  }, 30000);
});

// ── D5: 输出去重状态持久化 ─────────────────────────────────────────────────────

describe('D5: 输出去重状态持久化到 working_memory', () => {
  let _checkOutputDedup;

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
    _checkOutputDedup = mod._checkOutputDedup;
  });

  it('写入 working_memory 的 key 前缀为 cortex_output_dedup:', async () => {
    setupMockPool();

    await _checkOutputDedup('test_persist_hash');

    // 查找 INSERT 调用中包含 cortex_output_dedup: 前缀的
    const insertCalls = mockPool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO working_memory')
    );
    expect(insertCalls.length).toBeGreaterThan(0);

    const lastInsert = insertCalls[insertCalls.length - 1];
    expect(lastInsert[1][0]).toBe('cortex_output_dedup:test_persist_hash');
  }, 30000);
});

// ── D6: 30 分钟窗口过期重置 ────────────────────────────────────────────────────

describe('D6: 30 分钟窗口过期重置', () => {
  let _checkOutputDedup, _resetOutputDedupState;

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
    _checkOutputDedup = mod._checkOutputDedup;
    _resetOutputDedupState = mod._resetOutputDedupState;
  });

  it('30 分钟后窗口重置，duplicate 重新为 false', async () => {
    setupMockPool();

    // 第 1 次
    await _checkOutputDedup('expire_test');
    // 第 2 次触发 duplicate
    const r2 = await _checkOutputDedup('expire_test');
    expect(r2.duplicate).toBe(true);

    // 模拟 31 分钟后
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);

    const r3 = await _checkOutputDedup('expire_test');
    expect(r3.duplicate).toBe(false);
    expect(r3.count).toBe(1);

    vi.useRealTimers();
  }, 30000);
});

// ── D5: autoCreateTaskFromCortex 闭环机制 ─────────────────────────────────────

describe('D5: autoCreateTaskFromCortex 闭环机制', () => {
  let autoCreateTaskFromCortex;

  function setupMocks() {
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

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    setupMocks();
    const mod = await import('../cortex.js');
    autoCreateTaskFromCortex = mod.autoCreateTaskFromCortex;
  });

  it('confidence >= 0.7 + strategy_updates → 创建 task', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })                         // SELECT working_memory（无记录）
      .mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] })   // INSERT tasks
      .mockResolvedValueOnce({ rows: [] });                        // INSERT working_memory

    const decision = {
      confidence: 0.85,
      analysis: { root_cause: 'Connection pool exhausted due to memory leak' },
      strategy_updates: [{ key: 'resource.max_concurrent', new_value: 5, reason: 'reduce load' }],
    };
    await autoCreateTaskFromCortex(decision, { type: 'resource_overload' });

    const insertCall = mockPool.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeDefined();
    const insertTitle = insertCall[1][0];
    expect(insertTitle).toContain('[皮层建议]');
    expect(insertTitle).toContain('Connection pool');
  }, 30000);

  it('相同 root_cause 24h 内 → 跳过（去重）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ key: 'cortex_task_created:abc' }] });

    const decision = {
      confidence: 0.9,
      analysis: { root_cause: 'Same root cause as before' },
      strategy_updates: [{ key: 'retry.max_attempts', new_value: 3, reason: 'stability' }],
    };
    await autoCreateTaskFromCortex(decision, { type: 'recurring_failure' });

    const insertCall = mockPool.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeUndefined();
  }, 30000);
});
