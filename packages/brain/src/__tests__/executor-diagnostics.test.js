import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  query: vi.fn(), finalize: vi.fn(), dmesg: vi.fn(), read: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('../lib/task-terminal.js', async original => ({ ...(await original()), finalizeTask: boundary.finalize }));
vi.mock('../auto-learning.js', () => ({ processExecutionAutoLearning: vi.fn() }));
vi.mock('../task-router.js', () => ({ getInternalTaskHandler: () => null, getTaskLocation: () => 'us' }));
vi.mock('child_process', async original => ({
  ...(await original()), execSync: vi.fn(() => ''), spawn: vi.fn(),
}));
vi.mock('fs', async original => ({ ...(await original()), readFileSync: boundary.read, existsSync: () => false }));
vi.mock('../platform-utils.js', async original => ({
  ...(await original()),
  listProcessesWithPpid: () => [], listProcessesWithElapsed: () => [],
  getMacOSMemoryPressure: () => 0, getAvailableMemoryMB: () => 8000,
  calculatePhysicalCapacity: () => 4, countClaudeProcesses: () => 0,
  sampleCpuUsage: () => 0, getSwapUsedPct: () => 0, getDmesgInfo: boundary.dmesg,
}));

// 实际启动同步入口消费诊断结果并交给持久化边界；不复制诊断算法，不读宿主dmesg或共享日志。
describe('Executor消失进程的真实诊断与结算', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    boundary.dmesg.mockReturnValue(null);
    boundary.read.mockImplementation(() => { throw new Error('ENOENT'); });
    boundary.query.mockResolvedValue({ rows: [{
      id: 'diagnostic-isolated-task', title: '诊断对象', task_type: 'dev',
      payload: { current_run_id: 'diagnostic-run', watchdog_retry_count: 2 },
      started_at: '2026-01-01T00:00:00Z', error_message: null,
    }] });
    boundary.finalize.mockResolvedValue({ rowCount: 1 });
  });
  afterEach(() => vi.restoreAllMocks());

  async function diagnose() {
    const { syncOrphanTasksOnStartup } = await import('../executor.js');
    expect(await syncOrphanTasksOnStartup()).toMatchObject({ orphans_fixed: 1, requeued: 0 });
    expect(boundary.finalize).toHaveBeenCalledTimes(1);
    const [pool, id, state, options] = boundary.finalize.mock.calls[0];
    expect(pool.query).toBe(boundary.query);
    expect(id).toBe('diagnostic-isolated-task');
    expect(state).toBe('failed');
    return options.mergePayload.error_details;
  }

  it.each(['Out of memory: Kill process 1234 (node)', 'OOM killer selected process'])('内核OOM线索进入真实失败回执：%s', async dmesg => {
    boundary.dmesg.mockReturnValue(dmesg);
    const details = await diagnose();
    expect(details.reason).toBe('oom_likely');
    expect(details.diagnostic_info.dmesg_snippet).toBe(dmesg);
  });

  it.each([
    ['Killed', 'killed_signal'], ['exit SIGKILL', 'killed_signal'],
    ['Error: invalid request', 'process_error'], ['ERROR failed', 'process_error'],
    ['request timeout', 'timeout'], ['TIMEOUT waiting', 'timeout'],
    ['normal startup', 'process_disappeared'],
  ])('实际进程日志%s形成%s分类', async (log, reason) => {
    boundary.read.mockReturnValue(log);
    const details = await diagnose();
    expect(details.reason).toBe(reason);
    expect(details.diagnostic_info.log_tail).toBe(log);
    expect(boundary.read).toHaveBeenCalledWith('/tmp/cecelia-diagnostic-isolated-task.log', 'utf-8');
  });

  it('日志缺失仍保留未知原因和可追溯诊断，不能显示成测试成功', async () => {
    const details = await diagnose();
    expect(details.reason).toBe('process_disappeared');
    expect(details.diagnostic_info.log_tail).toBe('Log file not found or empty');
  });

  it('只用最后20行分类，较早的错误不能污染当前诊断', async () => {
    boundary.read.mockReturnValue(['Error: obsolete', ...Array.from({ length: 20 }, (_, n) => `ok-${n}`)].join('\n'));
    const details = await diagnose();
    expect(details.reason).toBe('process_disappeared');
    expect(details.diagnostic_info.log_tail.split('\n')).toHaveLength(20);
    expect(details.diagnostic_info.log_tail).not.toContain('obsolete');
  });

  it('内核诊断裁剪到最后10行并优先于进程日志错误', async () => {
    boundary.dmesg.mockReturnValue(['old entry', ...Array.from({ length: 9 }, () => 'kernel'), 'OOM killer'].join('\n'));
    boundary.read.mockReturnValue('Error: after OOM');
    const details = await diagnose();
    expect(details.reason).toBe('oom_likely');
    expect(details.diagnostic_info.dmesg_snippet.split('\n')).toHaveLength(10);
    expect(details.diagnostic_info.dmesg_snippet).not.toContain('old entry');
  });
});
