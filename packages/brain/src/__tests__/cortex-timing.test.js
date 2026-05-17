/**
 * Tests for Cortex LLM timing and token estimation
 *
 * 覆盖：
 * 1. estimateTokens — 字符数 ÷ 4 估算
 * 2. callCortexLLM — 成功时返回 { text, timing } 含 response_ms
 * 3. callCortexLLM — 超时失败时在 err._timing 携带 timed_out=true
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const { mockCallLLM } = vi.hoisted(() => ({
  mockCallLLM: vi.fn().mockResolvedValue({ text: '{"result":"ok"}' })
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('../thalamus.js', () => ({
  ACTION_WHITELIST: {},
  validateDecision: vi.fn(),
  recordLLMError: vi.fn(),
  recordTokenUsage: vi.fn(),
}));

vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));

vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([])
}));

vi.mock('../self-model.js', () => ({
  getSelfModel: vi.fn().mockResolvedValue({})
}));

vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn().mockReturnValue('')
}));

vi.mock('../policy-validator.js', () => ({
  validatePolicyJson: vi.fn().mockReturnValue({ valid: true })
}));

vi.mock('../circuit-breaker.js', () => ({
  recordFailure: vi.fn()
}));

vi.mock('../cortex-quality.js', () => ({
  evaluateQualityInitial: vi.fn().mockResolvedValue({}),
  generateSimilarityHash: vi.fn().mockReturnValue('hash'),
  checkShouldCreateRCA: vi.fn().mockResolvedValue(false),
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
}));

import { estimateTokens, callCortexLLM } from '../cortex.js';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('null/undefined 返回 0', () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('4 字符 → 1 token', () => {
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('5 字符 → 2 tokens（向上取整）', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('100 字符 → 25 tokens', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });

  it('prompt_tokens_est = Math.ceil(length / 4)', () => {
    const text = 'x'.repeat(4001);
    expect(estimateTokens(text)).toBe(1001);
  });
});

describe('callCortexLLM - 成功时返回 timing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLLM.mockResolvedValue({ text: '{"result":"ok"}' });
  });

  it('返回对象含 text 和 timing 字段', async () => {
    const result = await callCortexLLM('hello world');

    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('timing');
  });

  it('timing 含 prompt_tokens_est 正整数', async () => {
    const prompt = 'a'.repeat(40);
    const result = await callCortexLLM(prompt);

    expect(result.timing.prompt_tokens_est).toBe(10); // 40 / 4 = 10
  });

  it('timing 含 response_ms 非负数', async () => {
    const result = await callCortexLLM('test');

    expect(result.timing.response_ms).toBeGreaterThanOrEqual(0);
  });

  it('成功时 timed_out = false', async () => {
    const result = await callCortexLLM('test');

    expect(result.timing.timed_out).toBe(false);
  });

  it('成功时 error_type = null', async () => {
    const result = await callCortexLLM('test');

    expect(result.timing.error_type).toBeNull();
  });
});

describe('callCortexLLM - 失败时 err._timing 携带计时', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('普通错误时 timed_out = false，error_type 非空', async () => {
    const err = new Error('connection refused');
    err.code = 'ECONNREFUSED';
    mockCallLLM.mockRejectedValue(err);

    let caught;
    try {
      await callCortexLLM('test prompt');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(caught._timing).toBeDefined();
    expect(caught._timing.timed_out).toBe(false);
    expect(caught._timing.error_type).toBe('ECONNREFUSED');
    expect(caught._timing.response_ms).toBeGreaterThanOrEqual(0);
    expect(caught._timing.prompt_tokens_est).toBeGreaterThan(0);
  });

  it('超时错误（degraded=true）时 timed_out = true，error_type = timeout', async () => {
    const timeoutErr = new Error('LLM call timed out');
    timeoutErr.degraded = true;
    mockCallLLM.mockRejectedValue(timeoutErr);

    let caught;
    try {
      await callCortexLLM('test prompt');
    } catch (e) {
      caught = e;
    }

    expect(caught._timing.timed_out).toBe(true);
    expect(caught._timing.error_type).toBe('timeout');
  });

  it('消息含 timed out 时 timed_out = true', async () => {
    const err = new Error('request timed out after 300000ms');
    mockCallLLM.mockRejectedValue(err);

    let caught;
    try {
      await callCortexLLM('test prompt');
    } catch (e) {
      caught = e;
    }

    expect(caught._timing.timed_out).toBe(true);
    expect(caught._timing.error_type).toBe('timeout');
  });
});
