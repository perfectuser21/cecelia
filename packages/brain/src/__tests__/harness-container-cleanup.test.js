import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: mockExecFile }));

import { killInitiativeContainers } from '../harness-container-cleanup.js';

describe('killInitiativeContainers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('按 cecelia.run_id label 一次筛出并清除 kernel 容器', async () => {
    mockExecFile.mockImplementation((cmd, args, cb) => {
      const a = args.join(' ');
      if (a === 'ps -q --filter label=cecelia.run_id=target-run') {
        cb(null, 'abc123\ndef456\n');
      } else if (a.startsWith('rm -f')) {
        cb(null, args[2]);
      } else {
        cb(null, '');
      }
    });

    await killInitiativeContainers('target-run');

    const rmCalls = mockExecFile.mock.calls.filter(c => c[1]?.[0] === 'rm');
    expect(rmCalls).toHaveLength(2);
    expect(mockExecFile.mock.calls.some(([, args]) => args[0] === 'inspect')).toBe(false);
  });

  it('handles docker ps failure gracefully', async () => {
    mockExecFile.mockImplementation((cmd, args, cb) => {
      cb(new Error('docker: command not found'), '');
    });

    await expect(killInitiativeContainers('any-id')).resolves.not.toThrow();
  });

  it('single container rm failure does not abort cleanup of remaining containers', async () => {
    mockExecFile.mockImplementation((cmd, args, cb) => {
      const a = args.join(' ');
      if (a === 'ps -q --filter label=cecelia.run_id=x') {
        cb(null, 'cid1\ncid2\n');
      } else if (a.includes('rm') && args.includes('cid1')) {
        cb(new Error('container already removed'), '');
      } else if (a.includes('rm') && args.includes('cid2')) {
        cb(null, 'cid2');
      } else {
        cb(null, '');
      }
    });

    await expect(killInitiativeContainers('x')).resolves.not.toThrow();
    const rmCalls = mockExecFile.mock.calls.filter(c => c[1]?.[0] === 'rm');
    expect(rmCalls).toHaveLength(2);
  });

  it('no-op if initiativeId is falsy', async () => {
    await killInitiativeContainers(null);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
