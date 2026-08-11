import { describe, it, expect, vi } from 'vitest';
import { getSchemaVersion, getDeploymentStatus } from '../src/tools/schema-and-deployment.js';
import { getMapSummary } from '../src/tools/map-summary.js';

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

describe('getMapSummary', () => {
  it('返回 active manifest + 四类对象数量', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'm1', scope_key: 'default', digest: 'd1' }] }) // active manifest
      .mockResolvedValueOnce({ rows: [{ status: 'active', id: 'run1' }] }) // active run
      .mockResolvedValueOnce({ rows: [{ node_type: 'value_stream', count: '3' }, { node_type: 'capability', count: '10' }] }); // node counts

    const result = await getMapSummary(fakePool, fakeQuery);
    expect(result.active_manifest_id).toBe('m1');
    expect(result.projection_status).toBe('active');
    expect(result.node_counts).toEqual({ value_stream: 3, capability: 10 });
  });
});
