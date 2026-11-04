/** 真实 graph-store → loadGraphContext → HTTP 参数传递；仅本地私有 scratch。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { replaceRepoEdges } from '../../../packages/brain/src/lib/graph-store.js';
import {
  assertScratchEnvironment, verifyScratchPool,
} from '../../../packages/brain/src/__tests__/helpers/debt-12-scratch.js';

assertScratchEnvironment();
let pool, loadGraphContext, app, server;
const seeded = [];
const repos = ['debt-12-alpha', 'debt-12-beta', 'cecelia'];
const edge = prefix => ({
  src_path: `${prefix}/a.js`, dst_path: `${prefix}/b.js`, edge_type: 'import', detail: {},
});

beforeAll(async () => {
  pool = (await import('../../../packages/brain/src/db.js')).default;
  await verifyScratchPool(pool);
  // scratch 必须为空注册表；不能覆盖任何既有图快照。
  const existing = await pool.query(
    "SELECT repo FROM graph_edges WHERE repo = ANY($1) UNION ALL SELECT repo FROM fact_snapshot_headers WHERE kind = 'graph' AND repo = ANY($1)", [repos],
  );
  expect(existing.rows).toEqual([]);
  for (const repo of repos) {
    await replaceRepoEdges(pool, repo, [edge(repo)]);
    seeded.push(repo);
  }
  const routes = await import('../../../packages/brain/src/routes/graph.js');
  loadGraphContext = routes.loadGraphContext;
  app = express();
  app.use(express.json());
  app.use('/graph', routes.default);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
});

afterAll(async () => {
  if (server) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  if (pool) {
    await pool.query('DELETE FROM graph_edges WHERE repo = ANY($1)', [seeded]);
    await pool.query("DELETE FROM fact_snapshot_headers WHERE kind = 'graph' AND repo = ANY($1)", [seeded]);
    await pool.end();
  }
});

describe('graph repo 参数的真实行为', () => {
  it.each(repos)('读取 %s 的精确节点集合，不泄漏其他仓库', async repo => {
    const ctx = await loadGraphContext(repo);
    expect([...ctx.nodeSet].sort()).toEqual([`${repo}/a.js`, `${repo}/b.js`]);
    expect(ctx.freshness.repo).toBe(repo);
  });

  it('默认 repo 实际读取 cecelia 图', async () => {
    const ctx = await loadGraphContext();
    expect([...ctx.nodeSet].sort()).toEqual(['cecelia/a.js', 'cecelia/b.js']);
    expect(ctx.freshness.repo).toBe('cecelia');
  });

  it('不存在的仓库返回空图', async () => {
    const ctx = await loadGraphContext('debt-12-absent');
    expect([...ctx.nodeSet]).toEqual([]);
    expect(ctx.freshness.repo).toBe('debt-12-absent');
  });

  it('GET locate query repo 传递至真实读取器', async () => {
    const response = await request(server).get('/graph/locate').query({ q: 'a.js', repo: 'debt-12-beta' });
    expect(response.status).toBe(200);
    expect(response.body.files).toEqual(['debt-12-beta/a.js']);
    expect(response.body.freshness.repo).toBe('debt-12-beta');
  });

  it('POST radius body repo 决定实际波及节点', async () => {
    const response = await request(server).post('/graph/radius').send({ files: ['debt-12-alpha/b.js'], repo: 'debt-12-alpha' });
    expect(response.status).toBe(200);
    expect(response.body.freshness.repo).toBe('debt-12-alpha');
    expect(response.body.input_files).toEqual(['debt-12-alpha/b.js']);
    expect(response.body.reached_count).toBe(2);
    expect(JSON.stringify(response.body)).not.toContain('debt-12-beta/');
  });

  it('anchor-coverage query repo 进入响应账龄', async () => {
    const response = await request(server).get('/graph/anchor-coverage').query({ repo: 'debt-12-beta' });
    expect(response.status).toBe(200);
    expect(response.body.freshness.repo).toBe('debt-12-beta');
  });
});
