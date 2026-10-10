vi.mock('child_process', async original => ({ ...await original(), spawn: vi.fn(() => { throw new Error('测试禁止启动真实模型进程'); }) }));
// 本文件显式模拟模型网络与凭据，独立测试 provider 行为；真实隔离由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
/**
 * llm-caller.js — bridge 脆弱性熔断硬化测试
 *
 * 覆盖 3 个场景（对应 P0-2 任务 A/B/C）：
 *   1. 原「bridge 连续 3 次 exit-code-1 → markAuthFailure」已随 Claude 通道退役删除（任务 76a160b3）；
 *      改为断言 provider=anthropic 不 fetch bridge、不计熔断、不 markAuthFailure
 *   2. Anthropic API 返回 "credit balance is too low" → raise('P1', ...) 一次
 *      （同 runtime 去重，不重复告警）
 *   3. api_error 熔断账号 token 刷新后不会被 proactiveTokenCheck 清除
 *      （Task C 验证已有行为）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks（必须在 import llm-caller 之前 hoist）────────────────────────────
const mockMarkAuthFailure = vi.hoisted(() => vi.fn());
const mockSelectBestAccount = vi.hoisted(() => vi.fn());
const mockRaise = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockVerifyToken = vi.hoisted(() => vi.fn());

vi.mock('../account-usage.js', () => ({
  selectBestAccount: mockSelectBestAccount,
  markAuthFailure: mockMarkAuthFailure,
  verifyAccountTokenLive: mockVerifyToken,
}));

vi.mock('../alerting.js', () => ({
  raise: mockRaise,
}));

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(() => ({
    config: {
      thalamus: {
        provider: 'anthropic-api',
        model: 'claude-haiku-4-5-20251001',
      },
      cortex: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      },
    },
  })),
}));

vi.mock('../langfuse-reporter.js', () => ({
  reportCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn((path) => {
    if (typeof path === 'string' && path.includes('anthropic.json')) {
      return JSON.stringify({ api_key: 'test-anthropic-key' });
    }
    if (typeof path === 'string' && path.includes('minimax.json')) {
      return JSON.stringify({ api_key: 'test-minimax-key' });
    }
    throw new Error('File not found');
  }),
}));

// 动态导入（避免 hoist 顺序问题）
let callLLM;
let _resetAnthropicKey;
let _resetAnthropicBalanceAlerted;

// 辅助：构造 bridge 500 exit-code-1 response
function makeBridgeExit1Response() {
  return {
    ok: false,
    status: 500,
    text: async () => JSON.stringify({ ok: false, error: 'exit code 1', elapsed_ms: 1200 }),
  };
}

// 辅助：构造 Anthropic 400 余额不足 response
function makeAnthropicBalanceLowResponse() {
  return {
    ok: false,
    status: 400,
    text: async () => JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' },
    }),
  };
}

describe('llm-caller — bridge 熔断硬化', () => {
  let originalFetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    mockMarkAuthFailure.mockClear();
    mockSelectBestAccount.mockReset();
    mockRaise.mockClear();
    mockVerifyToken.mockReset();
    mockVerifyToken.mockResolvedValue('auth_failed'); // 保持原"3次exit-1→熔断"预期

    // 默认让 selectBestAccount 返回 account3（用户报告的挂掉账号）
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account3', model: 'sonnet' });

    // 每个测试前都重置 llm-caller 的模块内 state（余额告警去重）
    const mod = await import('../llm-caller.js');
    callLLM = mod.callLLM;
    _resetAnthropicKey = mod._resetAnthropicKey;
    _resetAnthropicBalanceAlerted = mod._resetAnthropicBalanceAlerted;
    _resetAnthropicKey();
    _resetAnthropicBalanceAlerted();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Task A：bridge 连续 3 次 exit-code-1 → markAuthFailure
  // ═════════════════════════════════════════════════════════════════════════

  describe('Task A: Claude 通道退役后不再有 bridge exit-code-1 熔断', () => {
    it('provider=anthropic 下游一律 exit-code-1 → 不 fetch bridge，不 markAuthFailure，抛 claude_channel_retired', async () => {
      global.fetch.mockResolvedValue(makeBridgeExit1Response());

      for (let i = 0; i < 3; i++) {
        await expect(
          callLLM('cortex', `测试${i}`, { provider: 'anthropic', model: 'claude-sonnet-4-6' })
        ).rejects.toMatchObject({ code: 'claude_channel_retired' });
      }

      const urls = global.fetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes('/llm-call'))).toBe(false);
      expect(mockSelectBestAccount).not.toHaveBeenCalled();
      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(mockMarkAuthFailure).not.toHaveBeenCalled();
    });

    it('provider=anthropic 且 anthropic-api 直连成功 → 返回 anthropic-api 结果，不 markAuthFailure', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        text: async () => '',
      });

      const result = await callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' });

      expect(result).toMatchObject({ text: 'ok', provider: 'anthropic-api', attempted_fallback: true });
      expect(global.fetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
      expect(mockMarkAuthFailure).not.toHaveBeenCalled();
    });

    // 原「单次 exit-code-1 仅计数 / network timeout / exit code 137 / generic 500 不误伤 / 达阈值后计数重置」已随 Claude 通道退役删除（任务 76a160b3）
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Task B：Anthropic API credit low → raise 一次
  // ═════════════════════════════════════════════════════════════════════════

  describe('Task B: Anthropic API credit low 告警', () => {
    it('Anthropic API 返回 "credit balance is too low" → raise P1 一次', async () => {
      global.fetch.mockResolvedValueOnce(makeAnthropicBalanceLowResponse());

      await expect(
        callLLM('thalamus', '测试', { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' })
      ).rejects.toThrow(/Anthropic API error: 400/);

      expect(mockRaise).toHaveBeenCalledTimes(1);
      const call = mockRaise.mock.calls[0];
      expect(call[0]).toBe('P1');
      expect(call[1]).toBe('anthropic_api_balance_low');
      expect(call[2]).toContain('Anthropic API 余额');
    });

    it('同一 runtime 连续触发 balance low → 只 raise 一次（去重）', async () => {
      global.fetch.mockResolvedValue(makeAnthropicBalanceLowResponse());

      // 连调 3 次
      for (let i = 0; i < 3; i++) {
        await expect(
          callLLM('thalamus', `测试${i}`, { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' })
        ).rejects.toThrow();
      }

      expect(mockRaise).toHaveBeenCalledTimes(1);
    });

    it('_resetAnthropicBalanceAlerted 后可再次 raise（测试隔离）', async () => {
      global.fetch.mockResolvedValue(makeAnthropicBalanceLowResponse());

      await expect(
        callLLM('thalamus', '测试1', { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' })
      ).rejects.toThrow();
      expect(mockRaise).toHaveBeenCalledTimes(1);

      _resetAnthropicBalanceAlerted();

      await expect(
        callLLM('thalamus', '测试2', { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' })
      ).rejects.toThrow();
      expect(mockRaise).toHaveBeenCalledTimes(2);
    });

    it('识别 "insufficient_balance" 关键字 → 触发告警', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: async () => JSON.stringify({ error: { code: 'insufficient_balance', message: 'out of quota' } }),
      });

      await expect(
        callLLM('thalamus', '测试', { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' })
      ).rejects.toThrow();

      expect(mockRaise).toHaveBeenCalledWith(
        'P1',
        'anthropic_api_balance_low',
        expect.stringContaining('余额')
      );
    });

    it('其他 Anthropic API 错误（429 rate limit）不触发 balance 告警', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate_limit_error: too many requests',
      });

      await expect(
        callLLM('thalamus', '测试', { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' })
      ).rejects.toThrow(/Anthropic API error: 429/);

      expect(mockRaise).not.toHaveBeenCalled();
    });
  });
});

// Task C 的测试（proactiveTokenCheck 保护 api_error 熔断）放在独立文件
// llm-caller-bridge-circuit-hardening-task-c.test.js，避免与 Task A/B 的 mock 互相污染
