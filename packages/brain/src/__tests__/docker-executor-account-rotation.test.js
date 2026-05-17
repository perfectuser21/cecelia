/**
 * docker-executor-account-rotation.test.js — 验证 executeInDocker 入口的账号轮换 middleware
 *
 * 覆盖：
 *  1. 未传 CECELIA_CREDENTIALS → 动态选账号 + 注入 CECELIA_MODEL
 *  2. 传了账号但 spending-capped → fallback 到 selectBestAccount
 *  3. 传了账号但 auth-failed → fallback 到 selectBestAccount
 *  4. 传了账号且可用 → 尊重显式指定，不改
 *  5. CLAUDE_MODEL_OVERRIDE 已在 → 不覆盖 CECELIA_MODEL
 *  6. selectBestAccount 返回 null → 保留 caller 的 env（不破坏）
 *  7. middleware 内部 throw → caller env 保留 + warn（不 propagate）
 */

import { describe, it, expect, vi } from 'vitest';

// Mock pool — executeInDocker 间接依赖
const mockPool = vi.hoisted(() => ({ query: vi.fn().mockResolvedValue({ rowCount: 1 }) }));
vi.mock('../db.js', () => ({ default: mockPool }));

const { resolveAccountForOpts } = await import('../docker-executor.js');

function makeDeps({ capped = [], authFailed = [], selection = { accountId: 'account2', model: 'sonnet', modelId: 'claude-sonnet-4-6' } } = {}) {
  return {
    isSpendingCapped: vi.fn((id) => capped.includes(id)),
    isAuthFailed: vi.fn((id) => authFailed.includes(id)),
    selectBestAccount: vi.fn(async () => selection),
  };
}

describe('resolveAccountForOpts — middleware', () => {
  it('未传 CECELIA_CREDENTIALS → 动态选 + 注入 CECELIA_MODEL', async () => {
    const opts = { env: {}, task: { id: 't1' } };
    const deps = makeDeps();
    await resolveAccountForOpts(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
    expect(opts.env.CECELIA_MODEL).toBe('claude-sonnet-4-6');
    expect(deps.selectBestAccount).toHaveBeenCalledTimes(1);
  });

  it('传了账号但 spending-capped → fallback 到新账号', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' }, task: { id: 't2' } };
    const deps = makeDeps({ capped: ['account1'] });
    await resolveAccountForOpts(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
    expect(deps.selectBestAccount).toHaveBeenCalledTimes(1);
  });

  it('传了账号但 auth-failed → fallback 到新账号', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' }, task: { id: 't3' } };
    const deps = makeDeps({ authFailed: ['account1'] });
    await resolveAccountForOpts(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
    expect(deps.selectBestAccount).toHaveBeenCalledTimes(1);
  });

  it('传了账号且可用 → 尊重显式指定', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account3' }, task: { id: 't4' } };
    const deps = makeDeps();
    await resolveAccountForOpts(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account3');
    expect(deps.selectBestAccount).not.toHaveBeenCalled();
  });

  it('CLAUDE_MODEL_OVERRIDE 已在 → 不覆盖 CECELIA_MODEL', async () => {
    const opts = { env: { CLAUDE_MODEL_OVERRIDE: 'haiku' }, task: { id: 't5' } };
    const deps = makeDeps();
    await resolveAccountForOpts(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account2');
    expect(opts.env.CECELIA_MODEL).toBeUndefined();
  });

  it('selectBestAccount 返回 null（全账号不可用）→ 不改 env', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' }, task: { id: 't6' } };
    const deps = makeDeps({ capped: ['account1'], selection: null });
    await resolveAccountForOpts(opts, { deps });
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1'); // 保留
  });

  it('middleware throw → caller env 保留 + warn（不 propagate）', async () => {
    const opts = { env: { CECELIA_CREDENTIALS: 'account1' }, task: { id: 't7' } };
    const deps = {
      isSpendingCapped: vi.fn(() => { throw new Error('db down'); }),
      isAuthFailed: vi.fn(() => false),
      selectBestAccount: vi.fn(),
    };
    await expect(resolveAccountForOpts(opts, { deps })).resolves.toBeUndefined();
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
  });
});
