/**
 * Tests for ACTIVE-CONTAINER guard in handleTaskFailure / hasActiveContainer.
 *
 * 背景：hasActiveCheckpoint 只覆盖走 LangGraph 的 GAN 类任务（写 checkpoints 表）。
 * Generator 类（harness_task / content-pipeline）不走 LangGraph，直接在 docker
 * 容器里跑 Claude Code，会被 shepherd 误判隔离。
 *
 * 修复：handleTaskFailure 在 checkpoint 守卫之后再加 docker container 守卫。
 * 容器名约定：cecelia-task-<taskId 前 12 位 hex，无 dash>。
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
let hasActiveContainer;
let pool;
let execFileMock;

beforeAll(async () => {
  const mod = await import('../quarantine.js');
  handleTaskFailure = mod.handleTaskFailure;
  hasActiveContainer = mod.hasActiveContainer;
  pool = (await import('../db.js')).default;
  execFileMock = (await import('child_process')).execFile;
});

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper：让 promisified execFile 返回指定 stdout（或 reject）
 *
 * util.promisify(execFile) 调用原始 execFile(cmd, args, opts, cb)。
 * promisify 会自动以 `(err, { stdout, stderr })` 形式封装回调。
 */
function mockDockerPs(stdout, shouldReject = false) {
  execFileMock.mockImplementationOnce((cmd, args, opts, cb) => {
    // promisify 传入的 callback 永远是最后一个参数
    const callback = cb || opts;
    if (shouldReject) {
      callback(new Error('docker not found'));
    } else {
      // promisify 默认会把 (err, stdout, stderr) 变成 { stdout, stderr }
      // 但 execFile 的 promisify 约定是 (err, { stdout, stderr })
      callback(null, { stdout, stderr: '' });
    }
  });
}

describe('hasActiveContainer', () => {
  it('返回 true 当 docker ps 输出包含对应容器名', async () => {
    // taskId: 33b37ea3-4b3c-4a9a-bb40-xxx → cecelia-task-33b37ea34b3c
    const taskId = '33b37ea3-4b3c-4a9a-bb40-aaaaaaaaaaaa';
    mockDockerPs('some-other-container\ncecelia-task-33b37ea34b3c\nthird-container\n');

    const result = await hasActiveContainer(taskId);

    expect(result).toBe(true);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe('docker');
    expect(args).toEqual(['ps', '--format', '{{.Names}}']);
  });

  it('返回 false 当 docker ps 输出不包含对应容器名', async () => {
    const taskId = '33b37ea3-4b3c-4a9a-bb40-aaaaaaaaaaaa';
    mockDockerPs('cecelia-task-ffffffffffff\nsome-other-container\n');

    const result = await hasActiveContainer(taskId);

    expect(result).toBe(false);
  });

  it('返回 false 当容器名仅部分匹配（防止 startsWith 误匹配）', async () => {
    const taskId = '33b37ea3-4b3c-4a9a-bb40-aaaaaaaaaaaa';
    // 只多了一个字符后缀就不应该匹配
    mockDockerPs('cecelia-task-33b37ea34b3cX\n');

    const result = await hasActiveContainer(taskId);

    expect(result).toBe(false);
  });

  it('execFile 抛错时安全返回 false（docker 不可达/超时）', async () => {
    const taskId = '33b37ea3-4b3c-4a9a-bb40-aaaaaaaaaaaa';
    mockDockerPs('', true);

    const result = await hasActiveContainer(taskId);

    expect(result).toBe(false);
  });

  it('taskId 无 dash 也能正确取前 12 位 hex', async () => {
    const taskId = '33b37ea34b3c4a9abb40aaaaaaaaaaaa';
    mockDockerPs('cecelia-task-33b37ea34b3c\n');

    const result = await hasActiveContainer(taskId);

    expect(result).toBe(true);
  });
});

describe('handleTaskFailure — active container 守卫', () => {
  it('活跃容器（docker ps 命中）不隔离、不累加 failure_count，返回 reason=active_container', async () => {
    const taskId = '33b37ea3-4b3c-4a9a-bb40-aaaaaaaaaaaa';
    // 第一次 query = hasActiveCheckpoint → 无行（checkpoint 守卫放行）
    pool.query.mockResolvedValueOnce({ rows: [] });
    // docker ps → 命中容器
    mockDockerPs('cecelia-task-33b37ea34b3c\n');

    const result = await handleTaskFailure(taskId);

    expect(result.quarantined).toBe(false);
    expect(result.skipped_active).toBe(true);
    expect(result.reason).toBe('active_container');
    expect(result.failure_count).toBe(0);

    // 只有 1 次 pool.query（checkpoints 查询）+ 1 次 execFile（docker ps）
    // 没有后续 SELECT tasks / UPDATE failure_count
    expect(pool.query.mock.calls.length).toBe(1);
    expect(execFileMock.mock.calls.length).toBe(1);
  });

  it('无活跃容器（docker ps 无命中）会继续正常失败处理', async () => {
    const taskId = '99999999-0000-0000-0000-000000000000';
    // hasActiveCheckpoint → false
    pool.query.mockResolvedValueOnce({ rows: [] });
    // docker ps 无对应容器
    mockDockerPs('some-other-container\n');
    // SELECT tasks → 首次失败
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: taskId,
        status: 'failed',
        payload: { failure_count: 0 },
      }],
    });
    // UPDATE tasks（累加 failure_count）
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await handleTaskFailure(taskId);

    // 首次失败 count=1 < 阈值 3：不隔离、不是 active skip
    expect(result.quarantined).toBe(false);
    expect(result.skipped_active).toBeUndefined();
    expect(result.failure_count).toBe(1);
    // 确认没有 reason=active_container
    expect(result.reason).toBeUndefined();

    // 至少有 1 次 UPDATE（失败计数）
    const updates = pool.query.mock.calls.filter(c => String(c[0]).includes('UPDATE'));
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it('docker 不可达（execFile throw）时按原 failure 逻辑继续', async () => {
    const taskId = '99999999-0000-0000-0000-000000000000';
    pool.query.mockResolvedValueOnce({ rows: [] }); // checkpoint
    mockDockerPs('', true);                         // docker reject
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: taskId,
        status: 'failed',
        payload: { failure_count: 0 },
      }],
    });
    pool.query.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await handleTaskFailure(taskId);

    expect(result.quarantined).toBe(false);
    expect(result.skipped_active).toBeUndefined();
    expect(result.failure_count).toBe(1);
  });

  it('checkpoint 守卫命中时优先返回 active_checkpoint，不查 docker', async () => {
    const taskId = '33b37ea3-4b3c-4a9a-bb40-aaaaaaaaaaaa';
    // checkpoint 查询命中
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const result = await handleTaskFailure(taskId);

    expect(result.skipped_active).toBe(true);
    expect(result.reason).toBe('active_checkpoint');
    // 不应该调用 docker
    expect(execFileMock.mock.calls.length).toBe(0);
  });
});
