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

  // 2026-08-19 生产（run 4c867fb4）：account1 七天额度 100%，但没有任何 capped/authFailed
  // 标记——因为标记只在**真收到 429 回调后**才由 markAuthFailure 打上。于是
  // needsFallback=false，中间件直接放行 explicit=account1，每个角色都必须先撞一次
  // 429、失败、再重派才切到 account2：proposer/generator/evaluator/judge 各浪费一轮，
  // 而 publisher 撞上后租约直接过期 → infrastructure_blocked → 整跑落人审。
  // 结论：**光看标记不够，必须看账号当前是否真的还能用**。
  it('rotates away from an explicit account whose quota is already exhausted', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    const deps = makeDeps({ isAccountUsable: (id) => id !== 'account1' });
    await resolveAccount(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
  });

  it('keeps an explicit account that is still usable', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    const deps = makeDeps({ isAccountUsable: () => true });
    await resolveAccount(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
  });

  it('keeps explicit account when usability probe is unavailable (fail-open, 不改变既有行为)', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' } };
    const deps = makeDeps();           // 不提供 isAccountUsable
    await resolveAccount(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
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

  it('harness_initiative 任务不传 minSessionHours（OAuth 自动刷新）', async () => {
    let capturedOpts;
    const deps = makeDeps({
      selectBestAccount: async (o) => { capturedOpts = o; return { accountId: 'account2', model: 'sonnet', modelId: 'claude-sonnet-4-5' }; },
    });
    const opts = { env: {}, task: { task_type: 'harness_initiative' } };
    await resolveAccount(opts, { deps });
    expect(capturedOpts.minSessionHours).toBeUndefined();
  });
});
