/**
 * Fix #5 回归测试 — spawnDockerDetached 可观测性日志。
 *
 * 永挂 debug 实证：grep detached/containerId 全空 → 无法判断 docker run -d 到底有没有跑。
 * 加日志：docker run -d 前打 containerId，成功打 dockerId，失败打 exit + stderr。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// mock child_process.spawn 返回一个可控的假进程
const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args) => spawnMock(...args),
}));
// buildDockerArgs 依赖 docker-executor，给个最小返回。
// 必须含 forensics.promptFile（detached.js 按它落盘 prompt，与容器 CECELIA_PROMPT_FILE 同源）。
import os from 'node:os';
import path from 'node:path';
vi.mock('../../docker-executor.js', () => ({
  buildDockerArgs: () => ({
    args: ['run', '--rm', '--name', 'old', '--cidfile', '/tmp/cid', 'img'],
    forensics: { promptFile: path.join(os.tmpdir(), 'detached-logging-test.prompt'), stdoutFile: '', runInstance: 'aaaaaaaa' },
  }),
}));

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe('spawnDockerDetached — Fix #5 spawn 日志', () => {
  let logSpy;
  let errSpy;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    spawnMock.mockReset();
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('docker run -d 成功 → 打印 containerId 行', async () => {
    const { spawnDockerDetached } = await import('../detached.js');
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const p = spawnDockerDetached({ task: { id: 't1' }, prompt: 'hi', containerId: 'harness-task-t1-r0-aaaa' });
    // 模拟 docker run -d 输出全长容器 id 然后退出 0
    proc.stdout.emit('data', Buffer.from('abcdef0123456789'.repeat(4)));
    proc.emit('exit', 0);
    await p;

    const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLogs).toContain('harness-task-t1-r0-aaaa');
    expect(allLogs).toMatch(/spawn-detached/);
  });

  it('docker run -d 失败 → console.error 打印 exit + stderr', async () => {
    const { spawnDockerDetached } = await import('../detached.js');
    const proc = makeFakeProc();
    spawnMock.mockReturnValue(proc);

    const p = spawnDockerDetached({ task: { id: 't2' }, prompt: 'hi', containerId: 'harness-task-t2-r0-bbbb' });
    proc.stderr.emit('data', Buffer.from('image not found'));
    proc.emit('exit', 1);
    await expect(p).rejects.toThrow();

    const allErrs = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allErrs).toMatch(/spawn-detached/);
    expect(allErrs).toContain('FAILED');
  });
});
