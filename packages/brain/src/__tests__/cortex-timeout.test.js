/**
 * Tests for callCortexLLM timeout parameter injection
 *
 * 验证 CECELIA_CORTEX_TIMEOUT_MS 专属超时优先级：
 *   1. CECELIA_CORTEX_TIMEOUT_MS（专属，最高优先）
 *   2. CECELIA_BRIDGE_TIMEOUT_MS（向下兼容 fallback）
 *   3. 300000（5 分钟默认值）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks（vi.mock 会被 hoist，需用 vi.hoisted 定义跨 mock 引用的变量）──────────

const { mockCallLLM } = vi.hoisted(() => ({
  mockCallLLM: vi.fn().mockResolvedValue({ text: '{"action":"no_action","reasoning":"ok"}' })
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

import { callCortexLLM } from '../cortex.js';

vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([])
}));

vi.mock('../self-model.js', () => ({
  getSelfModel: vi.fn().mockResolvedValue({})
}));

vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn().mockResolvedValue('')
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('callCortexLLM - 超时参数注入', () => {
  let originalCortexTimeout;
  let originalBridgeTimeout;

  beforeEach(() => {
    originalCortexTimeout = process.env.CECELIA_CORTEX_TIMEOUT_MS;
    originalBridgeTimeout = process.env.CECELIA_BRIDGE_TIMEOUT_MS;
    vi.clearAllMocks();
    mockCallLLM.mockResolvedValue({ text: '{"action":"no_action","reasoning":"ok"}' });
  });

  afterEach(() => {
    if (originalCortexTimeout === undefined) {
      delete process.env.CECELIA_CORTEX_TIMEOUT_MS;
    } else {
      process.env.CECELIA_CORTEX_TIMEOUT_MS = originalCortexTimeout;
    }
    if (originalBridgeTimeout === undefined) {
      delete process.env.CECELIA_BRIDGE_TIMEOUT_MS;
    } else {
      process.env.CECELIA_BRIDGE_TIMEOUT_MS = originalBridgeTimeout;
    }
  });

  it('默认使用 300000ms（5 分钟）', async () => {
    delete process.env.CECELIA_CORTEX_TIMEOUT_MS;
    delete process.env.CECELIA_BRIDGE_TIMEOUT_MS;

    await callCortexLLM('test prompt').catch(() => {});

    expect(mockCallLLM).toHaveBeenCalledWith(
      'cortex',
      'test prompt',
      expect.objectContaining({ timeout: 300000 })
    );
  });

  it('CECELIA_CORTEX_TIMEOUT_MS 优先于默认值', async () => {
    process.env.CECELIA_CORTEX_TIMEOUT_MS = '240000';
    delete process.env.CECELIA_BRIDGE_TIMEOUT_MS;

    await callCortexLLM('test prompt').catch(() => {});

    expect(mockCallLLM).toHaveBeenCalledWith(
      'cortex',
      'test prompt',
      expect.objectContaining({ timeout: 240000 })
    );
  });

  it('CECELIA_CORTEX_TIMEOUT_MS 优先于 CECELIA_BRIDGE_TIMEOUT_MS', async () => {
    process.env.CECELIA_CORTEX_TIMEOUT_MS = '240000';
    process.env.CECELIA_BRIDGE_TIMEOUT_MS = '120000';

    await callCortexLLM('test prompt').catch(() => {});

    expect(mockCallLLM).toHaveBeenCalledWith(
      'cortex',
      'test prompt',
      expect.objectContaining({ timeout: 240000 })
    );
  });

  it('CECELIA_BRIDGE_TIMEOUT_MS fallback（无 CECELIA_CORTEX_TIMEOUT_MS）', async () => {
    delete process.env.CECELIA_CORTEX_TIMEOUT_MS;
    process.env.CECELIA_BRIDGE_TIMEOUT_MS = '90000';

    await callCortexLLM('test prompt').catch(() => {});

    expect(mockCallLLM).toHaveBeenCalledWith(
      'cortex',
      'test prompt',
      expect.objectContaining({ timeout: 90000 })
    );
  });
});
