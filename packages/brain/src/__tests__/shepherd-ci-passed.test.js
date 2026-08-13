/**
 * shepherd.js ci_passed 状态机修复测试
 *
 * 覆盖：
 *  A) shepherdOpenPRs 主 SELECT WHERE 包含 'ci_passed'
 *  B) ci_passed + MERGEABLE 分支：executeMerge 后 reload PR state，
 *     state==='MERGED' 时同时 UPDATE status='completed' + completed_at + pr_status='merged'
 *
 * 注：新实现拆为两次 execSync 调用（state+mergeable / statusCheckRollup），MERGED 早返回。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  quarantineTask: vi.fn().mockResolvedValue({ success: true }),
}));

import { spawnSync } from 'child_process';
import { shepherdOpenPRs } from '../shepherd.js';

describe('shepherdOpenPRs 主 SELECT WHERE', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
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

describe('ci_passed + MERGEABLE 分支：merge 后推进 status=completed', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
  });

  it('executeMerge 后 reload state=MERGED → UPDATE status=completed + pr_status=merged', async () => {
    vi.mocked(spawnSync)
      // checkPrStatus call 1: state+mergeable → OPEN
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE' }), stderr: '' })
      // checkPrStatus call 2: statusCheckRollup → CI 通过
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] }), stderr: '' })
      // executeMerge（gh pr merge --squash）
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      // reload checkPrStatus call 1: state=MERGED（早返回）
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN' }), stderr: '' });

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

    expect(result.merged).toBeGreaterThanOrEqual(1);
    // 应当出现一条 UPDATE 同时含 status='completed' + pr_status='merged'
    const completedUpdate = updates.find(u =>
      /UPDATE\s+tasks/i.test(u.sql) &&
      /status\s*=\s*'completed'/i.test(u.sql) &&
      /pr_status\s*=\s*'merged'/i.test(u.sql)
    );
    expect(completedUpdate).toBeDefined();
  });

  it('executeMerge 后 reload 仍 OPEN → 仅 UPDATE pr_status=ci_passed', async () => {
    vi.mocked(spawnSync)
      // checkPrStatus call 1: state+mergeable → OPEN
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE' }), stderr: '' })
      // checkPrStatus call 2: statusCheckRollup → CI 通过
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] }), stderr: '' })
      // executeMerge OK
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      // reload checkPrStatus call 1: 还没 merged（OPEN，不早返回）
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE' }), stderr: '' })
      // reload checkPrStatus call 2: statusCheckRollup
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] }), stderr: '' });

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
  });
});
