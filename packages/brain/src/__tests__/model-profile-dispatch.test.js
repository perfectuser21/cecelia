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
  let mockGetActiveProfile;

  beforeEach(async () => {
    vi.resetModules();

    mockGetActiveProfile = vi.fn();
    vi.doMock('../model-profile.js', () => ({
      getActiveProfile: mockGetActiveProfile,
    }));

    // Mock DB
    vi.doMock('../db.js', () => ({ default: { query: vi.fn() } }));

    // Mock node:fs (for minimax credentials)
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(() => JSON.stringify({ api_key: 'test-minimax-key' })),
    }));

    // Mock event-bus
    vi.doMock('../event-bus.js', () => ({ emit: vi.fn() }));

    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it('D14a: MiniMax profile → 调用 callThalamLLM (MiniMax API)', async () => {
    mockGetActiveProfile.mockReturnValue({
      config: { thalamus: { provider: 'minimax', model: 'MiniMax-M2.1' } },
    });

    // Mock MiniMax API response (OpenAI compatible format)
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"action":"none"}' } }],
        usage: { total_tokens: 100 },
      }),
    });

    const mod = await import('../thalamus.js');
    callThalamusLLM = mod.callThalamusLLM;

    const result = await callThalamusLLM('test prompt');
    expect(result.text).toContain('none');
    expect(result.model).toBe('MiniMax-M2.1');

    // 验证调用的是 MiniMax API 地址
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('minimax'),
      expect.any(Object)
    );
  });

  it('D14b: Anthropic profile → 调用 callHaiku (Anthropic API)', async () => {
    mockGetActiveProfile.mockReturnValue({
      config: { thalamus: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } },
    });

    // 需要 ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key';

    // Mock Anthropic API response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: '{"action":"none"}' }],
        usage: { input_tokens: 50, output_tokens: 50 },
      }),
    });

    const mod = await import('../thalamus.js');
    callThalamusLLM = mod.callThalamusLLM;

    const result = await callThalamusLLM('test prompt');
    expect(result.text).toContain('none');
    expect(result.model).toBe('claude-haiku-4-5-20251001');

    // 验证调用的是 Anthropic API 地址
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('anthropic.com'),
      expect.any(Object)
    );

    delete process.env.ANTHROPIC_API_KEY;
  });
});

// ============================================================
// D15: cortex callCortexLLM profile-aware
// ============================================================

describe('cortex profile-aware model', () => {
  let callCortexLLM;
  let mockGetActiveProfile;

  beforeEach(async () => {
    vi.resetModules();

    mockGetActiveProfile = vi.fn();
    vi.doMock('../model-profile.js', () => ({
      getActiveProfile: mockGetActiveProfile,
    }));

    // Mock DB
    vi.doMock('../db.js', () => ({ default: { query: vi.fn() } }));

    // Mock global fetch
    global.fetch = vi.fn();

    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('D15a: profile 指定 opus → 使用 opus', async () => {
    mockGetActiveProfile.mockReturnValue({
      config: { cortex: { provider: 'anthropic', model: 'claude-opus-4-20250514' } },
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: 'deep analysis result' }],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    });

    const mod = await import('../cortex.js');
    callCortexLLM = mod.callCortexLLM;

    const result = await callCortexLLM('analyze this');
    expect(result).toContain('deep analysis result');

    // 验证传了正确的模型
    const fetchBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(fetchBody.model).toBe('claude-opus-4-20250514');
  });

  it('D15b: profile 指定 sonnet → 使用 sonnet', async () => {
    mockGetActiveProfile.mockReturnValue({
      config: { cortex: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' } },
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: 'sonnet analysis' }],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    });

    const mod = await import('../cortex.js');
    callCortexLLM = mod.callCortexLLM;

    const result = await callCortexLLM('analyze this');
    expect(result).toContain('sonnet analysis');

    const fetchBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(fetchBody.model).toBe('claude-sonnet-4-20250514');
  });
});
