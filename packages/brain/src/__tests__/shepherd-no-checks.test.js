/**
 * shepherd.checkPrStatus — 无 CI check 的 PR 分类修复
 *
 * Bug：PR 没有任何 CI check（statusCheckRollup=[]）时，旧逻辑判 ci_pending，
 * 导致 harness poll_ci 永远 pending → 30min 超时 → merge 永不执行 → Final E2E FAIL。
 * 修复：0 check 返回独立状态 ci_no_checks，区别于"check 还在跑"的 ci_pending。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

import { execSync } from 'child_process';
import { checkPrStatus } from '../shepherd.js';

describe('checkPrStatus — 无 CI check 分类', () => {
  beforeEach(() => vi.mocked(execSync).mockReset());

  it('0 check + OPEN + MERGEABLE → ci_no_checks（不是 ci_pending）', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [],
    }));
    const r = checkPrStatus('https://github.com/x/y/pull/1');
    expect(r.ciStatus).toBe('ci_no_checks');
    expect(r.mergeable).toBe('MERGEABLE');
  });

  it('有 pending check → 仍 ci_pending（不受影响）', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      state: 'OPEN', mergeable: 'MERGEABLE',
      statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null, name: 'ci' }],
    }));
    expect(checkPrStatus('u').ciStatus).toBe('ci_pending');
  });

  it('有 check 全通过 → ci_passed（不受影响）', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      state: 'OPEN', mergeable: 'MERGEABLE',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS', name: 'ci' }],
    }));
    expect(checkPrStatus('u').ciStatus).toBe('ci_passed');
  });

  it('有 check 失败 → ci_failed（不受影响）', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      state: 'OPEN', mergeable: 'MERGEABLE',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE', name: 'ci' }],
    }));
    expect(checkPrStatus('u').ciStatus).toBe('ci_failed');
  });
});
