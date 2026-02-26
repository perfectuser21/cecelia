/**
 * Model Profile Dispatch Tests
 *
 * 测试 profile 切换后，executor / thalamus / cortex 正确路由到不同 LLM。
 * 使用 vi.doMock 隔离 model-profile.js 模块状态。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// D13: executor getModelForTask / getProviderForTask
// ============================================================

describe('executor profile-aware routing', () => {
  let getModelForTask, getProviderForTask;
  let mockGetActiveProfile;

  beforeEach(async () => {
    vi.resetModules();

    // Mock model-profile.js
    mockGetActiveProfile = vi.fn();
    vi.doMock('../model-profile.js', () => ({
      getActiveProfile: mockGetActiveProfile,
      FALLBACK_PROFILE: {
        id: 'profile-minimax',
        config: {
          executor: {
            default_provider: 'minimax',
            model_map: {
              dev: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
              exploratory: { anthropic: null, minimax: 'MiniMax-M2.1' },
              codex_qa: { anthropic: null, minimax: null },
            },
            fixed_provider: {
              exploratory: 'minimax',
              codex_qa: 'openai',
            },
          },
        },
      },
    }));

    // Mock all other heavy dependencies
    vi.doMock('../db.js', () => ({ default: { query: vi.fn() } }));
    vi.doMock('../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn() }));
    vi.doMock('../task-router.js', () => ({ getTaskLocation: vi.fn(), isValidTaskType: vi.fn(() => true), LOCATION_MAP: {} }));
    vi.doMock('../event-bus.js', () => ({ emit: vi.fn() }));
    vi.doMock('../events/taskEvents.js', () => ({ publishTaskStarted: vi.fn(), publishExecutorStatus: vi.fn() }));
    vi.doMock('../circuit-breaker.js', () => ({ isAllowed: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() }));
    vi.doMock('../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn() }));
    vi.doMock('../slot-allocator.js', () => ({ calculateSlotBudget: vi.fn() }));
    vi.doMock('../alertness/index.js', () => ({ canDispatch: vi.fn(() => true), getDispatchRate: vi.fn(() => 1) }));
    vi.doMock('../alertness/metrics.js', () => ({ recordOperation: vi.fn() }));
    vi.doMock('child_process', () => ({ spawn: vi.fn() }));

    const mod = await import('../executor.js');
    getModelForTask = mod.getModelForTask;
    getProviderForTask = mod.getProviderForTask;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('D13a: MiniMax profile → dev task 返回 minimax provider', () => {
    mockGetActiveProfile.mockReturnValue({
      config: {
        executor: {
          default_provider: 'minimax',
          model_map: { dev: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' } },
          fixed_provider: {},
        },
      },
    });

    const provider = getProviderForTask({ task_type: 'dev' });
    expect(provider).toBe('minimax');
  });

  it('D13b: Anthropic profile → dev task 返回 anthropic provider', () => {
    mockGetActiveProfile.mockReturnValue({
      config: {
        executor: {
          default_provider: 'anthropic',
          model_map: { dev: { anthropic: 'claude-sonnet-4-20250514', minimax: null } },
          fixed_provider: {},
        },
      },
    });

    const provider = getProviderForTask({ task_type: 'dev' });
    expect(provider).toBe('anthropic');
  });

  it('D13c: codex_qa 始终固定 openai', () => {
    mockGetActiveProfile.mockReturnValue({
      config: {
        executor: {
          default_provider: 'minimax',
          model_map: { codex_qa: { anthropic: null, minimax: null } },
          fixed_provider: { codex_qa: 'openai' },
        },
      },
    });

    const provider = getProviderForTask({ task_type: 'codex_qa' });
    expect(provider).toBe('openai');
  });

  it('D13d: getModelForTask 返回 profile 中的模型', () => {
    mockGetActiveProfile.mockReturnValue({
      config: {
        executor: {
          default_provider: 'minimax',
          model_map: { dev: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' } },
          fixed_provider: {},
        },
      },
    });

    const model = getModelForTask({ task_type: 'dev' });
    expect(model).toBe('MiniMax-M2.5-highspeed');
  });

  it('D13e: codex_qa getModelForTask 返回 null', () => {
    mockGetActiveProfile.mockReturnValue({
      config: {
        executor: {
          default_provider: 'minimax',
          model_map: {},
          fixed_provider: { codex_qa: 'openai' },
        },
      },
    });

    const model = getModelForTask({ task_type: 'codex_qa' });
    expect(model).toBeNull();
  });
});

// ============================================================
// D14: thalamus callThalamusLLM dispatch
// ============================================================

describe('thalamus profile dispatch', () => {
  let callThalamusLLM;
  let mockCallLLM;

  beforeEach(async () => {
    vi.resetModules();

    // callThalamusLLM 现在是一个 legacy shim，内部转发到 callLLM
    // 直接 mock llm-caller.js
    mockCallLLM = vi.fn();
    vi.doMock('../llm-caller.js', () => ({
      callLLM: mockCallLLM,
    }));

    // Mock DB
    vi.doMock('../db.js', () => ({ default: { query: vi.fn() } }));

    // Mock event-bus
    vi.doMock('../event-bus.js', () => ({ emit: vi.fn() }));

    // Mock memory/learning deps
    vi.doMock('../memory-retriever.js', () => ({
      buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
    }));
    vi.doMock('../learning.js', () => ({
      getRecentLearnings: vi.fn().mockResolvedValue([]),
      searchRelevantLearnings: vi.fn().mockResolvedValue([]),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('D14a: callThalamusLLM 转发到 callLLM("thalamus", ...)', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: '{"action":"none"}',
      model: 'MiniMax-M2.1',
      provider: 'minimax',
      elapsed_ms: 50,
    });

    const mod = await import('../thalamus.js');
    callThalamusLLM = mod.callThalamusLLM;

    const result = await callThalamusLLM('test prompt');
    expect(result.text).toContain('none');
    expect(result.model).toBe('MiniMax-M2.1');

    // 验证 callLLM 被正确调用
    expect(mockCallLLM).toHaveBeenCalledWith('thalamus', 'test prompt');
  });

  it('D14b: callThalamLLM legacy shim 转发到 callLLM("thalamus", ...)', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: '{"action":"none"}',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      elapsed_ms: 50,
    });

    const mod = await import('../thalamus.js');
    const { callThalamLLM } = mod;

    const result = await callThalamLLM('test prompt', { timeoutMs: 60000 });
    expect(result.text).toContain('none');

    // 验证 callLLM 被调用时传入了 timeout 参数
    expect(mockCallLLM).toHaveBeenCalledWith('thalamus', 'test prompt', { timeout: 60000 });
  });
});

// ============================================================
// D15: cortex callCortexLLM profile-aware
// ============================================================

describe('cortex profile-aware model', () => {
  let callCortexLLM;
  let mockCallLLM;

  beforeEach(async () => {
    vi.resetModules();

    // callCortexLLM 内部调用 callLLM('cortex', prompt, { timeout: 90000, maxTokens: 4096 })
    mockCallLLM = vi.fn();
    vi.doMock('../llm-caller.js', () => ({
      callLLM: mockCallLLM,
    }));

    // Mock DB
    vi.doMock('../db.js', () => ({ default: { query: vi.fn() } }));

    // Mock thalamus deps (cortex imports from thalamus)
    vi.doMock('../learning.js', () => ({
      getRecentLearnings: vi.fn().mockResolvedValue([]),
      searchRelevantLearnings: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../memory-retriever.js', () => ({
      buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
    }));
    vi.doMock('../cortex-quality.js', () => ({
      evaluateQualityInitial: vi.fn().mockResolvedValue(null),
      generateSimilarityHash: vi.fn().mockReturnValue('hash'),
      checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: true }),
    }));
    vi.doMock('../policy-validator.js', () => ({
      validatePolicyJson: vi.fn().mockReturnValue({ valid: true, normalized: {} }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('D15a: callCortexLLM 转发到 callLLM("cortex", ...) 并返回 text', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: 'deep analysis result',
      model: 'claude-opus-4-20250514',
      provider: 'anthropic',
      elapsed_ms: 1000,
    });

    const mod = await import('../cortex.js');
    callCortexLLM = mod.callCortexLLM;

    const result = await callCortexLLM('analyze this');
    expect(result).toContain('deep analysis result');

    // 验证 callLLM 被正确调用
    expect(mockCallLLM).toHaveBeenCalledWith('cortex', 'analyze this', { timeout: 90000, maxTokens: 4096 });
  });

  it('D15b: callCortexLLM 传递不同 prompt 内容', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: 'sonnet analysis',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      elapsed_ms: 500,
    });

    const mod = await import('../cortex.js');
    callCortexLLM = mod.callCortexLLM;

    const result = await callCortexLLM('analyze this differently');
    expect(result).toContain('sonnet analysis');

    expect(mockCallLLM).toHaveBeenCalledWith('cortex', 'analyze this differently', { timeout: 90000, maxTokens: 4096 });
  });
});
