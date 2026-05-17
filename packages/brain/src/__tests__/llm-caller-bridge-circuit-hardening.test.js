/**
 * llm-caller.js — bridge 脆弱性熔断硬化测试
 *
 * 覆盖 3 个场景（对应 P0-2 任务 A/B/C）：
 *   1. bridge 连续 3 次 exit-code-1 → markAuthFailure(accountId, 1h, 'api_error')
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

vi.mock('../account-usage.js', () => ({
  selectBestAccount: mockSelectBestAccount,
  markAuthFailure: mockMarkAuthFailure,
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
let _resetBridgeCircuitState;

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

    // 默认让 selectBestAccount 返回 account3（用户报告的挂掉账号）
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account3', model: 'sonnet' });

    // 每个测试前都重置 llm-caller 的模块内 state（bridge 计数 + 告警去重）
    const mod = await import('../llm-caller.js');
    callLLM = mod.callLLM;
    _resetAnthropicKey = mod._resetAnthropicKey;
    _resetBridgeCircuitState = mod._resetBridgeCircuitState;
    _resetAnthropicKey();
    _resetBridgeCircuitState();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Task A：bridge 连续 3 次 exit-code-1 → markAuthFailure
  // ═════════════════════════════════════════════════════════════════════════

  describe('Task A: bridge exit-code-1 熔断', () => {
    it('单次 exit-code-1 不触发 markAuthFailure（仅计数）', async () => {
      // bridge 500 会触发 2 次内部重试（共 3 次），但单次 callLLM → 3 次计数
      // 此测试验证 "单次调用的 3 次重试全是 exit-code-1 → 3 次计数已达阈值 → markAuthFailure"
      // 为测试 "单次不触发"，我们让第一次 bridge 成功但设置计数逻辑
      //
      // 实际：单次 callLLM 可能产生 1~3 次 exit-code-1（取决于内部重试）
      // 我们用 bridge 首次就成功来验证 "未达阈值时不触发 markAuthFailure"
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ text: 'ok' }),
        text: async () => '',
      });

      await callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' });

      expect(mockMarkAuthFailure).not.toHaveBeenCalled();
    });

    it('连续 3 次 bridge exit-code-1 → markAuthFailure(accountId, ~1h, "api_error")', async () => {
      // 让 bridge 500 exit-code-1 持续失败（每次 callLLM 会尝试 3 次：1 初 + 2 重试）
      // 单次 callLLM 就可能触发 3 次 exit-code-1 计数 → 熔断
      global.fetch.mockResolvedValue(makeBridgeExit1Response());

      await expect(
        callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
      ).rejects.toThrow(/Bridge \/llm-call error|exit code 1/);

      // 验证 markAuthFailure 被调用，account 为 account3，source=api_error
      expect(mockMarkAuthFailure).toHaveBeenCalled();
      const call = mockMarkAuthFailure.mock.calls[0];
      expect(call[0]).toBe('account3');
      // 第 2 参数是 resetTime ISO string（约 1h 后）
      const resetTime = new Date(call[1]).getTime();
      const hourFromNow = Date.now() + 60 * 60 * 1000;
      expect(Math.abs(resetTime - hourFromNow)).toBeLessThan(10 * 1000); // ±10s 容差
      // 第 3 参数是 source='api_error'
      expect(call[2]).toBe('api_error');
    });

    it('bridge network timeout（非 exit-code-1）→ 不触发 markAuthFailure（不误伤）', async () => {
      global.fetch.mockRejectedValue(new Error('network timeout'));

      await expect(
        callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
      ).rejects.toThrow();

      expect(mockMarkAuthFailure).not.toHaveBeenCalled();
    });

    it('bridge 500 其他 5xx 错误（非 exit-code-1）→ 不触发 markAuthFailure', async () => {
      // "exit code 137" (OOM) 不应被认为是 exit-code-1
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ ok: false, error: 'exit code 137', elapsed_ms: 5000 }),
      });

      await expect(
        callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
      ).rejects.toThrow();

      expect(mockMarkAuthFailure).not.toHaveBeenCalled();
    });

    it('bridge 500 generic error 文本（非 exit-code-1）→ 不触发 markAuthFailure', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(
        callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
      ).rejects.toThrow();

      expect(mockMarkAuthFailure).not.toHaveBeenCalled();
    });

    it('达到阈值后 _bridgeExit1Counters 被重置（避免重复 markAuthFailure）', async () => {
      global.fetch.mockResolvedValue(makeBridgeExit1Response());

      // 第 1 次 callLLM：3 次 exit-code-1 → markAuthFailure
      await expect(
        callLLM('cortex', '测试1', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
      ).rejects.toThrow();

      const firstCallCount = mockMarkAuthFailure.mock.calls.length;
      expect(firstCallCount).toBeGreaterThanOrEqual(1);

      // 第 2 次 callLLM：又 3 次 exit-code-1 → 再次 markAuthFailure（新一轮计数）
      // 这是预期行为：上次熔断已 reset，下次再连续 3 次才熔断
      await expect(
        callLLM('cortex', '测试2', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
      ).rejects.toThrow();

      // markAuthFailure 被调用了两轮（每次 callLLM 一次）
      expect(mockMarkAuthFailure.mock.calls.length).toBe(firstCallCount * 2);
    });
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

    it('_resetBridgeCircuitState 后可再次 raise（测试隔离）', async () => {
      global.fetch.mockResolvedValue(makeAnthropicBalanceLowResponse());

      await expect(
        callLLM('thalamus', '测试1', { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' })
      ).rejects.toThrow();
      expect(mockRaise).toHaveBeenCalledTimes(1);

      _resetBridgeCircuitState();

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
