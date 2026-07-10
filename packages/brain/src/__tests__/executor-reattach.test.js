/**
 * Test: reAttachActiveExecutors — Brain 重启后从 lock slot / docker 重建 activeProcesses
 *
 * 验收矩阵：
 *   1. slot 有活 pid → activeProcesses 登记，updated_at 被 touch
 *   2. slot pid 已死 → 不认领
 *   3. docker relay 容器活跃 → bridge 登记，updated_at 被 touch
 *   4. lock dir 不存在（ENOENT）→ 不抛错，reattached=0
 *   5. docker ps 抛错 → 不抛错，errors 中有记录，不误标任务
 *   6. 已在 activeProcesses 的 task → 不重复认领（幂等）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

let mockExecSync;
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: (...args) => mockExecSync(...args),
  exec: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

let mockReaddirSync;
let mockReadFileSync;
let mockExistsSync;
vi.mock('fs', () => ({
  readdirSync: (...args) => mockReaddirSync(...args),
  readFileSync: (...args) => mockReadFileSync(...args),
  existsSync: (...args) => mockExistsSync(...args),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
}));

vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { EXECUTOR: 'executor' },
  STATUS: { START: 'start', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US: 'us', HK: 'hk' },
}));

vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../auto-learning.js', () => ({ processExecutionAutoLearning: vi.fn() }));

vi.mock('../platform-utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listProcessesWithPpid: vi.fn(() => []),
    listProcessesWithElapsed: vi.fn(() => []),
    calculatePhysicalCapacity: vi.fn(() => 4),
    countClaudeProcesses: vi.fn(() => 0),
    sampleCpuUsage: vi.fn(() => 0),
    getSwapUsedPct: vi.fn(() => 0),
    getDmesgInfo: vi.fn(() => ''),
    getBrainRssMB: vi.fn(() => 100),
    evaluateMemoryHealth: vi.fn(() => ({ action: 'ok', reason: 'healthy' })),
    IS_DARWIN: false,
  };
});

// ─── helpers ────────────────────────────────────────────────────────────────

function makeDirentDir(name) {
  return { name, isDirectory: () => true, isFile: () => false };
}

describe('reAttachActiveExecutors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：lock dir 存在但空，docker ps 返回空
    mockReaddirSync = vi.fn(() => []);
    mockReadFileSync = vi.fn(() => 'SwapTotal: 0\nSwapFree: 0');
    mockExistsSync = vi.fn(() => false);
    mockExecSync = vi.fn((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('docker ps')) return '';
      return '';
    });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('slot 有活 pid → activeProcesses 登记 + updated_at touch', async () => {
    const TASK_ID = '11111111-2222-3333-4444-555555555555';

    // mockReaddirSync: 返回 slot-0 目录
    mockReaddirSync.mockImplementation((dir, opts) => {
      if (typeof dir === 'string' && dir.includes('cecelia-locks')) {
        return [makeDirentDir('slot-0')];
      }
      return [];
    });

    // mockReadFileSync: slot-0/info.json
    mockReadFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('slot-0/info.json')) {
        return JSON.stringify({ task_id: TASK_ID, pid: 9999, child_pid: 10000, started: '2026-07-09T00:00:00Z' });
      }
      return 'SwapTotal: 0\nSwapFree: 0';
    });

    // process.kill(pid, 0) 不抛错 → isProcessAlive 返回 true（通过 executor.js 内 isProcessAlive）
    const origKill = process.kill.bind(process);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (sig === 0 && (pid === 9999 || pid === 10000)) return true; // alive
      return origKill(pid, sig);
    });

    // mock docker ps → 空（不触发 docker 路径）
    mockExecSync.mockReturnValue('');

    // touch updated_at UPDATE
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { reAttachActiveExecutors } = await import('../executor.js');
    const pool = { query: mockQuery };
    const result = await reAttachActiveExecutors(pool);

    expect(result.reattached).toBe(1);
    expect(result.touched).toBe(1);
    expect(result.errors).toHaveLength(0);

    // activeProcesses 有该 task
    const { getActiveProcesses } = await import('../executor.js');
    const procs = getActiveProcesses();
    const entry = procs.find(p => p.taskId === TASK_ID);
    expect(entry).toBeTruthy();
    expect(entry.pid).toBe(10000); // child_pid 优先

    // 验证 UPDATE tasks SET updated_at 被调用
    const touchCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('updated_at = NOW()')
    );
    expect(touchCall).toBeTruthy();
    expect(touchCall[1][0]).toContain(TASK_ID);

    killSpy.mockRestore();
  });

  it('slot pid 已死 → 不认领', async () => {
    const TASK_ID = '22222222-2222-3333-4444-555555555555';

    mockReaddirSync.mockImplementation((dir) => {
      if (typeof dir === 'string' && dir.includes('cecelia-locks')) {
        return [makeDirentDir('slot-0')];
      }
      return [];
    });

    mockReadFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('slot-0/info.json')) {
        return JSON.stringify({ task_id: TASK_ID, pid: 9999 });
      }
      return 'SwapTotal: 0\nSwapFree: 0';
    });

    // process.kill 抛 ESRCH → pid 已死
    vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (sig === 0) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
    });

    mockExecSync.mockReturnValue('');
    const { reAttachActiveExecutors } = await import('../executor.js');
    const pool = { query: mockQuery };
    const result = await reAttachActiveExecutors(pool);

    expect(result.reattached).toBe(0);
    expect(result.touched).toBe(0);

    // 没有 UPDATE updated_at
    const touchCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('updated_at = NOW()')
    );
    expect(touchCall).toBeUndefined();

    vi.restoreAllMocks();
  });

  it('docker relay 容器活跃 → bridge 登记 + updated_at touch', async () => {
    const TASK_ID = '33333333-2222-3333-4444-555555555555';
    // short8 = '33333333'
    const CONTAINER_NAME = 'cecelia-relay-33333333-cx';

    mockReaddirSync.mockReturnValue([]); // 无 lock slot

    // docker ps 返回容器名
    mockExecSync.mockImplementation((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('docker ps')) return CONTAINER_NAME;
      return '';
    });

    // DB 查询：找到 in_progress 任务
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: TASK_ID,
          started_at: new Date().toISOString(),
          payload: { current_run_id: 'run-xyz' },
        }],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 }); // touch updated_at

    const { reAttachActiveExecutors } = await import('../executor.js');
    const pool = { query: mockQuery };
    const result = await reAttachActiveExecutors(pool);

    expect(result.reattached).toBe(1);
    expect(result.touched).toBe(1);
    expect(result.errors).toHaveLength(0);

    const { getActiveProcesses } = await import('../executor.js');
    const procs = getActiveProcesses();
    const entry = procs.find(p => p.taskId === TASK_ID);
    expect(entry).toBeTruthy();
    // bridge entry: alive check returns false (pid=null), but we verified it via docker
    // getActiveProcesses calls isProcessAlive(null) which returns false → entry not returned
    // So instead check via mockQuery calls that touch was called with the task id
    const touchCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('updated_at = NOW()')
    );
    expect(touchCall).toBeTruthy();
    expect(touchCall[1][0]).toContain(TASK_ID);
  });

  it('lock dir 不存在（ENOENT）→ 不抛错，reattached=0', async () => {
    mockReaddirSync.mockImplementation(() => {
      const e = new Error('ENOENT: no such file');
      e.code = 'ENOENT';
      throw e;
    });
    mockExecSync.mockReturnValue('');

    const { reAttachActiveExecutors } = await import('../executor.js');
    const pool = { query: mockQuery };
    let result;
    // 不应抛错
    await expect(async () => {
      result = await reAttachActiveExecutors(pool);
    }).not.toThrow();

    expect(result.reattached).toBe(0);
    expect(result.errors).toHaveLength(0); // ENOENT 静默跳过，不计入 errors
  });

  it('docker ps 抛错 → 不抛错，errors 有记录，不误标任务', async () => {
    mockReaddirSync.mockReturnValue([]);
    mockExecSync.mockImplementation((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('docker ps')) throw new Error('docker: command not found');
      return '';
    });

    const { reAttachActiveExecutors } = await import('../executor.js');
    const pool = { query: mockQuery };
    let result;
    await expect(async () => {
      result = await reAttachActiveExecutors(pool);
    }).not.toThrow();

    expect(result.reattached).toBe(0);
    expect(result.errors.some(e => e.includes('docker_scan'))).toBe(true);

    // 没有任何 UPDATE tasks
    const updateCalls = mockQuery.mock.calls.filter(
      call => typeof call[0] === 'string' && /UPDATE tasks/i.test(call[0])
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('已在 activeProcesses 的 task → 不重复认领（幂等）', async () => {
    const TASK_ID = '44444444-2222-3333-4444-555555555555';

    mockReaddirSync.mockImplementation((dir) => {
      if (typeof dir === 'string' && dir.includes('cecelia-locks')) {
        return [makeDirentDir('slot-0')];
      }
      return [];
    });

    mockReadFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('slot-0/info.json')) {
        return JSON.stringify({ task_id: TASK_ID, pid: 9999 });
      }
      return 'SwapTotal: 0\nSwapFree: 0';
    });

    // pid alive
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    mockExecSync.mockReturnValue('');

    // 第一次调用 → reattached=1
    const { reAttachActiveExecutors } = await import('../executor.js');
    const pool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const r1 = await reAttachActiveExecutors(pool);
    expect(r1.reattached).toBe(1);

    // 第二次调用 → 已在 activeProcesses，不再 reattached
    pool.query.mockClear();
    const r2 = await reAttachActiveExecutors(pool);
    expect(r2.reattached).toBe(0);

    vi.restoreAllMocks();
  });
});
