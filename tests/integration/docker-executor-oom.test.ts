/**
 * docker-executor OOM integration test — Harness W6 root cause coverage.
 *
 * 验证 executeInDocker 在容器被 OOM killer / 外部 SIGKILL 杀死时（非我们 timeout 触发的 kill）
 * Promise 必须 reject，而不是 resolve 一个 exit_code=137 的 result。这是 W1 invoke() hang 的最底层
 * 根因 —— 旧实现 resolve 后 LangGraph 调用方仍认为成功，没有走错误路径，
 * 而当 docker daemon 卡死 + Promise 永不 settle 时还会无限挂起。
 *
 * 测试策略：mock child_process.spawn 让伪 proc 立即 emit exit(137, null)，跑真实 runDocker +
 * executeInDocker（其它 middleware 全部 mock 成 no-op），断言 100ms 内 reject 出 OOM_KILLED 错误。
 *
 * 对应 spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W6
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ---- mocks ----
const mockSpawnFn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawnFn(...args),
}));

const mockPool = vi.hoisted(() => ({ query: vi.fn().mockResolvedValue({ rowCount: 1 }) }));
vi.mock('../../packages/brain/src/db.js', () => ({ default: mockPool }));

vi.mock('../../packages/brain/src/spawn/middleware/cost-cap.js', () => ({
  checkCostCap: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../packages/brain/src/spawn/middleware/cap-marking.js', () => ({
  checkCap: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../packages/brain/src/spawn/middleware/billing.js', () => ({
  recordBilling: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../packages/brain/src/spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
  resolveAccountForOpts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../packages/brain/src/spawn/middleware/cascade.js', () => ({
  resolveCascade: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../packages/brain/src/spawn/middleware/logging.js', () => ({
  createSpawnLogger: () => ({ logStart: vi.fn(), logEnd: vi.fn() }),
}));

function makeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

const { executeInDocker } = await import('../../packages/brain/src/docker-executor.js');

beforeEach(() => {
  mockSpawnFn.mockReset();
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue({ rowCount: 1 });
});

describe('executeInDocker — OOM / external SIGKILL', () => {
  it('rejects within 100ms when container exits 137 (OOM killer)', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);

    const tStart = Date.now();
    const p = executeInDocker({
      task: { id: '11111111-2222-3333-4444-555555555555', task_type: 'dev' },
      prompt: 'noop',
      timeoutMs: 60_000, // 远大于本次测试，确保 reject 不是来自 our-timeout 路径
    });

    // 微任务调度后立即 emit exit=137（模拟 cgroup OOM 杀容器）
    setImmediate(() => proc.emit('exit', 137, null));

    await expect(p).rejects.toMatchObject({
      code: 'OOM_KILLED',
      exit_code: 137,
      timed_out: false,
    });

    const err = await p.catch((e: Error) => e);
    expect(err.message).toMatch(/OOM_killed/);
    expect(Date.now() - tStart).toBeLessThan(100);
  });

  it('rejects when container exits with signal=SIGKILL (error message 含 SIGKILL)', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);

    const p = executeInDocker({
      task: { id: '22222222-3333-4444-5555-666666666666', task_type: 'dev' },
      prompt: 'noop',
      timeoutMs: 60_000,
    });

    setImmediate(() => proc.emit('exit', null, 'SIGKILL'));

    const err = await p.catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as any).code).toBe('OOM_KILLED');
    expect((err as any).signal).toBe('SIGKILL');
    expect(err.message).toMatch(/SIGKILL/);
  });

  it('does NOT reject when our own timeout triggered the kill (timed_out=true 仍 resolve)', async () => {
    // 这条是契约保护：我方主动 timeout → docker kill → exit=137。
    // retry-circuit 依赖 result.timed_out=true 标 transient，不能改成 reject 否则破坏 retry。
    vi.useFakeTimers();
    const proc = makeProc();
    const killProc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc).mockReturnValueOnce(killProc);

    const p = executeInDocker({
      task: { id: '33333333-4444-5555-6666-777777777777', task_type: 'dev' },
      prompt: 'noop',
      timeoutMs: 50,
    });
    // 推进时间触发 killTimer（timedOut=true），然后 exit 模拟 kill 后容器退出
    await vi.advanceTimersByTimeAsync(60);
    proc.emit('exit', 137, null);
    vi.useRealTimers();

    const result = await p;
    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBe(137);
  });
});
