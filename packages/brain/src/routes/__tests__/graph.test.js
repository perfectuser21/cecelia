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
const GRAPH_SHA_40 = 'c'.repeat(40);
const FRESHNESS_ROW = {
  repo: 'cecelia', scanned_at: new Date(), source_revision: GRAPH_SHA_40, scanner_version: 'graph-v3',
};

// loadGraphContext 依次三查:edges → max(scanned_at) → features;之后端点可能再查 promises/siblings
function primeContext({ promiseRows = [], siblingRows = [] } = {}) {
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql, _params) => {
    const s = String(sql);
    if (s.includes('FROM graph_edges') && s.includes('src_path')) return { rows: EDGE_ROWS };
    if (s.includes('max(scanned_at)')) return { rows: [{ latest: new Date() }] };
    if (s.includes('FROM graph_edges') && s.includes('ORDER BY scanned_at DESC')) {
      return { rows: [{ ...FRESHNESS_ROW, repo: _params?.[0] || 'cecelia' }] };
    }
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
    expect(res.body.freshness).toMatchObject({
      repo: 'cecelia', status: 'fresh', stale: false,
      source_revision: GRAPH_SHA_40, scanner_version: 'graph-v3',
    });
  });

  it('?repo=repo-x 同时过滤 edges/latest metadata，且 metadata 来自同一最新行', async () => {
    const res = await request(app).get('/api/brain/graph/locate?q=发布&repo=repo-x');
    expect(res.status).toBe(200);
    const graphCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('FROM graph_edges'));
    expect(graphCalls).toHaveLength(2);
    expect(graphCalls.every(([, params]) => params[0] === 'repo-x')).toBe(true);
    expect(graphCalls[1][0]).toContain('source_revision');
    expect(graphCalls[1][0]).toContain('scanner_version');
    expect(graphCalls[1][0]).toMatch(/ORDER BY scanned_at DESC[\s\S]+LIMIT 1/);
    expect(graphCalls[1][0]).not.toMatch(/max\s*\(/i);
    expect(res.body.freshness).toMatchObject({
      repo: 'repo-x', source_revision: GRAPH_SHA_40, scanner_version: 'graph-v3',
    });
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

describe('POST /radius', () => {
  it('files 缺失/空 → 400', async () => {
    expect((await request(app).post('/api/brain/graph/radius').send({})).status).toBe(400);
    expect((await request(app).post('/api/brain/graph/radius').send({ files: [] })).status).toBe(400);
  });

  it('改 c.js → 反向波及 b/a/测试文件;锚定 c.js 的 F1 上榜并带 promise', async () => {
    primeContext({ promiseRows: [{ feature_id: 'f1', step_name: 'S3', promise: '客户收到得体回复', journey_name: '客服线' }] });
    const res = await request(app).post('/api/brain/graph/radius').send({ files: ['c.js'] });
    expect(res.status).toBe(200);
    expect(res.body.reached_count).toBe(4); // c,b,a,t
    expect(res.body.affected_tests).toEqual(['x/__tests__/t.test.js']);
    expect(res.body.affected_features[0].name).toBe('发布能力');
    expect(res.body.affected_features[0].promises[0].journey_name).toBe('客服线');
    expect(res.body.uncovered_anchor_features).toBe(1); // f2 有锚不匹
  });

  it('max_depth=1 收窄可达', async () => {
    const res = await request(app).post('/api/brain/graph/radius').send({ files: ['c.js'], max_depth: 1 });
    expect(res.body.reached_count).toBe(2); // c,b
  });
});

describe('POST /island-check', () => {
  it('files 非数组 → 400', async () => {
    expect((await request(app).post('/api/brain/graph/island-check').send({ files: 'x' })).status).toBe(400);
  });

  it('三态裁决:锚区文件 claimed / 图外 isolated', async () => {
    const res = await request(app).post('/api/brain/graph/island-check').send({ files: ['a.js', 'nowhere.js'] });
    expect(res.body.results[0]).toMatchObject({ file: 'a.js', verdict: 'claimed' });
    expect(res.body.results[1]).toMatchObject({ file: 'nowhere.js', verdict: 'isolated' });
    expect(res.body.anchor_coverage.covered_by_graph).toBe(1);
  });
});

describe('POST /radius max_depth 边界(falsy 陷阱回归锁)', () => {
  it('max_depth=0 被 clamp 到 1,不回退默认 10', async () => {
    const res = await request(app).post('/api/brain/graph/radius').send({ files: ['c.js'], max_depth: 0 });
    expect(res.body.reached_count).toBe(2); // 与 max_depth=1 相同(c,b),绝不是全图 4
  });
});

describe('GET /anchor-coverage', () => {
  it('返回全量锚点覆盖率与断锚数', async () => {
    const res = await request(app).get('/api/brain/graph/anchor-coverage');
    expect(res.status).toBe(200);
    expect(res.body.anchor_coverage).toEqual({ total_features: 2, anchored: 2, covered_by_graph: 1 });
    expect(res.body.broken).toBe(1);
    expect(res.body.freshness.stale).toBe(false);
  });
});

describe('所有 graph endpoints 传播 fail-closed freshness shape', () => {
  it('locate/related/claim/radius/island/anchor 均返回完整 metadata freshness', async () => {
    const responses = [
      await request(app).get('/api/brain/graph/locate?q=发布'),
      await request(app).get('/api/brain/graph/related?path=b.js'),
      await request(app).get('/api/brain/graph/claim-status?path=a.js'),
      await request(app).post('/api/brain/graph/radius').send({ files: ['c.js'] }),
      await request(app).post('/api/brain/graph/island-check').send({ files: ['a.js'] }),
      await request(app).get('/api/brain/graph/anchor-coverage'),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.freshness).toMatchObject({
        repo: 'cecelia', status: 'fresh', reason_code: null,
        source_revision: GRAPH_SHA_40, scanner_version: 'graph-v3',
      });
      expect(response.body.freshness.last_success_at).toBeTruthy();
    }
  });
});
