/**
 * shepherd.checkPrStatus — 无 CI check 的 PR 分类修复
 *
 * Bug：PR 没有任何 CI check（statusCheckRollup=[]）时，旧逻辑判 ci_pending，
 * 导致 harness poll_ci 永远 pending → 30min 超时 → merge 永不执行 → Final E2E FAIL。
 * 修复：0 check 返回独立状态 ci_no_checks，区别于"check 还在跑"的 ci_pending。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

import { spawnSync } from 'child_process';
import { checkPrStatus } from '../shepherd.js';

describe('checkPrStatus — 无 CI check 分类', () => {
  beforeEach(() => vi.mocked(spawnSync).mockReset());

  it('0 check + OPEN + MERGEABLE → ci_no_checks（不是 ci_pending）', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: JSON.stringify({
      state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [],
    }), stderr: '' });
    const r = checkPrStatus('https://github.com/x/y/pull/1');
    expect(r.ciStatus).toBe('ci_no_checks');
    expect(r.mergeable).toBe('MERGEABLE');
  });

  it('有 pending check → 仍 ci_pending（不受影响）', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: JSON.stringify({
      state: 'OPEN', mergeable: 'MERGEABLE',
      statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null, name: 'ci' }],
    }), stderr: '' });
    expect(checkPrStatus('https://github.com/x/y/pull/2').ciStatus).toBe('ci_pending');
  });

  it('有 check 全通过 → ci_passed（不受影响）', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: JSON.stringify({
      state: 'OPEN', mergeable: 'MERGEABLE',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS', name: 'ci' }],
    }), stderr: '' });
    expect(checkPrStatus('https://github.com/x/y/pull/3').ciStatus).toBe('ci_passed');
  });

  it('有 check 失败 → ci_failed（不受影响）', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: JSON.stringify({
      state: 'OPEN', mergeable: 'MERGEABLE',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE', name: 'ci' }],
    }), stderr: '' });
    expect(checkPrStatus('https://github.com/x/y/pull/4').ciStatus).toBe('ci_failed');
  });
});
