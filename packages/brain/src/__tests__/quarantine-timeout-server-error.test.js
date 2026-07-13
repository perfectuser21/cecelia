import { describe, it, expect, beforeAll, vi } from 'vitest';

let classifyFailure, getRetryStrategy, FAILURE_CLASS;

beforeAll(async () => {
  vi.resetModules();
  ({ classifyFailure, getRetryStrategy, FAILURE_CLASS } = await import('../quarantine.js'));
});

describe('quarantine TIMEOUT/SERVER_ERROR 拆分（协议卫生包）', () => {
  it('新 FAILURE_CLASS 常量存在', () => {
    expect(FAILURE_CLASS.TIMEOUT).toBe('timeout');
    expect(FAILURE_CLASS.SERVER_ERROR).toBe('server_error');
  });

  it('5xx / internal server error / bad gateway → server_error（不再是 network）', () => {
    expect(classifyFailure('502 error from upstream').class).toBe('server_error');
    expect(classifyFailure('Internal Server Error').class).toBe('server_error');
    expect(classifyFailure('bad gateway').class).toBe('server_error');
    expect(classifyFailure('service unavailable').class).toBe('server_error');
  });

  it('ETIMEDOUT / timed out → timeout（不再是 network）', () => {
    expect(classifyFailure('connect ETIMEDOUT 1.2.3.4:443').class).toBe('timeout');
    expect(classifyFailure('request timed out after 30000ms').class).toBe('timeout');
  });

  it('ECONNREFUSED / socket hang up 仍是 network（回归）', () => {
    expect(classifyFailure('ECONNREFUSED: Connection refused').class).toBe('network');
    expect(classifyFailure('socket hang up').class).toBe('network');
  });

  it('429 仍是 rate_limit（回归：分类顺序 rate_limit 优先）', () => {
    expect(classifyFailure('429 too many requests').class).toBe('rate_limit');
  });

  it('getRetryStrategy timeout：3/6/12min 退避，返回结构不变', () => {
    const s0 = getRetryStrategy('timeout', { retryCount: 0 });
    expect(s0.should_retry).toBe(true);
    expect(new Date(s0.next_run_at).getTime() - Date.now()).toBeGreaterThan(2.9 * 60_000);
    expect(new Date(s0.next_run_at).getTime() - Date.now()).toBeLessThan(3.1 * 60_000);
    const s2 = getRetryStrategy('timeout', { retryCount: 2 });
    expect(new Date(s2.next_run_at).getTime() - Date.now()).toBeGreaterThan(11.9 * 60_000);
  });

  it('getRetryStrategy server_error：1/5/15min 退避', () => {
    const s0 = getRetryStrategy('server_error', { retryCount: 0 });
    expect(s0.should_retry).toBe(true);
    expect(new Date(s0.next_run_at).getTime() - Date.now()).toBeLessThan(1.1 * 60_000);
  });

  it('getRetryStrategy 耗尽（retryCount=3）→ needs_human_review（timeout/server_error 同 network 语义）', () => {
    for (const cls of ['timeout', 'server_error']) {
      const s = getRetryStrategy(cls, { retryCount: 3 });
      expect(s.should_retry).toBe(false);
      expect(s.needs_human_review).toBe(true);
    }
  });

  it('getRetryStrategy rate_limit/network 行为回归不变', () => {
    const rl = getRetryStrategy('rate_limit', { retryCount: 0 });
    expect(new Date(rl.next_run_at).getTime() - Date.now()).toBeGreaterThan(1.9 * 60_000);
    const nw = getRetryStrategy('network', { retryCount: 1 });
    expect(new Date(nw.next_run_at).getTime() - Date.now()).toBeGreaterThan(9.9 * 60_000);
  });
});
