/**
 * ssh-exec.test.js —— ssh 传输原语（从 openclaw-agent-executor 抽出，行为不变）。
 * 全部注入假 spawn/execFile，不发真 ssh。
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { sshWithStdin, sshRun } from '../ssh-exec.js';

function fakeChild({ stdout = '', stderr = '', code = 0, hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn();
  if (!hang) {
    setTimeout(() => {
      if (stdout) child.stdout.emit('data', stdout);
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', code);
    }, 0);
  }
  return child;
}

describe('sshWithStdin', () => {
  it('把输入灌进 stdin 并 end，退出码 0 返回 stdout', async () => {
    const child = fakeChild({ stdout: 'DISPATCHED\n' });
    const spawnFn = vi.fn(() => child);
    await expect(sshWithStdin(spawnFn, ['-o', 'x', 'host', 'sh -s'], 'script-body')).resolves.toBe('DISPATCHED\n');
    expect(spawnFn).toHaveBeenCalledWith('ssh', ['-o', 'x', 'host', 'sh -s'], { stdio: ['pipe', 'pipe', 'pipe'] });
    expect(child.stdin.end).toHaveBeenCalledWith('script-body');
  });

  it('非零退出码 reject，带截断 stderr', async () => {
    const spawnFn = () => fakeChild({ stderr: 'Permission denied', code: 255 });
    await expect(sshWithStdin(spawnFn, [], 'x')).rejects.toThrow(/ssh exit 255: Permission denied/);
  });

  it('超时：kill 子进程并 reject，不挂死', async () => {
    const child = fakeChild({ hang: true });
    await expect(sshWithStdin(() => child, [], 'x', 20)).rejects.toThrow(/ssh timeout after 20ms/);
    expect(child.kill).toHaveBeenCalled();
  });

  it('spawn 同步抛错也 reject', async () => {
    await expect(sshWithStdin(() => { throw new Error('ENOENT'); }, [], 'x')).rejects.toThrow('ENOENT');
  });
});

describe('sshRun', () => {
  it('成功返回 stdout 字符串，失败带 stderr reject', async () => {
    const ok = (bin, args, opts, cb) => cb(null, Buffer.from('EXIT=0'), '');
    await expect(sshRun(ok, ['h'], {})).resolves.toBe('EXIT=0');
    const bad = (bin, args, opts, cb) => cb(new Error('boom'), '', 'denied');
    await expect(sshRun(bad, ['h'], {})).rejects.toMatchObject({ message: 'boom', stderr: 'denied' });
  });
});
