import { readFileSync } from 'node:fs';

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMapRouter } from '../map.js';

const now = new Date('2026-08-11T09:30:00.000Z');
const envelope = {
  scope_key: 'cecelia',
  manifest_version: 1,
  manifest_digest: 'a'.repeat(64),
  projection_digest: 'b'.repeat(64),
  fact_revisions: { cecelia: 'c'.repeat(40) },
  generated_at: now.toISOString(),
  freshness: { status: 'fresh' },
};

function makeHarness(overrides = {}, routerOptions = {}) {
  const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) };
  const services = {
    readMap: vi.fn(async () => ({ ...envelope, nodes: [], edges: [], summary: {} })),
    readNode: vi.fn(async () => ({ ...envelope, node: { key: 'F0' } })),
    readRadius: vi.fn(async () => ({ ...envelope, affected_business_nodes: [] })),
    readHealth: vi.fn(async () => ({ ...envelope, overall: 'healthy', layers: {} })),
    readUnclaimed: vi.fn(async () => ({ ...envelope, unclaimed_count: 0, unclaimed: [] })),
    rebuild: vi.fn(async () => ({ ...envelope, rebuilt: true })),
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/brain/map', createMapRouter({
    pool,
    services,
    now: () => now,
    ...routerOptions,
  }));
  return { app, client, pool, services };
}

describe('Unified Map read router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('整图在只读 REPEATABLE READ 中读取，并原样返回完整 envelope', async () => {
    const { app, client, services } = makeHarness();

    const response = await request(app).get('/api/brain/map?scope=cecelia').expect(200);

    expect(response.body).toMatchObject(envelope);
    expect(services.readMap).toHaveBeenCalledWith(client, { scopeKey: 'cecelia', now });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('节点、健康度与 unclaimed 都走同一一致性读入口且保留 envelope', async () => {
    const { app, client, services } = makeHarness();

    const node = await request(app)
      .get('/api/brain/map/nodes/F0?scope=cecelia')
      .expect(200);
    const health = await request(app)
      .get('/api/brain/map/health?scope=cecelia')
      .expect(200);
    const unclaimed = await request(app)
      .get('/api/brain/map/unclaimed?scope=cecelia')
      .expect(200);

    expect(node.body).toMatchObject({ ...envelope, node: { key: 'F0' } });
    expect(health.body).toMatchObject({ ...envelope, overall: 'healthy' });
    expect(unclaimed.body).toMatchObject({ ...envelope, unclaimed_count: 0 });
    expect(services.readNode).toHaveBeenCalledWith(client, {
      scopeKey: 'cecelia', nodeKey: 'F0', now,
    });
    expect(services.readHealth).toHaveBeenCalledWith(client, { scopeKey: 'cecelia', now });
    expect(services.readUnclaimed).toHaveBeenCalledWith(client, { scopeKey: 'cecelia', now });
    expect(client.query.mock.calls.filter(([sql]) => sql.startsWith('BEGIN'))).toHaveLength(3);
  });

  it('radius 要求显式 scope/repo，并把 changed_files 与 node_keys 交给权威影响半径', async () => {
    const { app, client, services } = makeHarness();
    const body = {
      scope: 'cecelia',
      repo: 'cecelia',
      changed_files: ['packages/brain/src/routes/map.js'],
      node_keys: ['heartbeat_bus'],
      max_depth: 8,
    };

    const response = await request(app).post('/api/brain/map/radius').send(body).expect(200);

    expect(response.body).toMatchObject(envelope);
    expect(services.readRadius).toHaveBeenCalledWith(client, {
      scopeKey: 'cecelia',
      repo: 'cecelia',
      changedFiles: body.changed_files,
      startNodeKeys: body.node_keys,
      maxDepth: 8,
      now,
    });
  });

  it('radius 允许只用 node_keys 下钻 Cross-cut 或 Capability 影响范围', async () => {
    const { app, services } = makeHarness();

    await request(app).post('/api/brain/map/radius').send({
      scope: 'cecelia',
      repo: 'cecelia',
      changed_files: [],
      node_keys: ['F0'],
    }).expect(200);

    expect(services.readRadius).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scopeKey: 'cecelia',
      repo: 'cecelia',
      changedFiles: [],
      startNodeKeys: ['F0'],
    }));
  });

  it('Harness Impact 请求由 revision-locked resolver 裁决，不降级成浏览半径', async () => {
    const impactResult = {
      scope_key: 'cecelia',
      manifest_digest: '1'.repeat(64),
      projection_digest: '2'.repeat(64),
      fact_revisions: { 'perfectuser21/cecelia': 'a'.repeat(40) },
      freshness: { status: 'fresh', reason_code: null },
      affected_nodes: [],
      required_assertions: [],
    };
    const impactRadius = vi.fn(async () => impactResult);
    const { app, pool, services } = makeHarness({}, { impactRadius });
    const body = {
      repo: 'perfectuser21/cecelia',
      base_revision: 'a'.repeat(40),
      head_revision: 'b'.repeat(40),
      changed_files: ['packages/brain/src/routes/map.js'],
    };

    const response = await request(app).post('/api/brain/map/radius').send(body).expect(200);

    expect(response.body).toEqual(impactResult);
    expect(impactRadius).toHaveBeenCalledWith(body);
    expect(services.readRadius).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('生产 token 配置后只允许只读浏览半径，Impact 裁决与 rebuild 拒绝匿名代理', async () => {
    const prior = process.env.CECELIA_INTERNAL_TOKEN;
    process.env.CECELIA_INTERNAL_TOKEN = 'map-test-token';
    try {
      const { app, services } = makeHarness();
      await request(app).post('/api/brain/map/radius').send({
        scope: 'cecelia',
        repo: 'cecelia',
        changed_files: [],
        node_keys: ['F0'],
      }).expect(200);
      await request(app).post('/api/brain/map/radius').send({
        repo: 'perfectuser21/cecelia',
        base_revision: 'a'.repeat(40),
        head_revision: 'b'.repeat(40),
        changed_files: ['packages/brain/src/routes/map.js'],
      }).expect(401);
      await request(app).post('/api/brain/map/rebuild').send({ scope_key: 'cecelia' }).expect(401);
      expect(services.readRadius).toHaveBeenCalledOnce();
      expect(services.rebuild).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.CECELIA_INTERNAL_TOKEN;
      else process.env.CECELIA_INTERNAL_TOKEN = prior;
    }
  });

  it('缺失参数返回稳定 400，服务不连接数据库', async () => {
    const { app, pool } = makeHarness();

    const mapResponse = await request(app).get('/api/brain/map').expect(400);
    const radiusResponse = await request(app)
      .post('/api/brain/map/radius')
      .send({ scope: 'cecelia', changed_files: [] })
      .expect(400);

    expect(mapResponse.body.error.code).toBe('MAP_SCOPE_REQUIRED');
    expect(radiusResponse.body.error.code).toBe('MAP_RADIUS_INPUT_INVALID');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('通用 Map router 不再注册重复 manifest 写端点', async () => {
    const { app, services } = makeHarness();

    await request(app)
      .post('/api/brain/map/manifests/validate')
      .send({ scope_key: 'cecelia' })
      .expect(404);
    expect(services.rebuild).not.toHaveBeenCalled();
  });

  it('rebuild 保留为唯一投影重建写入口并返回同一 envelope', async () => {
    const { app, pool, services } = makeHarness();

    const response = await request(app)
      .post('/api/brain/map/rebuild')
      .send({ scope_key: 'cecelia' })
      .expect(200);

    expect(response.body).toMatchObject({ ...envelope, rebuilt: true });
    expect(services.rebuild).toHaveBeenCalledWith(pool, { scopeKey: 'cecelia', now });
  });
});

describe('server Map 路由权威顺序', () => {
  it('先挂载 Knife 1 manifest router，再挂载通用读 router', () => {
    const source = readFileSync(new URL('../../../server.js', import.meta.url), 'utf8');
    const manifestMount = source.indexOf(
      "app.use('/api/brain/map/manifests', createMapManifestRouter({ pool }))",
    );
    const readMount = source.indexOf("app.use('/api/brain/map', mapRoutes)");

    expect(manifestMount).toBeGreaterThan(0);
    expect(readMount).toBeGreaterThan(manifestMount);
    expect(source.match(/app\.use\('\/api\/brain\/map\/manifests'/g)).toHaveLength(1);
  });
});
