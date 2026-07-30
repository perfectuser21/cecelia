import { describe, expect, it, vi } from 'vitest';

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
});
