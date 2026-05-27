import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: mockExecFile }));

import { killInitiativeContainers } from '../harness-container-cleanup.js';

describe('killInitiativeContainers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('kills containers matching the initiative_id, skips others', async () => {
    mockExecFile.mockImplementation((cmd, args, cb) => {
      const a = args.join(' ');
      if (a === 'ps -q') {
        cb(null, 'abc123\ndef456\n');
      } else if (a.includes('inspect') && args.includes('abc123')) {
        cb(null, 'HARNESS_INITIATIVE_ID=target-initiative\nOTHER=val\n');
      } else if (a.includes('inspect') && args.includes('def456')) {
        cb(null, 'HARNESS_INITIATIVE_ID=other-initiative\n');
      } else if (a.includes('rm') && args.includes('abc123')) {
        cb(null, 'abc123');
      } else {
        cb(null, '');
      }
    });

    await killInitiativeContainers('target-initiative');

    const rmCalls = mockExecFile.mock.calls.filter(c => c[1]?.[0] === 'rm');
    expect(rmCalls).toHaveLength(1);
    expect(rmCalls[0][1]).toContain('abc123');
    expect(rmCalls[0][1]).not.toContain('def456');
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
      if (a === 'ps -q') {
        cb(null, 'cid1\ncid2\n');
      } else if (a.includes('inspect') && args.includes('cid1')) {
        cb(null, 'HARNESS_INITIATIVE_ID=x\n');
      } else if (a.includes('inspect') && args.includes('cid2')) {
        cb(null, 'HARNESS_INITIATIVE_ID=x\n');
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
