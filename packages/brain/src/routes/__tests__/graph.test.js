import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

// 固定 fixture:边 a→b→c + 测试文件 t 依赖 b;feature F1 锚定 c.js(covered)
const EDGE_ROWS = [
  { src_path: 'a.js', dst_path: 'b.js', edge_type: 'import' },
  { src_path: 'b.js', dst_path: 'c.js', edge_type: 'import' },
  { src_path: 'x/__tests__/t.test.js', dst_path: 'b.js', edge_type: 'import' },
];
const FEATURE_ROWS = [
  { id: 'f1', name: '发布能力', unit_test_path: 'c.js', workflow_ref: null, guard_ref: null },
  { id: 'f2', name: '客服能力', unit_test_path: null, workflow_ref: 'publishers/zj/p.js', guard_ref: null },
];

// loadGraphContext 依次三查:edges → max(scanned_at) → features;之后端点可能再查 promises/siblings
function primeContext({ promiseRows = [], siblingRows = [] } = {}) {
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql, params) => {
    const s = String(sql);
    if (s.includes('FROM graph_edges') && s.includes('src_path')) return { rows: EDGE_ROWS };
    if (s.includes('max(scanned_at)')) return { rows: [{ latest: new Date() }] };
    if (s.includes('FROM journey_features')) return { rows: FEATURE_ROWS };
    if (s.includes('journey_step_links l') && s.includes('journey_steps')) return { rows: promiseRows };
    if (s.includes('l2.step_id = l1.step_id')) return { rows: siblingRows };
    throw new Error('unexpected sql: ' + s.slice(0, 80));
  });
}

let app;
beforeEach(async () => {
  vi.resetModules();
  primeContext();
  const { default: router } = await import('../graph.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain/graph', router);
});

describe('GET /locate', () => {
  it('缺 q → 400', async () => {
    const res = await request(app).get('/api/brain/graph/locate');
    expect(res.status).toBe(400);
  });

  it('按名称命中 feature,带三态与覆盖率与账龄', async () => {
    primeContext({ promiseRows: [{ feature_id: 'f1', step_name: 'S3', promise: '客户收到得体回复', journey_name: '客服线' }] });
    const res = await request(app).get('/api/brain/graph/locate?q=发布');
    expect(res.status).toBe(200);
    expect(res.body.features.length).toBe(1);
    expect(res.body.features[0].status).toBe('covered');
    expect(res.body.features[0].promises[0].promise).toContain('得体');
    expect(res.body.anchor_coverage).toEqual({ total_features: 2, anchored: 2, covered_by_graph: 1 });
    expect(res.body.freshness.stale).toBe(false);
  });

  it('q 命中图节点路径 → files 返回', async () => {
    const res = await request(app).get('/api/brain/graph/locate?q=t.test');
    expect(res.body.files).toContain('x/__tests__/t.test.js');
  });
});

describe('GET /related', () => {
  it('b.js 的正反邻边', async () => {
    const res = await request(app).get('/api/brain/graph/related?path=b.js');
    expect(res.body.dependencies).toEqual([{ path: 'c.js', edge_type: 'import' }]);
    const deps = res.body.dependents.map((d) => d.path).sort();
    expect(deps).toEqual(['a.js', 'x/__tests__/t.test.js']);
  });

  it('锚定文件返回 claimed_by', async () => {
    const res = await request(app).get('/api/brain/graph/related?path=c.js');
    expect(res.body.claimed_by).toEqual([{ feature_id: 'f1', name: '发布能力' }]);
  });

  it('缺 path → 400', async () => {
    const res = await request(app).get('/api/brain/graph/related');
    expect(res.status).toBe(400);
  });
});

describe('GET /claim-status', () => {
  it('锚点文件本身 claimed', async () => {
    const res = await request(app).get('/api/brain/graph/claim-status?path=c.js');
    expect(res.body.claimed).toBe(true);
    expect(res.body.claimed_by[0].name).toBe('发布能力');
    expect(res.body.verdict).toBe('claimed');
  });

  it('可达锚点区域的文件 claimed(a.js 经 fwd 到 c.js)', async () => {
    const res = await request(app).get('/api/brain/graph/claim-status?path=a.js');
    expect(res.body.claimed).toBe(true);
  });

  it('图外文件 isolated', async () => {
    const res = await request(app).get('/api/brain/graph/claim-status?path=nowhere.js');
    expect(res.body.claimed).toBe(false);
    expect(res.body.verdict).toBe('isolated');
  });
});
