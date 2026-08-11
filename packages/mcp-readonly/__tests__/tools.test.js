import { describe, it, expect, vi } from 'vitest';
import { getSchemaVersion, getDeploymentStatus } from '../src/tools/schema-and-deployment.js';

describe('getSchemaVersion', () => {
  it('返回 pool 查询到的最新版本号', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [{ version: 406 }] });
    const result = await getSchemaVersion(fakePool, fakeQuery);
    expect(result).toEqual({ current_version: 406 });
  });
});

describe('getDeploymentStatus', () => {
  it('返回 commit SHA / branch / uptime', async () => {
    const fakeExec = vi.fn()
      .mockResolvedValueOnce({ stdout: 'abc1234\n' })
      .mockResolvedValueOnce({ stdout: 'main\n' });
    const result = await getDeploymentStatus(fakeExec, { startedAt: Date.now() - 5000 });
    expect(result.commit_sha).toBe('abc1234');
    expect(result.branch).toBe('main');
    expect(result.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});
