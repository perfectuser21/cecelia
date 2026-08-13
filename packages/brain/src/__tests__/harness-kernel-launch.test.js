import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const CONTROLLER_SESSION_ID = '99999999-9999-4999-8999-999999999999';
const CONTROLLER_GENERATION = 1;

function authority() {
  return {
    controllerSessionId: CONTROLLER_SESSION_ID,
    controllerGeneration: CONTROLLER_GENERATION,
  };
}

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
  it('refuses to launch a Kernel process without durable Controller proof', async () => {
    await expect(launchKernelProcess({
      taskId: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222',
      worktreePath: '/tmp',
    })).rejects.toThrow('controller_lease_identity_missing');
    expect(spawnMock).not.toHaveBeenCalled();
  });

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
      ...authority(),
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
        ...authority(),
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

  it('刀0遗留缺口修复：未设置 CECELIA_KERNEL_LOG_DIR 时，落盘目录落在 REPO_ROOT/logs/kernel/，不是 /tmp/', async () => {
    const fakeRepoRoot = mkdtempSync(join(tmpdir(), 'repo-root-'));
    const prevDir = process.env.CECELIA_KERNEL_LOG_DIR;
    const prevRoot = process.env.REPO_ROOT;
    delete process.env.CECELIA_KERNEL_LOG_DIR;
    process.env.REPO_ROOT = fakeRepoRoot;
    try {
      spawnMock.mockReturnValueOnce(okChild());
      const runId = '55555555-5555-4555-8555-555555555555';
      await launchKernelProcess({
        taskId: '66666666-6666-4666-8666-666666666666',
        runId,
        worktreePath: '/tmp',
        ...authority(),
      });
      const opts = spawnMock.mock.calls.at(-1)[2];
      const expectedLogPath = join(fakeRepoRoot, 'logs', 'kernel', `kernel-${runId}.log`);
      expect(opts.env.CECELIA_KERNEL_LOG_PATH).toBe(expectedLogPath);
      expect(existsSync(expectedLogPath)).toBe(true);
      expect(expectedLogPath.startsWith('/tmp/cecelia-kernel-logs')).toBe(false);
    } finally {
      if (prevDir === undefined) delete process.env.CECELIA_KERNEL_LOG_DIR;
      else process.env.CECELIA_KERNEL_LOG_DIR = prevDir;
      if (prevRoot === undefined) delete process.env.REPO_ROOT;
      else process.env.REPO_ROOT = prevRoot;
    }
  });

  it('刀0遗留缺口修复：CECELIA_KERNEL_LOG_DIR 和 REPO_ROOT 都未设置时，真的走 import.meta.url 兜底算出真实 repo 根（3级不是4级）', async () => {
    const prevDir = process.env.CECELIA_KERNEL_LOG_DIR;
    const prevRoot = process.env.REPO_ROOT;
    delete process.env.CECELIA_KERNEL_LOG_DIR;
    delete process.env.REPO_ROOT;
    // 独立重算 harness-skill-relay.js 内 `new URL('../../..', import.meta.url)` 的结果：
    // 从本测试文件（packages/brain/src/__tests__/）出发，先用同一相对路径写法定位到
    // harness-skill-relay.js 本身的 URL（等价于该模块内部看到的 import.meta.url），
    // 再套用源码里完全相同的 '../../..' 得到 repo 根——不是硬编码绝对路径，也不读环境变量，
    // 真正验证的是 3 级而非 4 级这个本 Task 的核心易错点。
    const relaySourceUrl = new URL('../harness-skill-relay.js', import.meta.url);
    const repoRootPath = fileURLToPath(new URL('../../..', relaySourceUrl));
    let expectedLogPath;
    try {
      spawnMock.mockReturnValueOnce(okChild());
      const runId = '77777777-7777-4777-8777-777777777777';
      await launchKernelProcess({
        taskId: '88888888-8888-4888-8888-888888888888',
        runId,
        worktreePath: '/tmp',
        ...authority(),
      });
      const opts = spawnMock.mock.calls.at(-1)[2];
      expectedLogPath = join(repoRootPath, 'logs', 'kernel', `kernel-${runId}.log`);
      expect(opts.env.CECELIA_KERNEL_LOG_PATH).toBe(expectedLogPath);
      expect(existsSync(expectedLogPath)).toBe(true);
    } finally {
      if (prevDir === undefined) delete process.env.CECELIA_KERNEL_LOG_DIR;
      else process.env.CECELIA_KERNEL_LOG_DIR = prevDir;
      if (prevRoot === undefined) delete process.env.REPO_ROOT;
      else process.env.REPO_ROOT = prevRoot;
      // 这条测试没有 CECELIA_KERNEL_LOG_DIR/REPO_ROOT 兜底隔离，会在真实 worktree 的
      // logs/kernel/ 下落一个真文件（该目录已 .gitignore，不影响 git 状态）；测完自扫。
      if (expectedLogPath && existsSync(expectedLogPath)) unlinkSync(expectedLogPath);
    }
  });
});
