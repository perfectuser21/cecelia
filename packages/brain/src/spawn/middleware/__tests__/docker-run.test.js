/**
 * docker-run middleware 单测。
 * 验证 runDocker 的"快乐路径 / 超时 / spawn error / stdout+stderr 分别捕获"四种情况，
 * 以及 Harness W6 修的三种 reject 路径：OOM(exit=137) / SIGKILL signal / stdout EOF 无 exit。
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

  it('rejects on external OOM kill (exit=137 without timeout) with OOM_killed error', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    const p = runDocker(['run', '--rm', 'img'], { taskId: 'oom1', taskType: 'dev', timeoutMs: 5000, name: 'cOom', cidfile: null, command: 'docker run' });
    // 立即 emit exit=137 — 模拟 cgroup OOM killer 杀掉容器。timedOut 始终 false。
    proc.emit('exit', 137, null);
    await expect(p).rejects.toMatchObject({
      code: 'OOM_KILLED',
      exit_code: 137,
      timed_out: false,
    });
  });

  it('rejects on SIGKILL signal (regardless of code) with SIGKILL error', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    const p = runDocker(['run', '--rm', 'img'], { taskId: 'sig1', taskType: 'dev', timeoutMs: 5000, name: 'cSig', cidfile: null, command: 'docker run' });
    proc.emit('exit', null, 'SIGKILL');
    await expect(p).rejects.toMatchObject({
      code: 'OOM_KILLED',
      signal: 'SIGKILL',
    });
  });

  it('rejects on stdout EOF without subsequent process exit (hang救援)', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    process.env.CECELIA_DOCKER_STDOUT_EOF_GRACE_MS = '20';
    vi.resetModules();
    ({ runDocker } = await import('../docker-run.js'));
    const p = runDocker(['run', '--rm', 'img'], { taskId: 'eof1', taskType: 'dev', timeoutMs: 5000, name: 'cEof', cidfile: null, command: 'docker run' });
    proc.stdout.emit('data', 'partial');
    proc.stdout.emit('end');
    // 不发 exit — 模拟 docker daemon 卡死，stdout 已经 close 但子进程没退出。
    await expect(p).rejects.toMatchObject({
      code: 'STDOUT_EOF_NO_EXIT',
    });
    delete process.env.CECELIA_DOCKER_STDOUT_EOF_GRACE_MS;
  });

  it('still resolves with timed_out=true when our timeout fired (kill 是我们触发的，不算 OOM)', async () => {
    vi.useFakeTimers();
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc).mockReturnValueOnce(makeProc());
    const p = runDocker(['run', '--rm', 'img'], { taskId: 'to1', taskType: 'dev', timeoutMs: 50, name: 'cTo', cidfile: null, command: 'docker run' });
    vi.advanceTimersByTime(60); // 我们触发 docker kill → timedOut=true
    proc.emit('exit', 137, null); // 容器被我们 kill，exit=137
    vi.useRealTimers();
    const r = await p;
    // 关键契约：我方主动超时，依然 resolve 出 timed_out:true，让 retry-circuit 标 transient
    expect(r.timed_out).toBe(true);
    expect(r.exit_code).toBe(137);
  });

  it('OOM exit fires before stdout end → reject 使用 OOM_KILLED 不是 STDOUT_EOF', async () => {
    const proc = makeProc();
    mockSpawnFn.mockReturnValueOnce(proc);
    const p = runDocker(['run', '--rm', 'img'], { taskId: 'race1', taskType: 'dev', timeoutMs: 5000, name: 'cRace', cidfile: null, command: 'docker run' });
    proc.emit('exit', 137, null); // exit 抢先触发
    proc.stdout.emit('end'); // 后到的 stdout end 不应再触发新的 reject（settled 守门）
    await expect(p).rejects.toMatchObject({ code: 'OOM_KILLED' });
  });
});
