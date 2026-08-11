import { describe, it, expect, vi } from 'vitest';
import { getSchemaVersion, getDeploymentStatus } from '../src/tools/schema-and-deployment.js';
import { getMapSummary } from '../src/tools/map-summary.js';
import { getMapNodes, getMapEdges, ValidationError } from '../src/tools/map-nodes-edges.js';

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

// 这两个 describe 里的 VALID_NODE_TYPES / VALID_EDGE_TYPES 是测试自己构造的合法值夹具，
// 用来验证 getMapNodes/getMapEdges 对"传进来的 validTypes"这个参数的校验逻辑本身，
// 不代表生产环境真实合法值——真实值见 src/tools/map-nodes-edges.js 导出的
// NODE_TYPES/EDGE_TYPES（对齐 405 migration 的 CHECK 约束）。
const VALID_NODE_TYPES = ['value_stream', 'capability', 'cross_cut', 'boundary'];
const VALID_EDGE_TYPES = ['contains', 'depends_on', 'crosses'];

describe('getMapNodes', () => {
  it('合法 node_type + limit 返回查询结果', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [{ id: 'n1', name: 'X' }] });
    const result = await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 50 }, VALID_NODE_TYPES);
    expect(result.rows).toHaveLength(1);
  });

  it('非法 node_type 抛 ValidationError', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapNodes(fakePool, fakeQuery, { node_type: 'not_a_type', limit: 50 }, VALID_NODE_TYPES)
    ).rejects.toThrow(ValidationError);
    expect(fakeQuery).not.toHaveBeenCalled();
  });

  it('limit=0 抛 ValidationError', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 0 }, VALID_NODE_TYPES)
    ).rejects.toThrow(ValidationError);
  });

  it('limit 负数抛 ValidationError', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: -5 }, VALID_NODE_TYPES)
    ).rejects.toThrow(ValidationError);
  });

  it('limit 超过 200 会被 clamp 到 200', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 9999 }, VALID_NODE_TYPES);
    expect(fakeQuery.mock.calls[0][2]).toContain(200);
  });

  it('limit 缺省时用 50', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability' }, VALID_NODE_TYPES);
    expect(fakeQuery.mock.calls[0][2]).toContain(50);
  });

  it('传入 activeRunId 时 SQL 限定 run_id，并把值带进查询参数', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 10 }, VALID_NODE_TYPES, 'run-abc');
    expect(fakeQuery.mock.calls[0][1]).toMatch(/run_id/);
    expect(fakeQuery.mock.calls[0][2]).toContain('run-abc');
  });

  it('不传 activeRunId 时不限定 run_id（跨全部 run 查询）', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 10 }, VALID_NODE_TYPES);
    expect(fakeQuery.mock.calls[0][1]).not.toMatch(/run_id/);
  });

  it('activeRunId 显式传 null 时同样不限定 run_id', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 10 }, VALID_NODE_TYPES, null);
    expect(fakeQuery.mock.calls[0][1]).not.toMatch(/run_id/);
  });
});

describe('getMapEdges', () => {
  it('非法 edge_type 抛 ValidationError', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapEdges(fakePool, fakeQuery, { edge_type: 'bogus', limit: 50 }, VALID_EDGE_TYPES)
    ).rejects.toThrow(ValidationError);
    expect(fakeQuery).not.toHaveBeenCalled();
  });

  it('合法 edge_type 返回查询结果', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [{ id: 'e1' }] });
    const result = await getMapEdges(fakePool, fakeQuery, { edge_type: 'contains', limit: 50 }, VALID_EDGE_TYPES);
    expect(result.rows).toHaveLength(1);
  });

  it('传入 activeRunId 时 SQL 限定 run_id', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapEdges(fakePool, fakeQuery, { edge_type: 'contains', limit: 10 }, VALID_EDGE_TYPES, 'run-xyz');
    expect(fakeQuery.mock.calls[0][1]).toMatch(/run_id/);
    expect(fakeQuery.mock.calls[0][2]).toContain('run-xyz');
  });
});
