/**
 * docker-executor-timeout.test.js — Harness v6 P1-E
 *
 * 覆盖 timeoutMs 优先级：opts.timeoutMs > tier.timeoutMs > DEFAULT_TIMEOUT_MS。
 * mock runDocker 捕获实际传入的 opts.timeoutMs。
 *
 * Brain task: 3f32212a-adc2-436b-b828-51820a2379e6
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// hoist mocks
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
const runDockerSpy = vi.hoisted(() => vi.fn());
const mockChildSpawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: (...args) => mockChildSpawn(...args) }));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../spawn/middleware/docker-run.js', () => ({ runDocker: runDockerSpy }));
vi.mock('../spawn/middleware/cost-cap.js', () => ({ checkCostCap: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../spawn/middleware/cap-marking.js', () => ({ checkCap: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../spawn/middleware/billing.js', () => ({ recordBilling: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
  resolveAccountForOpts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../spawn/middleware/cascade.js', () => ({ resolveCascade: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../spawn/middleware/logging.js', () => ({
  createSpawnLogger: () => ({ logStart: vi.fn(), logEnd: vi.fn() }),
}));

const { executeInDocker } = await import('../docker-executor.js');

const stubResult = {
  exit_code: 0, stdout: '', stderr: '', duration_ms: 1, container: 'c',
  container_id: null, command: 'docker run', timed_out: false,
  started_at: 't', ended_at: 't',
};

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue({ rowCount: 1 });
  runDockerSpy.mockReset();
  runDockerSpy.mockResolvedValue(stubResult);
  delete process.env.CECELIA_DOCKER_TIMEOUT_MS;
  // ensureDockerImage calls spawn('docker image inspect …') before runDocker.
  // Return a proc that exits 0 (image found) so executeInDocker proceeds to runDocker.
  mockChildSpawn.mockReset();
  mockChildSpawn.mockImplementation(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    const origOn = proc.on.bind(proc);
    proc.on = (event, listener) => {
      const r = origOn(event, listener);
      if (event === 'exit') Promise.resolve().then(() => proc.emit('exit', 0, null));
      return r;
    };
    return proc;
  });
});

describe('executeInDocker timeoutMs 优先级', () => {
  it('tier=normal (未知 task_type fallback) → 90min', async () => {
    await executeInDocker({
      task: { id: 't-normal', task_type: 'something_unknown' },
      prompt: 'x',
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(90 * 60 * 1000);
  });

  it('tier=pipeline-heavy (content_research) → 180min', async () => {
    await executeInDocker({
      task: { id: 't-pipe', task_type: 'content_research' },
      prompt: 'x',
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(180 * 60 * 1000);
  });

  it('tier=heavy (dev) → 120min', async () => {
    await executeInDocker({
      task: { id: 't-heavy', task_type: 'dev' },
      prompt: 'x',
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(120 * 60 * 1000);
  });

  it('tier=light (planner) → 30min', async () => {
    await executeInDocker({
      task: { id: 't-light', task_type: 'planner' },
      prompt: 'x',
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(30 * 60 * 1000);
  });

  it('opts.timeoutMs 显式传入 → 覆盖 tier', async () => {
    await executeInDocker({
      task: { id: 't-explicit', task_type: 'dev' },
      prompt: 'x',
      timeoutMs: 12345,
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(12345);
  });
});

describe('DEFAULT_TIMEOUT_MS = 90min (env override)', () => {
  it('docker-executor.js 源码含 5400000 默认值', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('../docker-executor.js', import.meta.url), 'utf8');
    expect(src).toMatch(/CECELIA_DOCKER_TIMEOUT_MS \|\| '5400000'/);
  });
});
