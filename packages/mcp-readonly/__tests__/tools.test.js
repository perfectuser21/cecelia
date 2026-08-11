import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { getSchemaVersion, getDeploymentStatus } from '../src/tools/schema-and-deployment.js';
import { getMapSummary } from '../src/tools/map-summary.js';
import { getMapNodes, getMapEdges, ValidationError, NODE_TYPES, EDGE_TYPES } from '../src/tools/map-nodes-edges.js';
import { getServiceLogs, SERVICE_LOG_WHITELIST } from '../src/tools/service-logs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  it('合法 node_type + limit 返回查询结果（显式传 null 表示跨全部 run 查询）', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [{ id: 'n1', name: 'X' }] });
    const result = await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 50 }, VALID_NODE_TYPES, null);
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
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 9999 }, VALID_NODE_TYPES, null);
    expect(fakeQuery.mock.calls[0][2]).toContain(200);
  });

  it('limit 缺省时用 50', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability' }, VALID_NODE_TYPES, null);
    expect(fakeQuery.mock.calls[0][2]).toContain(50);
  });

  it('传入 activeRunId 具体值时 SQL 限定 run_id，并把值带进查询参数', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 10 }, VALID_NODE_TYPES, 'run-abc');
    expect(fakeQuery.mock.calls[0][1]).toMatch(/run_id/);
    expect(fakeQuery.mock.calls[0][2]).toContain('run-abc');
  });

  it('activeRunId 显式传 null 时不限定 run_id（有意跨全部 run 查询）', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 10 }, VALID_NODE_TYPES, null);
    expect(fakeQuery.mock.calls[0][1]).not.toMatch(/run_id/);
  });

  it('不传 activeRunId（undefined）时 fail-closed 抛 ValidationError，不发起查询', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 10 }, VALID_NODE_TYPES)
    ).rejects.toThrow(ValidationError);
    expect(fakeQuery).not.toHaveBeenCalled();
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

  it('合法 edge_type 返回查询结果（显式传 null 表示跨全部 run 查询）', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [{ id: 'e1' }] });
    const result = await getMapEdges(fakePool, fakeQuery, { edge_type: 'contains', limit: 50 }, VALID_EDGE_TYPES, null);
    expect(result.rows).toHaveLength(1);
  });

  it('传入 activeRunId 具体值时 SQL 限定 run_id', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapEdges(fakePool, fakeQuery, { edge_type: 'contains', limit: 10 }, VALID_EDGE_TYPES, 'run-xyz');
    expect(fakeQuery.mock.calls[0][1]).toMatch(/run_id/);
    expect(fakeQuery.mock.calls[0][2]).toContain('run-xyz');
  });

  it('不传 activeRunId（undefined）时 fail-closed 抛 ValidationError，不发起查询', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapEdges(fakePool, fakeQuery, { edge_type: 'contains', limit: 10 }, VALID_EDGE_TYPES)
    ).rejects.toThrow(ValidationError);
    expect(fakeQuery).not.toHaveBeenCalled();
  });
});

// 回归测试：NODE_TYPES/EDGE_TYPES 是从 405 migration 的 CHECK 约束抄过来的静态数组，
// 如果以后 migration 改了合法值而这两个常量没跟着改，校验逻辑会用过时的白名单——
// 这里直接读 migration 源文件解析出 CHECK (... IN (...)) 的真实值做比对，而不是
// 拿另一份手抄的字面量互相比较（那样两边同时漂移也测不出来）。
function extractCheckInValues(sql, column) {
  const match = sql.match(new RegExp(`${column} IN \\(([^)]*)\\)`));
  if (!match) {
    throw new Error(`未在 migration 里找到 ${column} 的 CHECK IN 约束`);
  }
  return match[1]
    .split(',')
    .map((token) => token.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

describe('getServiceLogs', () => {
  it('service 不在白名单抛 ValidationError', async () => {
    const fakeReadLog = vi.fn();
    await expect(
      getServiceLogs(fakeReadLog, { service: 'random-service', lines: 50 })
    ).rejects.toThrow(ValidationError);
    expect(fakeReadLog).not.toHaveBeenCalled();
  });

  it('合法 service 返回脱敏后的日志行', async () => {
    const fakeReadLog = vi.fn().mockResolvedValue([
      'normal log line',
      'token=ghp_1234567890abcdefghijklmnopqrstuv leaked here',
    ]);
    const result = await getServiceLogs(fakeReadLog, { service: 'cecelia-brain', lines: 50 });
    expect(result.lines[0]).toBe('normal log line');
    expect(result.lines[1]).toContain('ghp_****');
    expect(result.lines[1]).not.toContain('1234567890abcdefghijklmnopqrstuv');
  });

  it('lines 超过 200 会被 clamp', async () => {
    const fakeReadLog = vi.fn().mockResolvedValue([]);
    await getServiceLogs(fakeReadLog, { service: 'cecelia-brain', lines: 9999 });
    expect(fakeReadLog.mock.calls[0][1]).toBe(200);
  });

  it('SERVICE_LOG_WHITELIST 的值是 docker 容器名，不是文件路径（回归测试：曾经错猜成文件路径语义）', () => {
    // 生产 Brain 跑在 docker-compose.yml 的 node-brain 服务里（container_name:
    // cecelia-node-brain），不是 host LaunchDaemon 直跑 node server.js。值必须是容器名，
    // 不能又漂回一个绝对文件路径——否则真实 readLogFn 接线后会读到一份宿主机上早已停更的
    // 僵尸日志文件而不报错，比直接失败更危险。
    expect(SERVICE_LOG_WHITELIST['cecelia-brain']).toBe('cecelia-node-brain');
    expect(SERVICE_LOG_WHITELIST['cecelia-brain']).not.toMatch(/^\//);
  });

  it('SERVICE_LOG_WHITELIST 本次只含 cecelia-brain', () => {
    expect(Object.keys(SERVICE_LOG_WHITELIST)).toEqual(['cecelia-brain']);
  });
});

describe('NODE_TYPES / EDGE_TYPES 与 405 migration CHECK 约束同步', () => {
  const migrationSql = fs.readFileSync(
    path.join(__dirname, '../../brain/migrations/405_map_projection_core.sql'),
    'utf8'
  );

  it('NODE_TYPES 精确等于 map_projection_nodes.node_type 的 CHECK 约束', () => {
    expect(NODE_TYPES).toEqual(extractCheckInValues(migrationSql, 'node_type'));
  });

  it('EDGE_TYPES 精确等于 map_projection_edges.edge_type 的 CHECK 约束', () => {
    expect(EDGE_TYPES).toEqual(extractCheckInValues(migrationSql, 'edge_type'));
  });
});
