import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: spawnMock,
}));
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

import { launchKernelProcess } from '../harness-skill-relay.js';

function okChild(pid = 4321) {
  const listeners = new Map();
  const child = {
    pid,
    once: vi.fn((event, listener) => {
      listeners.set(event, listener);
      if (event === 'spawn') queueMicrotask(() => listener());
      return child;
    }),
    on: vi.fn(() => child),
    removeListener: vi.fn(() => child),
    unref: vi.fn(),
  };
  return child;
}

function failingChild(error) {
  const listeners = new Map();
  const child = {
    pid: undefined,
    once: vi.fn((event, listener) => {
      listeners.set(event, listener);
      if (event === 'error') queueMicrotask(() => listener(error));
      return child;
    }),
    on: vi.fn(() => child),
    removeListener: vi.fn((event, listener) => {
      if (listeners.get(event) === listener) listeners.delete(event);
      return child;
    }),
    unref: vi.fn(),
  };
  return child;
}

describe('launchKernelProcess detached spawn receipt', () => {
  it('rejects an asynchronous spawn error before unref so watchdog can roll back its token', async () => {
    const child = failingChild(Object.assign(
      new Error('spawn ENOENT'),
      { code: 'ENOENT' },
    ));
    spawnMock.mockReturnValueOnce(child);

    await expect(launchKernelProcess({
      taskId: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222',
      worktreePath: '/missing/kernel-worktree',
      resumeToken: 'resume-token',
    })).rejects.toThrow(/ENOENT/);

    expect(child.unref).not.toHaveBeenCalled();
  });

  it('刀0：detached kernel 的 stdio 落盘到日志文件而非 ignore（解零观测）', async () => {
    const logDir = mkdtempSync(join(tmpdir(), 'kernel-log-'));
    const prev = process.env.CECELIA_KERNEL_LOG_DIR;
    process.env.CECELIA_KERNEL_LOG_DIR = logDir;
    try {
      spawnMock.mockReturnValueOnce(okChild());
      const runId = '33333333-3333-4333-8333-333333333333';
      await launchKernelProcess({
        taskId: '44444444-4444-4444-8444-444444444444',
        runId,
        worktreePath: '/tmp',
      });
      const opts = spawnMock.mock.calls.at(-1)[2];
      // stdio 不再是 'ignore'——是 [ignore, fd, fd] 数组，stdout/stderr 落 fd
      expect(opts.stdio).not.toBe('ignore');
      expect(Array.isArray(opts.stdio)).toBe(true);
      expect(opts.stdio[1]).toBe(opts.stdio[2]); // stdout 与 stderr 同一 fd
      expect(typeof opts.stdio[1]).toBe('number');
      // 日志文件按 runId 命名，已创建；env 透传路径给 kernel 自己也能写
      expect(existsSync(join(logDir, `kernel-${runId}.log`))).toBe(true);
      expect(opts.env.CECELIA_KERNEL_LOG_PATH).toBe(join(logDir, `kernel-${runId}.log`));
    } finally {
      if (prev === undefined) delete process.env.CECELIA_KERNEL_LOG_DIR;
      else process.env.CECELIA_KERNEL_LOG_DIR = prev;
    }
  });
});
