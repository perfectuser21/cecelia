/**
 * account-rotation middleware 单测。
 * 覆盖：显式 happy / capped fallback / auth-failed fallback / 自动选择 /
 *       CLAUDE_MODEL_OVERRIDE 尊重 / deps 抛错降级 / log 输出。
 */
import { describe, it, expect } from 'vitest';
import { resolveAccount } from '../account-rotation.js';

function makeDeps(overrides = {}) {
  return {
    isSpendingCapped: () => false,
    isAuthFailed: () => false,
    selectBestAccount: async () => ({ accountId: 'account2', model: 'sonnet', modelId: 'claude-sonnet-4-5' }),
    ...overrides,
  };
}

describe('resolveAccount() account-rotation middleware', () => {
  it('respects explicit account when not capped/auth-failed', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    await resolveAccount(opts, { deps: makeDeps() });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
  });

  it('rotates away from capped explicit account', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    const deps = makeDeps({ isSpendingCapped: (id) => id === 'account1' });
    await resolveAccount(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
  });

  it('rotates away from auth-failed explicit account', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    const deps = makeDeps({ isAuthFailed: (id) => id === 'account1' });
    await resolveAccount(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
  });

  it('selects best account when none explicit', async () => {
    const opts = { env: {} };
    await resolveAccount(opts, { deps: makeDeps() });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
    expect(opts.env.CECELIA_MODEL).toBe('claude-sonnet-4-5');
  });

  it('does not override CLAUDE_MODEL_OVERRIDE', async () => {
    const opts = { env: { CLAUDE_MODEL_OVERRIDE: 'opus' } };
    await resolveAccount(opts, { deps: makeDeps() });
    expect(opts.env.CLAUDE_MODEL_OVERRIDE).toBe('opus');
    expect(opts.env.CECELIA_MODEL).toBeUndefined();
  });

  it('keeps caller env when deps throw', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    const deps = makeDeps({ selectBestAccount: async () => { throw new Error('boom'); } });
    await resolveAccount(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
  });

  it('logs rotation when explicit → selected are different', async () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
      const deps = makeDeps({ isSpendingCapped: (id) => id === 'account1' });
      await resolveAccount(opts, { deps, taskId: 't42' });
      expect(logs.some(l => l.includes('[account-rotation] rotate:') && l.includes('t42'))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });
});
