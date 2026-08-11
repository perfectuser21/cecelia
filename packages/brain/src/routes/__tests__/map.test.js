/**
 * 刀4: map routes 基础测试
 * 覆盖：路由挂载正确、/health 端点返回结构
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../map.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain/map', router);
  return app;
}
const req = async () => (await import('supertest')).default;

describe('map routes', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.resetModules();
  });

  it('router 模块 default export 是 express Router', async () => {
    const { default: router } = await import('../map.js');
    expect(typeof router).toBe('function');
    expect(router.stack).toBeDefined();
  });

  it('GET /health — DB 不可达时返回部分降级（非 500）', async () => {
    mockQuery.mockRejectedValue(new Error('DB unavailable'));
    const app = await makeApp();
    const res = await (await req())(app).get('/api/brain/map/health');
    // 降级不崩溃：可能 200（partial）或 503，但不是 500
    expect(res.status).not.toBe(500);
  });

  it('高成本 radius 在生产 token 配置后拒绝代理成 loopback 的匿名调用', async () => {
    const prior = process.env.CECELIA_INTERNAL_TOKEN;
    process.env.CECELIA_INTERNAL_TOKEN = 'map-test-token';
    try {
      const app = await makeApp();
      const res = await (await req())(app).post('/api/brain/map/radius').send({});
      expect(res.status).toBe(401);
    } finally {
      if (prior === undefined) delete process.env.CECELIA_INTERNAL_TOKEN;
      else process.env.CECELIA_INTERNAL_TOKEN = prior;
    }
  });

  it('POST /radius — 与 Impact Gate 使用同一 revision-locked 合同', async () => {
    const baseRevision = 'a'.repeat(40);
    const headRevision = 'b'.repeat(40);
    const assertionLinkId = '11111111-1111-4111-8111-111111111111';
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM map_manifest_versions')) {
        return { rows: [{
          id: 'manifest-1', scope_key: 'cecelia', version: 1,
          digest: '1'.repeat(64), status: 'active',
        }] };
      }
      if (sql.includes('FROM map_projection_runs')) {
        return { rows: [{
          id: 'projection-1', scope_key: 'cecelia', status: 'active',
          manifest_digest: '1'.repeat(64), projection_digest: '2'.repeat(64),
          fact_revisions: { cecelia: baseRevision },
        }] };
      }
      if (sql.includes('MAX(scanned_at)')) {
        return { rows: [{ latest: new Date() }] };
      }
      if (sql.includes('FROM graph_snapshot_versions AS snapshot')) {
        return { rows: [{
          snapshot_revision: baseRevision,
          src_path: 'packages/brain/src/impact-contract/diff-gate.js',
          dst_path: 'packages/brain/src/routes/map.js', edge_type: 'import',
        }] };
      }
      if (sql.includes('FROM map_projection_nodes')) {
        return { rows: [{ node_key: 'F1', name: '工厂 · F1 开发闭环' }] };
      }
      if (sql.includes('FROM journey_features')) {
        return { rows: [{
          id: 'feature-1', name: 'Impact Contract',
          unit_test_path: 'packages/brain/src/impact-contract/diff-gate.js',
          workflow_ref: null, guard_ref: null,
          capability_code: 'F1', capability_name: '工厂 · F1 开发闭环',
        }] };
      }
      if (sql.includes('FROM journey_step_links')) {
        return { rows: [{
          id: assertionLinkId,
          assertion_ref: 'packages/brain/src/impact-contract/__tests__/diff-gate.test.js',
          assertion_revision: 3,
          capability_code: 'F1',
        }] };
      }
      return { rows: [] };
    });

    const app = await makeApp();
    const res = await (await req())(app)
      .post('/api/brain/map/radius')
      .send({
        repo: 'perfectuser21/cecelia',
        base_revision: baseRevision,
        head_revision: headRevision,
        changed_files: ['packages/brain/src/routes/map.js'],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      scope_key: 'cecelia',
      manifest_digest: '1'.repeat(64),
      projection_digest: '2'.repeat(64),
      fact_revisions: { 'perfectuser21/cecelia': baseRevision },
      freshness: { status: 'fresh', reason_code: null },
      affected_nodes: [{
        capability_id: 'F1', capability_name: '工厂 · F1 开发闭环', owner: 'F1',
      }],
      required_assertions: [{
        assertion_id: 'packages/brain/src/impact-contract/__tests__/diff-gate.test.js',
        command: 'npx vitest run packages/brain/src/impact-contract/__tests__/diff-gate.test.js',
        covers_capability_ids: ['F1'],
        journey_step_link_id: assertionLinkId,
        assertion_revision: 3,
      }],
    });
    expect(res.body.required_assertions[0].assertion_digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
