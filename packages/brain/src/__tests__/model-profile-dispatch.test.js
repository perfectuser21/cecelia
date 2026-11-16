// 现役 cortex 调用统一LLM入口的超时与返回协议。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('cortex profile-aware model', () => {
  let callCortexLLM;
  let mockCallLLM;

  beforeEach(async () => {
    vi.resetModules();

    // callCortexLLM 内部调用 callLLM('cortex', prompt, { timeout: 300000, maxTokens: 4096 })
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

  it('D15a: callCortexLLM 转发到 callLLM("cortex", ...) 并返回 { text, timing }', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: 'deep analysis result',
      model: 'claude-opus-4-20250514',
      provider: 'anthropic',
      elapsed_ms: 1000,
    });

    const mod = await import('../cortex.js');
    callCortexLLM = mod.callCortexLLM;

    const result = await callCortexLLM('analyze this');
    expect(result.text).toContain('deep analysis result');
    expect(result.timing).toBeDefined();
    expect(result.timing.timed_out).toBe(false);

    // 验证 callLLM 被正确调用
    expect(mockCallLLM).toHaveBeenCalledWith('cortex', 'analyze this', { timeout: 300000, maxTokens: 4096 });
  });

});
