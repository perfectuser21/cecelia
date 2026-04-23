/**
 * docker-run middleware 单测。
 * 验证 runDocker 的"快乐路径 / 超时 / spawn error / stdout+stderr 分别捕获"四种情况。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const mockSpawnFn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...args) => mockSpawnFn(...args) }));
vi.mock('../../../docker-executor.js', () => ({
  readContainerIdFromCidfile: () => null,
}));

function makeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('runDocker() docker-run middleware', () => {
  let runDocker;
  beforeEach(async () => {
    mockSpawnFn.mockReset();
    vi.resetModules();
    ({ runDocker } = await import('../docker-run.js'));
  });

  it('resolves with exit_code 0 on happy path', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    const p = runDocker(['run', '--rm', 'img'], { taskId: 't1', taskType: 'dev', timeoutMs: 5000, name: 'c1', cidfile: null, command: 'docker run' });
    proc.stdout.emit('data', 'ok');
    proc.emit('exit', 0, null);
    const r = await p;
    expect(r.exit_code).toBe(0);
    expect(r.stdout).toBe('ok');
    expect(r.timed_out).toBe(false);
  });

  it('marks timed_out when kill timer fires', async () => {
    vi.useFakeTimers();
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc).mockReturnValueOnce(makeProc());
    const p = runDocker(['run', '--rm', 'img'], { taskId: 't2', taskType: 'dev', timeoutMs: 100, name: 'c2', cidfile: null, command: 'docker run' });
    vi.advanceTimersByTime(200);
    proc.emit('exit', 137, null);
    const r = await p;
    expect(r.timed_out).toBe(true);
    vi.useRealTimers();
  });

  it('resolves with exit_code -1 on spawn error', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    const p = runDocker(['run', '--rm', 'img'], { taskId: 't3', taskType: 'dev', timeoutMs: 5000, name: 'c3', cidfile: null, command: 'docker run' });
    proc.emit('error', new Error('boom'));
    const r = await p;
    expect(r.exit_code).toBe(-1);
    expect(r.stderr).toContain('spawn error: boom');
  });

  it('captures stdout and stderr separately', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    const p = runDocker(['run'], { taskId: 't4', taskType: 'dev', timeoutMs: 5000, name: 'c4', cidfile: null, command: '' });
    proc.stdout.emit('data', 'out-');
    proc.stdout.emit('data', 'tail');
    proc.stderr.emit('data', 'err-');
    proc.stderr.emit('data', 'tail');
    proc.emit('exit', 0, null);
    const r = await p;
    expect(r.stdout).toBe('out-tail');
    expect(r.stderr).toBe('err-tail');
  });
});
