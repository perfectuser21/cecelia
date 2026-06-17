import { describe, it, expect } from 'vitest';
import { checkCap, checkAuthFailure } from '../cap-marking.js';

function makeDeps(override = {}) {
  const calls = [];
  return {
    calls,
    deps: { markSpendingCap: (account) => calls.push(account), ...override },
  };
}

describe('checkCap() cap-marking middleware', () => {
  it('returns capped:false when stdout has no cap pattern', async () => {
    const { deps } = makeDeps();
    const r = await checkCap({ stdout: 'all ok', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'a1' } }, { deps });
    expect(r.capped).toBe(false);
  });

  it('returns capped:true and calls markSpendingCap on api_error_status:429', async () => {
    const { calls, deps } = makeDeps();
    const r = await checkCap({ stdout: 'fail api_error_status:429 rate', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'a1' } }, { deps });
    expect(r.capped).toBe(true);
    expect(r.account).toBe('a1');
    expect(calls).toEqual(['a1']);
  });

  it('detects rate_limit_error JSON pattern in stderr', async () => {
    const { calls, deps } = makeDeps();
    const r = await checkCap({ stdout: '', stderr: '{"type":"rate_limit_error"}' }, { env: { CECELIA_CREDENTIALS: 'a2' } }, { deps });
    expect(r.capped).toBe(true);
    expect(calls).toEqual(['a2']);
  });

  it('detects credit balance too low', async () => {
    const { calls, deps } = makeDeps();
    const r = await checkCap({ stdout: 'credit balance is too low', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'a3' } }, { deps });
    expect(r.capped).toBe(true);
    expect(calls).toEqual(['a3']);
  });

  it('returns capped:true but account:null when no CECELIA_CREDENTIALS', async () => {
    const { calls, deps } = makeDeps();
    const r = await checkCap({ stdout: 'api_error_status:429', stderr: '' }, { env: {} }, { deps });
    expect(r.capped).toBe(true);
    expect(r.account).toBeNull();
    expect(calls).toEqual([]);
  });

  it('returns capped:false when result is null/undefined', async () => {
    const { deps } = makeDeps();
    const r = await checkCap(null, { env: { CECELIA_CREDENTIALS: 'a1' } }, { deps });
    expect(r.capped).toBe(false);
  });
});

function makeAuthDeps() {
  const calls = [];
  return {
    calls,
    deps: { markAuthFailure: (...args) => calls.push(args) },
  };
}

describe('checkAuthFailure() — 401 auth 检测（harness 根因2）', () => {
  it('无 auth 特征 → authFailed:false 不标记', async () => {
    const { calls, deps } = makeAuthDeps();
    const r = await checkAuthFailure({ stdout: 'normal failure', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'account1' } }, { deps });
    expect(r.authFailed).toBe(false);
    expect(calls).toEqual([]);
  });

  it('api_error_status:401 → markAuthFailure(account, null, api_error)', async () => {
    const { calls, deps } = makeAuthDeps();
    const r = await checkAuthFailure({ stdout: 'api_error_status: 401', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'account2' } }, { deps });
    expect(r.authFailed).toBe(true);
    expect(r.account).toBe('account2');
    expect(calls).toEqual([['account2', null, 'api_error']]);
  });

  it('"type":"authentication_error" JSON 特征 → 标记', async () => {
    const { calls, deps } = makeAuthDeps();
    const r = await checkAuthFailure({ stdout: '', stderr: '{"type":"error","error":{"type":"authentication_error"}}' }, { env: { CECELIA_CREDENTIALS: 'account3' } }, { deps });
    expect(r.authFailed).toBe(true);
    expect(calls.length).toBe(1);
  });

  it('OAuth token has expired → 标记', async () => {
    const { calls, deps } = makeAuthDeps();
    const r = await checkAuthFailure({ stdout: 'OAuth token has expired. Please obtain a new token', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'account4' } }, { deps });
    expect(r.authFailed).toBe(true);
    expect(calls.length).toBe(1);
  });

  it('claude CLI Not logged in → 标记', async () => {
    const { calls, deps } = makeAuthDeps();
    const r = await checkAuthFailure({ stdout: 'Not logged in · /login', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'account5' } }, { deps });
    expect(r.authFailed).toBe(true);
    expect(calls.length).toBe(1);
  });

  it('命中特征但无 CECELIA_CREDENTIALS → authFailed:true 但不标记', async () => {
    const { calls, deps } = makeAuthDeps();
    const r = await checkAuthFailure({ stdout: 'api_error_status:401', stderr: '' }, { env: {} }, { deps });
    expect(r.authFailed).toBe(true);
    expect(r.account).toBeNull();
    expect(calls).toEqual([]);
  });

  it('429 rate limit 不算 auth 失败（由 checkCap 负责）', async () => {
    const { calls, deps } = makeAuthDeps();
    const r = await checkAuthFailure({ stdout: 'api_error_status:429', stderr: '' }, { env: { CECELIA_CREDENTIALS: 'a1' } }, { deps });
    expect(r.authFailed).toBe(false);
    expect(calls).toEqual([]);
  });
});
