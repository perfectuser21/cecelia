/**
 * PR Shepherd 单元测试
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
import { quarantineTask } from '../quarantine.js';
import { checkPrStatus, classifyFailedChecks, shepherdOpenPRs } from '../shepherd.js';

// ===== classifyFailedChecks =====
describe('classifyFailedChecks', () => {
  it('识别 lint 类型', () => {
    expect(classifyFailedChecks(['lint', 'eslint-check'])).toBe('lint');
  });

  it('识别 format 类型', () => {
    expect(classifyFailedChecks(['prettier-format'])).toBe('lint');
  });

  it('识别 test 类型', () => {
    expect(classifyFailedChecks(['vitest', 'coverage-check'])).toBe('test');
  });

  it('识别 version_check 优先级高于 lint', () => {
    expect(classifyFailedChecks(['version-check', 'lint'])).toBe('version_check');
  });

  it('识别 other 类型', () => {
    expect(classifyFailedChecks(['deploy-preview', 'security-scan'])).toBe('other');
  });

  it('空数组返回 other', () => {
    expect(classifyFailedChecks([])).toBe('other');
  });
});

// ===== checkPrStatus =====
describe('checkPrStatus', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('解析 CI 通过且 mergeable 的 PR', () => {
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
    }));
    const result = checkPrStatus('https://github.com/owner/repo/pull/1');
    expect(result.ciStatus).toBe('ci_passed');
    expect(result.allPassed).toBe(true);
  });

  it('解析 CI 失败的 PR', () => {
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'eslint-check', conclusion: 'FAILURE', status: 'COMPLETED' }],
    }));
    const result = checkPrStatus('https://github.com/owner/repo/pull/2');
    expect(result.ciStatus).toBe('ci_failed');
    expect(result.failedChecks).toContain('eslint-check');
  });

  it('解析 CI pending 的 PR', () => {
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: null, status: 'IN_PROGRESS' }],
    }));
    expect(checkPrStatus('https://github.com/owner/repo/pull/3').ciStatus).toBe('ci_pending');
  });

  it('解析已合并的 PR', () => {
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'MERGED', mergeable: 'UNKNOWN', statusCheckRollup: [],
    }));
    expect(checkPrStatus('https://github.com/owner/repo/pull/4').ciStatus).toBe('merged');
  });

  it('解析已关闭的 PR', () => {
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'CLOSED', mergeable: 'UNKNOWN', statusCheckRollup: [],
    }));
    expect(checkPrStatus('https://github.com/owner/repo/pull/5').ciStatus).toBe('closed');
  });

  it('gh CLI 失败时抛出错误', () => {
    vi.mocked(execSync).mockImplementationOnce(() => { throw new Error('gh: not found'); });
    expect(() => checkPrStatus('https://github.com/owner/repo/pull/6')).toThrow(/gh pr view failed/);
  });
});

// ===== shepherdOpenPRs =====
describe('shepherdOpenPRs', () => {
  let mockPool;

  beforeEach(() => {
    vi.mocked(execSync).mockReset();
    vi.mocked(quarantineTask).mockReset().mockResolvedValue({ success: true });
    mockPool = { query: vi.fn() };
  });

  it('S1: 没有 open PR 时直接返回空结果', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const result = await shepherdOpenPRs(mockPool);
    expect(result.processed).toBe(0);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('S2: CI 通过且 mergeable → auto-merge，pr_status=ci_passed', async () => {
    const task = { id: 'task-1', title: 'T1', pr_url: 'https://github.com/o/r/pull/1', pr_status: 'open', retry_count: 0, payload: {} };
    mockPool.query
      .mockResolvedValueOnce({ rows: [task] })
      .mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(execSync)
      .mockReturnValueOnce(JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] }))
      .mockReturnValueOnce('');

    const result = await shepherdOpenPRs(mockPool);
    expect(result.merged).toBe(1);
    expect(mockPool.query.mock.calls[1][0]).toContain("pr_status = 'ci_passed'");
  });

  it('S3: CI 失败 + retry=0 + lint → 重排 queued', async () => {
    const task = { id: 'task-2', title: 'T2', pr_url: 'https://github.com/o/r/pull/2', pr_status: 'open', retry_count: 0, payload: {} };
    mockPool.query
      .mockResolvedValueOnce({ rows: [task] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'eslint-check', conclusion: 'FAILURE', status: 'COMPLETED' }] }));

    const result = await shepherdOpenPRs(mockPool);
    expect(result.failed).toBe(1);
    const requeueCall = mockPool.query.mock.calls[2];
    expect(requeueCall[0]).toContain("status = 'queued'");
    expect(requeueCall[0]).toContain("retry_count = retry_count + 1");
  });

  it('S4: CI 失败 + retry=2 (MAX) → quarantine', async () => {
    const task = { id: 'task-3', title: 'T3', pr_url: 'https://github.com/o/r/pull/3', pr_status: 'open', retry_count: 2, payload: {} };
    mockPool.query
      .mockResolvedValueOnce({ rows: [task] })
      .mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'eslint-check', conclusion: 'FAILURE', status: 'COMPLETED' }] }));

    await shepherdOpenPRs(mockPool);
    expect(quarantineTask).toHaveBeenCalledWith('task-3', 'ci_failure', expect.objectContaining({ failure_class: 'lint', retry_count: 2 }));
    expect(mockPool.query).toHaveBeenCalledTimes(2); // 不重排
  });

  it('S5: CI 失败 + type=other + retry=0 → quarantine', async () => {
    const task = { id: 'task-4', title: 'T4', pr_url: 'https://github.com/o/r/pull/4', pr_status: 'open', retry_count: 0, payload: {} };
    mockPool.query.mockResolvedValueOnce({ rows: [task] }).mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'security-scan', conclusion: 'FAILURE', status: 'COMPLETED' }] }));

    await shepherdOpenPRs(mockPool);
    expect(quarantineTask).toHaveBeenCalledWith('task-4', 'ci_failure', expect.objectContaining({ failure_class: 'other' }));
  });

  it('S6: PR state=MERGED → pr_status=merged，更新 pr_merged_at', async () => {
    const task = { id: 'task-5', title: 'T5', pr_url: 'https://github.com/o/r/pull/5', pr_status: 'ci_pending', retry_count: 0, payload: {} };
    mockPool.query.mockResolvedValueOnce({ rows: [task] }).mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN', statusCheckRollup: [] }));

    const result = await shepherdOpenPRs(mockPool);
    expect(result.merged).toBe(1);
    expect(mockPool.query.mock.calls[1][0]).toContain("pr_status = 'merged'");
    expect(mockPool.query.mock.calls[1][0]).toContain("pr_merged_at");
  });

  it('S7: PR state=CLOSED → pr_status=closed', async () => {
    const task = { id: 'task-6', title: 'T6', pr_url: 'https://github.com/o/r/pull/6', pr_status: 'open', retry_count: 0, payload: {} };
    mockPool.query.mockResolvedValueOnce({ rows: [task] }).mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ state: 'CLOSED', mergeable: 'UNKNOWN', statusCheckRollup: [] }));

    await shepherdOpenPRs(mockPool);
    expect(mockPool.query.mock.calls[1][0]).toContain("pr_status = 'closed'");
  });

  it('S8: gh CLI 异常 → errors++，继续处理其他 PR', async () => {
    const tasks = [
      { id: 'task-7', title: 'T7', pr_url: 'https://github.com/o/r/pull/7', pr_status: 'open', retry_count: 0, payload: {} },
      { id: 'task-8', title: 'T8', pr_url: 'https://github.com/o/r/pull/8', pr_status: 'open', retry_count: 0, payload: {} },
    ];
    mockPool.query.mockResolvedValueOnce({ rows: tasks }).mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(execSync)
      .mockImplementationOnce(() => { throw new Error('gh: not found'); })
      .mockReturnValueOnce(JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN', statusCheckRollup: [] }));

    const result = await shepherdOpenPRs(mockPool);
    expect(result.processed).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.merged).toBe(1);
  });

  it('S9: DB 查询失败 → 返回空结果，不抛出', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection refused'));
    const result = await shepherdOpenPRs(mockPool);
    expect(result.processed).toBe(0);
  });

  it('S10: CI pending → pr_status 更新为 ci_pending（原为 open）', async () => {
    const task = { id: 'task-9', title: 'T9', pr_url: 'https://github.com/o/r/pull/9', pr_status: 'open', retry_count: 0, payload: {} };
    mockPool.query.mockResolvedValueOnce({ rows: [task] }).mockResolvedValueOnce({ rowCount: 1 });
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'brain-ci', conclusion: null, status: 'IN_PROGRESS' }] }));

    const result = await shepherdOpenPRs(mockPool);
    expect(result.pending).toBe(1);
    expect(mockPool.query.mock.calls[1][0]).toContain("pr_status = 'ci_pending'");
  });
});
