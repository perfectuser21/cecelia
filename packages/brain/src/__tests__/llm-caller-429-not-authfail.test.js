/**
 * llm-caller — bridge exit-1 熔断前 token 探测 gate
 * exit-1 达阈值后：token valid→不熔断 / auth_failed→熔断 / unknown→不熔断（保守）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockMarkAuthFailure = vi.hoisted(() => vi.fn());
const mockSelectBestAccount = vi.hoisted(() => vi.fn());
const mockVerifyToken = vi.hoisted(() => vi.fn());

vi.mock('../account-usage.js', () => ({
  selectBestAccount: mockSelectBestAccount,
  markAuthFailure: mockMarkAuthFailure,
  verifyAccountTokenLive: mockVerifyToken,
}));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(() => ({
    config: { cortex: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  })),
}));
vi.mock('../langfuse-reporter.js', () => ({ reportCall: vi.fn().mockResolvedValue(undefined) }));
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => { throw new Error('File not found'); }),
}));

function makeBridgeExit1Response() {
  return { ok: false, status: 500, text: async () => JSON.stringify({ ok: false, error: 'exit code 1', elapsed_ms: 1200 }) };
}

let callLLM, _resetBridgeCircuitState;

describe('llm-caller — exit-1 熔断前 token 探测 gate', () => {
  let origFetch;
  beforeEach(async () => {
    origFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(makeBridgeExit1Response());
    mockMarkAuthFailure.mockClear();
    mockVerifyToken.mockReset();
    mockSelectBestAccount.mockReset();
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account1', model: 'sonnet' });
    const mod = await import('../llm-caller.js');
    callLLM = mod.callLLM;
    _resetBridgeCircuitState = mod._resetBridgeCircuitState;
    _resetBridgeCircuitState();
  });
  afterEach(() => { global.fetch = origFetch; });

  it('exit-1 达阈值 + token 探测 valid → 不 markAuthFailure（限流不误熔断）', async () => {
    mockVerifyToken.mockResolvedValue('valid');
    await expect(
      callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
    ).rejects.toThrow();
    expect(mockMarkAuthFailure).not.toHaveBeenCalled();
  });

  it('exit-1 达阈值 + token 探测 auth_failed → markAuthFailure', async () => {
    mockVerifyToken.mockResolvedValue('auth_failed');
    await expect(
      callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
    ).rejects.toThrow();
    expect(mockMarkAuthFailure).toHaveBeenCalled();
    expect(mockMarkAuthFailure.mock.calls[0][0]).toBe('account1');
    expect(mockMarkAuthFailure.mock.calls[0][2]).toBe('api_error');
  });

  it('exit-1 达阈值 + token 探测 unknown → 不 markAuthFailure（保守）', async () => {
    mockVerifyToken.mockResolvedValue('unknown');
    await expect(
      callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
    ).rejects.toThrow();
    expect(mockMarkAuthFailure).not.toHaveBeenCalled();
  });
});
