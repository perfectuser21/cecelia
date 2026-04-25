/**
 * shepherd.js ci_passed 状态机修复测试
 *
 * 覆盖：
 *  A) shepherdOpenPRs 主 SELECT WHERE 包含 'ci_passed'
 *  B) ci_passed + MERGEABLE 分支：executeMerge 后 reload PR state，
 *     state==='MERGED' 时同时 UPDATE status='completed' + completed_at + pr_status='merged'
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

describe('ci_passed + MERGEABLE 分支：merge 后推进 status=completed', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('executeMerge 后 reload state=MERGED → UPDATE status=completed + pr_status=merged', async () => {
    // 第一次 checkPrStatus（gh pr view）：CI 通过 + MERGEABLE
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
    }));
    // executeMerge（gh pr merge --squash）：成功（无 stdout 解析）
    vi.mocked(execSync).mockReturnValueOnce('');
    // 第二次 checkPrStatus（reload）：state=MERGED
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'MERGED',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
    }));

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
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
    }));
    vi.mocked(execSync).mockReturnValueOnce(''); // executeMerge OK
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'OPEN', // 还没 merged（async sync 中）
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
    }));

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
