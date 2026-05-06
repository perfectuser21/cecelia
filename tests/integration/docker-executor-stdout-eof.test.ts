/**
 * docker-executor stdout EOF 整合测 — Harness W6 hang 救援。
 *
 * 验证：当子进程 stdout 关闭（EOF）但 'exit' 事件迟迟不来（docker daemon 卡死场景），
 * executeInDocker 必须在 STDOUT_EOF_GRACE_MS 后 reject Promise，不能让调用方挂起。
 *
 * 测试策略：mock child_process.spawn → 假 proc emit stdout('end') 但永不 emit exit。
 * 真实 runDocker 的 100ms grace timer 触发后，executeInDocker reject 出 STDOUT_EOF_NO_EXIT。
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

// 把 grace window 缩到 30ms 让测试快，docker-run 模块顶层读 env，需要 import 前 set。
process.env.CECELIA_DOCKER_STDOUT_EOF_GRACE_MS = '30';

const { executeInDocker } = await import('../../packages/brain/src/docker-executor.js');

beforeEach(() => {
  mockSpawnFn.mockReset();
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue({ rowCount: 1 });
});

describe('executeInDocker — stdout EOF without process exit', () => {
  it('rejects with STDOUT_EOF_NO_EXIT when stdout closes but exit never fires (hang scenario)', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);

    const tStart = Date.now();
    const p = executeInDocker({
      task: { id: '44444444-5555-6666-7777-888888888888', task_type: 'dev' },
      prompt: 'noop',
      timeoutMs: 60_000, // 远大于 grace，确保 reject 不是 timeout 触发的
    });

    // 模拟 docker daemon 卡死：stdout flush 完关闭，但 docker run 父进程没退
    setImmediate(() => {
      proc.stdout.emit('data', 'partial output before daemon died');
      proc.stdout.emit('end');
      // 故意不 emit('exit') —— 复现 W1 hang
    });

    const err = await p.catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as any).code).toBe('STDOUT_EOF_NO_EXIT');
    expect(err.message).toMatch(/stdout EOF without process exit/);
    // grace=30ms + executor middleware 开销 → 200ms 内必 settle，绝不挂起
    expect(Date.now() - tStart).toBeLessThan(200);
  });

  it('does NOT trigger STDOUT_EOF reject when exit fires before grace window expires', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);

    const p = executeInDocker({
      task: { id: '55555555-6666-7777-8888-999999999999', task_type: 'dev' },
      prompt: 'noop',
      timeoutMs: 60_000,
    });

    setImmediate(() => {
      proc.stdout.emit('data', 'normal output');
      proc.stdout.emit('end');
      // 正常情况：stdout end 后 'exit' 立即跟来（<1ms）
      setImmediate(() => proc.emit('exit', 0, null));
    });

    const result = await p;
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe('normal output');
    expect(result.timed_out).toBe(false);
  });
});
