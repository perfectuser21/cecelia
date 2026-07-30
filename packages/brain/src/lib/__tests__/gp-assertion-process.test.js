import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssertionExecutor } from '../gp-assertion-process.js';

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

afterEach(() => vi.useRealTimers());

describe('GP assertion process executor', () => {
  it('spawns without a shell and derives scenario evidence', async () => {
    const child = childProcess();
    const spawnFn = vi.fn(() => child);
    const execute = createAssertionExecutor({ spawnFn, timeoutMs: 1000 });
    const pending = execute('vitest', ['run', 'safe.test.js'], {
      cwd: '/repo',
      evidenceKind: 'vitest',
    });

    child.stdout.emit('data', 'Tests  2 passed (2)');
    child.emit('close', 0, null);

    await expect(pending).resolves.toMatchObject({
      exitCode: 0,
      scenarioCount: 2,
      scenarioEvidence: { kind: 'vitest', passed: 2 },
    });
    expect(spawnFn).toHaveBeenCalledWith(
      'vitest',
      ['run', 'safe.test.js'],
      { cwd: '/repo', shell: false },
    );
  });

  it('bounds invalid process bytes as valid UTF-8', async () => {
    const child = childProcess();
    const execute = createAssertionExecutor({
      spawnFn: vi.fn(() => child),
      captureLimitBytes: 16,
      timeoutMs: 1000,
    });
    const pending = execute('trusted', [], {
      cwd: '/repo',
      evidenceKind: 'vitest',
    });

    child.stdout.emit('data', Buffer.alloc(32, 0xFF));
    child.emit('close', 1, null);

    const result = await pending;
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(16);
    expect(result.stdout).not.toContain('�');
  });

  it('fails closed with exit 124 after TERM and KILL', async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const execute = createAssertionExecutor({
      spawnFn: vi.fn(() => child),
      timeoutMs: 10,
      killGraceMs: 5,
    });
    const pending = execute('trusted', [], {
      cwd: '/repo',
      evidenceKind: 'bash',
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(5);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await expect(pending).resolves.toMatchObject({
      exitCode: 124,
      timedOut: true,
      scenarioCount: 0,
      scenarioEvidence: { kind: 'timeout', timeout_ms: 10 },
    });
  });

  it('rejects a spawn error before timeout', async () => {
    const child = childProcess();
    const execute = createAssertionExecutor({
      spawnFn: vi.fn(() => child),
      timeoutMs: 1000,
    });
    const pending = execute('missing', [], {
      cwd: '/repo',
      evidenceKind: 'bash',
    });
    const error = new Error('ENOENT');

    child.emit('error', error);

    await expect(pending).rejects.toBe(error);
  });
});
