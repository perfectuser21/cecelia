import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssertionExecutor } from '../gp-assertion-process.js';

function childProcess() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

afterEach(() => vi.useRealTimers());

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

describe('GP assertion process executor', () => {
  it('requires an explicitly injected trusted process adapter', () => {
    expect(() => createAssertionExecutor()).toThrowError(
      /trusted process adapter/i,
    );
  });

  it('passes only an allowlisted environment to the trusted adapter', async () => {
    const child = childProcess();
    const spawnFn = vi.fn(() => child);
    const execute = createAssertionExecutor({
      spawnFn,
      environment: {
        PATH: '/trusted/bin',
        LANG: 'C.UTF-8',
        DATABASE_URL: 'postgres://brain-secret',
        OPENAI_API_KEY: 'provider-secret',
      },
    });
    const pending = execute('/trusted/bin/test', [], {
      cwd: '/repo',
      evidenceKind: 'bash',
    });
    child.emit('close', 0, null);
    await pending;

    expect(spawnFn.mock.calls[0][2].env).toEqual({
      PATH: '/trusted/bin',
      LANG: 'C.UTF-8',
    });
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGKILL', 137],
  ])('normalizes %s to a writable FAIL result', async (signal, exitCode) => {
    const child = childProcess();
    const execute = createAssertionExecutor({
      spawnFn: vi.fn(() => child),
      timeoutMs: 1000,
    });
    const pending = execute('trusted', [], {
      cwd: '/repo',
      evidenceKind: 'bash',
    });
    child.emit('close', null, signal);

    await expect(pending).resolves.toMatchObject({
      exitCode,
      signal,
      scenarioCount: 0,
      scenarioEvidence: { kind: 'signal', signal },
    });
  });

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
      { cwd: '/repo', detached: true, shell: false },
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
    const killProcessGroupFn = vi.fn();
    const execute = createAssertionExecutor({
      spawnFn: vi.fn(() => child),
      killProcessGroupFn,
      timeoutMs: 10,
      killGraceMs: 5,
    });
    const pending = execute('trusted', [], {
      cwd: '/repo',
      evidenceKind: 'bash',
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(killProcessGroupFn).toHaveBeenCalledWith(4242, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(5);
    expect(killProcessGroupFn).toHaveBeenCalledWith(4242, 'SIGKILL');
    await expect(pending).resolves.toMatchObject({
      exitCode: 124,
      timedOut: true,
      scenarioCount: 0,
      scenarioEvidence: {
        kind: 'timeout',
        timeout_ms: 10,
        termination: {
          target: 'process_group',
          term_sent: true,
          kill_sent: true,
        },
      },
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills a TERM-resistant grandchild when the parent times out', async () => {
    const grandchild = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const parent = `const{spawn}=require('node:child_process');`
      + `const c=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],`
      + `{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)`;
    const execute = createAssertionExecutor({
      spawnFn: spawn,
      timeoutMs: 100,
      killGraceMs: 50,
    });
    let grandchildPid;

    try {
      const result = await execute(process.execPath, ['-e', parent], {
        cwd: process.cwd(),
        evidenceKind: 'bash',
      });
      grandchildPid = Number(result.stdout.trim());
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(result).toMatchObject({ exitCode: 124, timedOut: true });
      expect(Number.isInteger(grandchildPid)).toBe(true);
      expect(processIsAlive(grandchildPid)).toBe(false);
    } finally {
      if (Number.isInteger(grandchildPid) && processIsAlive(grandchildPid)) {
        process.kill(grandchildPid, 'SIGKILL');
      }
    }
  });

  it('reports group KILL failure without claiming SIGKILL', async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const killProcessGroupFn = vi.fn((pid, signal) => {
      if (signal === 'SIGKILL') {
        throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
      }
    });
    const execute = createAssertionExecutor({
      spawnFn: vi.fn(() => child),
      killProcessGroupFn,
      timeoutMs: 10,
      killGraceMs: 5,
    });
    const result = execute('trusted', [], {
      cwd: '/repo',
      evidenceKind: 'bash',
    });

    await vi.advanceTimersByTimeAsync(15);

    await expect(result).resolves.toMatchObject({
      exitCode: 124,
      signal: null,
      timedOut: true,
      scenarioEvidence: {
        termination: {
          target: 'process_group',
          term_sent: true,
          kill_sent: false,
          cleanup_confirmed: false,
          kill_error: 'EPERM',
        },
      },
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
