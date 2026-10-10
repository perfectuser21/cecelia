vi.mock('child_process', async original => ({ ...await original(), spawn: vi.fn(() => { throw new Error('测试禁止启动真实模型进程'); }) }));
// 本文件显式模拟模型网络与凭据，独立测试 provider 行为；真实隔离由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
/**
 * llm-caller — Claude 通道退役后不再有 bridge exit-1 熔断（任务 76a160b3）
 * 原 exit-1 熔断前 token 探测 gate（valid/auth_failed/unknown）已随 Claude 通道退役删除（任务 76a160b3）。
 * 新行为：provider=anthropic 不发桥接请求、不探测 token、不 markAuthFailure，错误为 claude_channel_retired。
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

let callLLM, _resetAnthropicBalanceAlerted;

describe('llm-caller — Claude 通道退役：不再有 exit-1 熔断 / token 探测', () => {
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
    _resetAnthropicBalanceAlerted = mod._resetAnthropicBalanceAlerted;
    _resetAnthropicBalanceAlerted();
  });
  afterEach(() => { global.fetch = origFetch; });

  for (const tokenState of ['valid', 'auth_failed', 'unknown']) {
    it(`token 探测=${tokenState} 场景：provider=anthropic 抛 claude_channel_retired，不探测 token、不 markAuthFailure、不 fetch 桥接`, async () => {
      mockVerifyToken.mockResolvedValue(tokenState);
      await expect(
        callLLM('cortex', '测试', { provider: 'anthropic', model: 'claude-sonnet-4-6' })
      ).rejects.toMatchObject({ code: 'claude_channel_retired' });
      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(mockMarkAuthFailure).not.toHaveBeenCalled();
      expect(mockSelectBestAccount).not.toHaveBeenCalled();
      const bridgeCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('/llm-call'));
      expect(bridgeCalls).toHaveLength(0);
    });
  }
});
