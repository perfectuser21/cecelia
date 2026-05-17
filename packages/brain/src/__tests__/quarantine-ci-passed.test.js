/**
 * quarantine.hasActivePr — pr_status='ci_passed' 也算活跃信号
 *
 * 背景：shepherd 写入 pr_status='ci_passed' 后等 reload PR state；
 * handleTaskFailure 第 3 道守卫如果不识别 'ci_passed'，failure_count 累积
 * 可能误判 quarantine → quarantined→queued 死循环（PR 已开但被拉黑）。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

let hasActivePr;
let pool;

beforeAll(async () => {
  const mod = await import('../quarantine.js');
  hasActivePr = mod.hasActivePr;
  pool = (await import('../db.js')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hasActivePr 白名单含 ci_passed', () => {
  it('返回 true：pr_url 存在且 pr_status=ci_passed', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'ci_passed' }],
    });
    expect(await hasActivePr('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true);
  });

  it('返回 true：pr_status=open 仍兼容', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/2', pr_status: 'open' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 true：pr_status=ci_pending 仍兼容', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/3', pr_status: 'ci_pending' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 true：pr_status=merged 仍兼容', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/4', pr_status: 'merged' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 false：pr_status=closed', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/5', pr_status: 'closed' }],
    });
    expect(await hasActivePr('aaaa')).toBe(false);
  });

  it('返回 false：pr_status=ci_failed', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/6', pr_status: 'ci_failed' }],
    });
    expect(await hasActivePr('aaaa')).toBe(false);
  });
});
