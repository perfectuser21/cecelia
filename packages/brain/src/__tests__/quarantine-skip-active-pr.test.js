/**
 * Tests for ACTIVE-PR guard in handleTaskFailure / hasActivePr.
 *
 * 背景：task 已产出 PR（pr_url 填充 + pr_status='ci_pending'/'open'/'merged'）
 * 但 Brain tick 仍把它当 queued 重派 → quarantine 看到 failure_count>=3 → 拉黑
 * → shepherd 过滤 status NOT IN ('quarantined') 永远跳过 → PR 永远不 merge → 死循环。
 *
 * 修复：handleTaskFailure 在 checkpoint/container 守卫之后再加 PR 守卫。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock db.js：测试不依赖 PostgreSQL
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock child_process.execFile：测试不依赖真实 docker
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

let handleTaskFailure;
let hasActivePr;
let pool;
let execFileMock;

beforeAll(async () => {
  const mod = await import('../quarantine.js');
  handleTaskFailure = mod.handleTaskFailure;
  hasActivePr = mod.hasActivePr;
  pool = (await import('../db.js')).default;
  execFileMock = (await import('child_process')).execFile;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// docker ps 桩：promisified execFile callback 形式
function mockDockerPs(stdout, shouldReject = false) {
  execFileMock.mockImplementationOnce((cmd, args, opts, cb) => {
    const callback = cb || opts;
    if (shouldReject) callback(new Error('docker not found'));
    else callback(null, { stdout, stderr: '' });
  });
}

describe('hasActivePr', () => {
  it('返回 true：pr_url 存在且 pr_status=open', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'open' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 true：pr_url 存在且 pr_status=ci_pending', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'ci_pending' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 true：pr_url 存在且 pr_status=merged', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'merged' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 false：pr_url=NULL（任务还没建 PR）', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: null, pr_status: null }],
    });
    expect(await hasActivePr('aaaa')).toBe(false);
  });

  it('返回 false：pr_status=closed（应允许 shepherd 重派）', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'closed' }],
    });
    expect(await hasActivePr('aaaa')).toBe(false);
  });

  it('返回 false：任务不存在', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await hasActivePr('aaaa')).toBe(false);
  });

  it('返回 false：DB 报错时安全 fallback', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    expect(await hasActivePr('aaaa')).toBe(false);
  });
});

describe('handleTaskFailure — active PR 守卫', () => {
  it('活跃 PR (ci_pending) 命中 → 不隔离不累加，reason=active_pr', async () => {
    const taskId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    // 1. checkpoint 查询 → 无行
    pool.query.mockResolvedValueOnce({ rows: [] });
    // 2. docker ps → 无命中
    mockDockerPs('some-other\n');
    // 3. hasActivePr 查询 → ci_pending
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'ci_pending' }],
    });

    const result = await handleTaskFailure(taskId);

    expect(result.quarantined).toBe(false);
    expect(result.skipped_active).toBe(true);
    expect(result.reason).toBe('active_pr');
    expect(result.failure_count).toBe(0);

    // checkpoint + hasActivePr = 2 次 pool.query；docker ps = 1 次 execFile
    // 不应该再有 SELECT tasks / UPDATE failure_count
    expect(pool.query.mock.calls.length).toBe(2);
    const updates = pool.query.mock.calls.filter(c => String(c[0]).includes('UPDATE'));
    expect(updates.length).toBe(0);
  });

  it('无 PR (pr_url=NULL) → 走原 failure 逻辑，failure_count 累加', async () => {
    const taskId = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff';
    // 1. checkpoint → 无
    pool.query.mockResolvedValueOnce({ rows: [] });
    // 2. docker ps → 无
    mockDockerPs('some-other\n');
    // 3. hasActivePr → NULL
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: null, pr_status: null }],
    });
    // 4. SELECT tasks（handleTaskFailure 主路径）
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: taskId,
        status: 'failed',
        payload: { failure_count: 0 },
      }],
    });
    // 5. UPDATE tasks（累加 failure_count）
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await handleTaskFailure(taskId);

    expect(result.quarantined).toBe(false);
    expect(result.skipped_active).toBeUndefined();
    expect(result.failure_count).toBe(1);
    expect(result.reason).toBeUndefined();

    const updates = pool.query.mock.calls.filter(c => String(c[0]).includes('UPDATE'));
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it('checkpoint 守卫优先时不查 PR', async () => {
    const taskId = 'aaaaaaaa-bbbb-cccc-dddd-000000000000';
    // checkpoint 命中
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const result = await handleTaskFailure(taskId);

    expect(result.skipped_active).toBe(true);
    expect(result.reason).toBe('active_checkpoint');
    // 只有 1 次 query（checkpoint），没有第 2 次 hasActivePr 查询
    expect(pool.query.mock.calls.length).toBe(1);
    expect(execFileMock.mock.calls.length).toBe(0);
  });

  it('container 守卫优先时不查 PR', async () => {
    const taskId = '33b37ea3-4b3c-4a9a-bb40-aaaaaaaaaaaa';
    pool.query.mockResolvedValueOnce({ rows: [] }); // checkpoint 无
    mockDockerPs('cecelia-task-33b37ea34b3c\n');     // container 命中

    const result = await handleTaskFailure(taskId);

    expect(result.skipped_active).toBe(true);
    expect(result.reason).toBe('active_container');
    // 只 1 次 query（checkpoint），没有 hasActivePr 查询
    expect(pool.query.mock.calls.length).toBe(1);
  });
});
