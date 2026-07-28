/**
 * shepherd.js ci_passed 状态机修复测试
 *
 * 覆盖：
 *  A) shepherdOpenPRs 主 SELECT WHERE 包含 'ci_passed'
 *  B) ci_passed + MERGEABLE 分支只记录观察，不拥有 merge authority。
 *
 * 注：新实现拆为两次 execSync 调用（state+mergeable / statusCheckRollup），MERGED 早返回。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  quarantineTask: vi.fn().mockResolvedValue({ success: true }),
}));

import { execSync } from 'child_process';
import { shepherdOpenPRs } from '../shepherd.js';

describe('shepherdOpenPRs 主 SELECT WHERE', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('SELECT WHERE 包含 ci_passed', async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({ rows: [] });
    const pool = { query: queryMock };
    await shepherdOpenPRs(pool);
    const sql = queryMock.mock.calls[0][0];
    expect(sql).toContain("'ci_passed'");
    expect(sql).toContain("'open'");
    expect(sql).toContain("'ci_pending'");
  });
});

describe('ci_passed + MERGEABLE 分支：等待 Kernel merge authorization', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('does not invoke gh pr merge and only records pr_status=ci_passed', async () => {
    vi.mocked(execSync)
      // checkPrStatus call 1: state+mergeable → OPEN
      .mockReturnValueOnce(JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE' }))
      // checkPrStatus call 2: statusCheckRollup → CI 通过
      .mockReturnValueOnce(JSON.stringify({ statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] }))
      ;

    const updates = [];
    const queryMock = vi.fn(async (sql, params) => {
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            id: 'task-1',
            title: 'test',
            pr_url: 'https://github.com/x/y/pull/1',
            pr_status: 'open',
            retry_count: 0,
            payload: {},
          }],
        };
      }
      updates.push({ sql, params });
      return { rowCount: 1 };
    });

    const pool = { query: queryMock };
    const result = await shepherdOpenPRs(pool);

    expect(result.merged).toBe(0);
    expect(execSync.mock.calls.map((call) => call[0]).some((cmd) => cmd.includes('gh pr merge'))).toBe(false);
    expect(updates.some((u) => /pr_status\s*=\s*'ci_passed'/i.test(u.sql))).toBe(true);
    expect(updates.some((u) => /status\s*=\s*'completed'/i.test(u.sql))).toBe(false);
  });

  it('does not reload after CI success because no merge effect was requested', async () => {
    vi.mocked(execSync)
      // checkPrStatus call 1: state+mergeable → OPEN
      .mockReturnValueOnce(JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE' }))
      // checkPrStatus call 2: statusCheckRollup → CI 通过
      .mockReturnValueOnce(JSON.stringify({ statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] }))
      ;

    const updates = [];
    const queryMock = vi.fn(async (sql, params) => {
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            id: 'task-2',
            title: 'test',
            pr_url: 'https://github.com/x/y/pull/2',
            pr_status: 'open',
            retry_count: 0,
            payload: {},
          }],
        };
      }
      updates.push({ sql, params });
      return { rowCount: 1 };
    });

    await shepherdOpenPRs({ query: queryMock });

    const ciPassedUpdate = updates.find(u =>
      /UPDATE\s+tasks/i.test(u.sql) &&
      /pr_status\s*=\s*'ci_passed'/i.test(u.sql)
    );
    expect(ciPassedUpdate).toBeDefined();
    // 不应有 status='completed' 的 UPDATE
    const completedUpdate = updates.find(u => /status\s*=\s*'completed'/i.test(u.sql));
    expect(completedUpdate).toBeUndefined();
    expect(execSync).toHaveBeenCalledTimes(2);
  });
});
