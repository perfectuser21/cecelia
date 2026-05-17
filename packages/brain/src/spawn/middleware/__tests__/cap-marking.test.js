import { describe, it, expect } from 'vitest';
import { checkCap } from '../cap-marking.js';

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
