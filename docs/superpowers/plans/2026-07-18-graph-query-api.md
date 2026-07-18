# 刀A2 索引服务五查询端点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /api/brain/graph 五端点(locate/related/radius/island-check/claim-status),BFS 纯函数 + 锚点三态 + 账龄。

**Architecture:** 纯函数进 lib/graph-query.js(零 IO);路由进 routes/graph.js(直接 import db.js 的 pool,与 registry.js 同款);server.js 一行挂载。无 migration。

**Tech Stack:** Node ESM、express、pg、vitest+supertest(mock 装配照 routes/__tests__/claim-protocol.test.js:10-63)。

## Global Constraints

- spec:`docs/superpowers/specs/2026-07-18-graph-query-api-design.md`(锚点三态/端点表/诚实呈现稀疏)
- TDD:每 task commit-1 Red / commit-2 Green;commit message 简体中文尾注 [972402fb]
- **禁止任何测试写 journey_features**(Notion push 副作用);integration 只插 graph_edges 且 src/dst 带 `itest-gq/` 前缀,afterAll 按前缀删
- lint-test-pairing:graph-query.js 与 graph.js 各配同目录 __tests__ 同名 test 且 import 被测模块
- route 测试 mock `../../db.js` 的 default pool(否则打不中);POST 端点测试需 app.use(express.json())
- 测试命令 `cd packages/brain && npx vitest run <path>`;smoke 禁 jq;禁起新 Brain 实例
- graph_edges 空表时所有端点返回空结果 + freshness.stale:true,不抛错

---

### Task 1: 纯函数层 graph-query.js

**Files:**
- Create: `packages/brain/src/lib/graph-query.js`
- Test: `packages/brain/src/lib/__tests__/graph-query.test.js`

**Interfaces(Produces,后续 task 逐字依赖):**
- `normalizePath(p) → string`(去开头 ./ 与重复斜杠)
- `buildAdjacency(edges[{src_path,dst_path,edge_type}]) → {fwd: Map<src,[{dst,edge_type}]>, rev: Map<dst,[{src,edge_type}]>}`
- `reachable(adj, startPaths[], {dir:'fwd'|'rev', maxDepth=10}) → Set<path>`(含起点,环安全)
- `matchAnchor(anchorPath, nodePathsSet) → string|null`(精确→后缀双向,最长命中,同长取字典序小)
- `classifyFeatureAnchors(featureRows, nodePathsSet) → [{feature_id,name,anchors:[{field,path,matched_node}],status:'covered'|'uncovered'|'unanchored'}]`(锚点字段序:unit_test_path/workflow_ref/guard_ref)
- `isTestPath(p) → bool`(__tests__/ 或 .test. 或 .spec. 或 tests/ 段)

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/lib/__tests__/graph-query.test.js
import { describe, it, expect } from 'vitest';
import {
  normalizePath, buildAdjacency, reachable, matchAnchor, classifyFeatureAnchors, isTestPath,
} from '../graph-query.js';

const EDGES = [
  { src_path: 'a.js', dst_path: 'b.js', edge_type: 'import' },
  { src_path: 'b.js', dst_path: 'c.js', edge_type: 'import' },
  { src_path: './t/__tests__/x.test.js', dst_path: 'b.js', edge_type: 'import' },
  { src_path: 'c.js', dst_path: 'a.js', edge_type: 'spawn' }, // 环 a→b→c→a
];

describe('normalizePath', () => {
  it('去开头 ./ 与重复斜杠', () => {
    expect(normalizePath('./x//y.js')).toBe('x/y.js');
    expect(normalizePath('a/b.js')).toBe('a/b.js');
  });
});

describe('buildAdjacency + reachable', () => {
  const adj = buildAdjacency(EDGES);

  it('fwd 邻接含 edge_type', () => {
    expect(adj.fwd.get('a.js')).toEqual([{ dst: 'b.js', edge_type: 'import' }]);
  });

  it('rev 方向:谁依赖 b.js', () => {
    const srcs = adj.rev.get('b.js').map((e) => e.src).sort();
    expect(srcs).toEqual(['a.js', 't/__tests__/x.test.js']);
  });

  it('rev BFS 从 c.js:含起点,穿环安全终止', () => {
    const r = reachable(adj, ['c.js'], { dir: 'rev', maxDepth: 10 });
    expect(r.has('c.js')).toBe(true);
    expect(r.has('b.js')).toBe(true);
    expect(r.has('a.js')).toBe(true);
    expect(r.has('t/__tests__/x.test.js')).toBe(true);
  });

  it('maxDepth=1 只到一跳', () => {
    const r = reachable(adj, ['c.js'], { dir: 'rev', maxDepth: 1 });
    expect(r.has('b.js')).toBe(true);
    expect(r.has('a.js')).toBe(false);
  });

  it('fwd BFS 从 a.js 到 c.js', () => {
    const r = reachable(adj, ['a.js'], { dir: 'fwd', maxDepth: 10 });
    expect(r.has('c.js')).toBe(true);
  });
});

describe('matchAnchor', () => {
  const nodes = new Set(['packages/brain/src/x.js', 'services/agent/pub/y.js', 'src/x.js']);

  it('精确命中优先', () => {
    expect(matchAnchor('src/x.js', nodes)).toBe('src/x.js');
  });

  it('锚点短路径后缀匹配到最长节点', () => {
    expect(matchAnchor('brain/src/x.js', nodes)).toBe('packages/brain/src/x.js');
  });

  it('节点短于锚点也可反向后缀匹配', () => {
    expect(matchAnchor('repo-root/services/agent/pub/y.js', nodes)).toBe('services/agent/pub/y.js');
  });

  it('不匹配返回 null(zenithjoy 锚点场景)', () => {
    expect(matchAnchor('publishers/douyin/pub.js', nodes)).toBeNull();
  });
});

describe('classifyFeatureAnchors 三态', () => {
  const nodes = new Set(['packages/brain/src/x.js']);
  const rows = [
    { id: '1', name: 'covered 的', unit_test_path: 'packages/brain/src/x.js', workflow_ref: null, guard_ref: null },
    { id: '2', name: 'uncovered 的', unit_test_path: null, workflow_ref: 'publishers/douyin/p.js', guard_ref: null },
    { id: '3', name: 'unanchored 的', unit_test_path: null, workflow_ref: null, guard_ref: null },
  ];

  it('三态正确且 anchors 结构齐', () => {
    const c = classifyFeatureAnchors(rows, nodes);
    expect(c[0].status).toBe('covered');
    expect(c[0].anchors[0]).toEqual({ field: 'unit_test_path', path: 'packages/brain/src/x.js', matched_node: 'packages/brain/src/x.js' });
    expect(c[1].status).toBe('uncovered');
    expect(c[1].anchors[0].matched_node).toBeNull();
    expect(c[2].status).toBe('unanchored');
    expect(c[2].anchors).toEqual([]);
  });
});

describe('isTestPath', () => {
  it('四种测试路径形态', () => {
    expect(isTestPath('a/__tests__/x.test.js')).toBe(true);
    expect(isTestPath('a/x.test.ts')).toBe(true);
    expect(isTestPath('a/x.spec.js')).toBe(true);
    expect(isTestPath('services/agent/tests/t.py')).toBe(true);
    expect(isTestPath('src/executor.js')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败 → commit-1(Red)**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/graph-query.test.js`(FAIL:模块不存在)

```bash
git add packages/brain/src/lib/__tests__/graph-query.test.js
git commit -m "test(brain): graph-query BFS/锚点匹配/三态失败测试(Red) [972402fb]"
```

- [ ] **Step 3: 实现**

```js
// packages/brain/src/lib/graph-query.js
/**
 * 索引服务纯函数层(刀A2):邻接表/BFS 可达/锚点匹配/三态分类,零 IO。
 * spec: docs/superpowers/specs/2026-07-18-graph-query-api-design.md
 */
const ANCHOR_FIELDS = ['unit_test_path', 'workflow_ref', 'guard_ref'];

export function normalizePath(p) {
  return String(p || '').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

export function buildAdjacency(edges) {
  const fwd = new Map();
  const rev = new Map();
  for (const e of edges) {
    const s = normalizePath(e.src_path);
    const d = normalizePath(e.dst_path);
    if (!fwd.has(s)) fwd.set(s, []);
    fwd.get(s).push({ dst: d, edge_type: e.edge_type });
    if (!rev.has(d)) rev.set(d, []);
    rev.get(d).push({ src: s, edge_type: e.edge_type });
  }
  return { fwd, rev };
}

export function reachable(adj, startPaths, { dir = 'fwd', maxDepth = 10 } = {}) {
  const map = dir === 'fwd' ? adj.fwd : adj.rev;
  const key = dir === 'fwd' ? 'dst' : 'src';
  const seen = new Set(startPaths.map(normalizePath));
  let frontier = [...seen];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const e of map.get(node) || []) {
        const n = e[key];
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

export function matchAnchor(anchorPath, nodePathsSet) {
  const a = normalizePath(anchorPath);
  if (!a) return null;
  if (nodePathsSet.has(a)) return a;
  let best = null;
  for (const node of nodePathsSet) {
    if (node.endsWith('/' + a) || a.endsWith('/' + node)) {
      if (best === null || node.length > best.length || (node.length === best.length && node < best)) {
        best = node;
      }
    }
  }
  return best;
}

export function classifyFeatureAnchors(featureRows, nodePathsSet) {
  return featureRows.map((f) => {
    const anchors = [];
    for (const field of ANCHOR_FIELDS) {
      if (f[field]) {
        anchors.push({ field, path: f[field], matched_node: matchAnchor(f[field], nodePathsSet) });
      }
    }
    let status = 'unanchored';
    if (anchors.length > 0) {
      status = anchors.some((a) => a.matched_node) ? 'covered' : 'uncovered';
    }
    return { feature_id: f.id, name: f.name, anchors, status };
  });
}

export function isTestPath(p) {
  const n = normalizePath(p);
  return /(^|\/)__tests__\//.test(n) || /\.test\./.test(n) || /\.spec\./.test(n) || /(^|\/)tests\//.test(n);
}
```

- [ ] **Step 4: 跑测试全绿 → commit-2(Green)**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/graph-query.test.js`(14 passed)

```bash
git add packages/brain/src/lib/graph-query.js
git commit -m "feat(brain): graph-query 纯函数层——BFS/锚点匹配/三态(Green) [972402fb]"
```

---

### Task 2: 路由 graph.js——locate / related / claim-status

**Files:**
- Create: `packages/brain/src/routes/graph.js`
- Test: `packages/brain/src/routes/__tests__/graph.test.js`

**Interfaces:**
- Consumes: Task 1 全部导出;lib/registry-freshness.js 的 computeFreshness;db.js default pool
- Produces: Router(GET /locate、GET /related、GET /claim-status;Task 3 在同文件加两个 POST)

- [ ] **Step 1: 写失败测试(mock 装配照 claim-protocol.test.js:10-63)**

```js
// packages/brain/src/routes/__tests__/graph.test.js
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
```

- [ ] **Step 2: 跑测试确认失败 → commit-1(Red)**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/graph.test.js`(FAIL)

```bash
git add packages/brain/src/routes/__tests__/graph.test.js
git commit -m "test(brain): graph 路由 locate/related/claim-status 失败测试(Red) [972402fb]"
```

- [ ] **Step 3: 实现路由(含公共装配与认领机)**

```js
// packages/brain/src/routes/graph.js
/**
 * 索引服务查询端点(刀A2):/api/brain/graph/*
 * locate(定位)/related(找相关)/radius(波及)/island-check(无主检查)/claim-status(认领状态)
 * 零 LLM 纯机械;每响应带账龄(computeFreshness)与锚点覆盖率。
 * spec: docs/superpowers/specs/2026-07-18-graph-query-api-design.md
 */
import { Router } from 'express';
import pool from '../db.js';
import { computeFreshness } from '../lib/registry-freshness.js';
import {
  normalizePath, buildAdjacency, reachable, classifyFeatureAnchors, isTestPath,
} from '../lib/graph-query.js';

const router = Router();
const REPO = 'cecelia';
const CLAIM_DEPTH = 10;

async function loadGraphContext() {
  const { rows: edges } = await pool.query(
    `SELECT src_path, dst_path, edge_type FROM graph_edges WHERE repo = $1`, [REPO]);
  const { rows: fr } = await pool.query(
    `SELECT max(scanned_at) AS latest FROM graph_edges WHERE repo = $1`, [REPO]);
  const { rows: features } = await pool.query(
    `SELECT id, name, unit_test_path, workflow_ref, guard_ref FROM journey_features`);
  const adj = buildAdjacency(edges);
  const nodeSet = new Set([...adj.fwd.keys(), ...adj.rev.keys()]);
  const classified = classifyFeatureAnchors(features, nodeSet);
  const anchor_coverage = {
    total_features: classified.length,
    anchored: classified.filter((c) => c.status !== 'unanchored').length,
    covered_by_graph: classified.filter((c) => c.status === 'covered').length,
  };
  return { adj, nodeSet, classified, anchor_coverage, freshness: computeFreshness(fr[0]?.latest ?? null) };
}

async function promisesForFeatures(featureIds) {
  if (featureIds.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT l.feature_id, s.name AS step_name, s.promise, j.name AS journey_name
     FROM journey_step_links l
     JOIN journey_steps s ON s.id = l.step_id
     JOIN journeys j ON j.id = s.journey_id
     WHERE l.feature_id = ANY($1)`, [featureIds]);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.feature_id)) map.set(r.feature_id, []);
    map.get(r.feature_id).push({ step_name: r.step_name, promise: r.promise, journey_name: r.journey_name });
  }
  return map;
}

// covered 锚点的认领域(双向可达),island-check/claim-status 共用
function buildClaimZones(ctx) {
  const zones = [];
  for (const c of ctx.classified) {
    if (c.status !== 'covered') continue;
    const nodes = c.anchors.filter((a) => a.matched_node).map((a) => a.matched_node);
    const zone = new Set([
      ...reachable(ctx.adj, nodes, { dir: 'fwd', maxDepth: CLAIM_DEPTH }),
      ...reachable(ctx.adj, nodes, { dir: 'rev', maxDepth: CLAIM_DEPTH }),
    ]);
    zones.push({ feature_id: c.feature_id, name: c.name, zone });
  }
  return zones;
}

function claimVerdict(p, ctx, zones) {
  const claimed_by = zones.filter((z) => z.zone.has(p)).map((z) => ({ feature_id: z.feature_id, name: z.name }));
  const in_graph = ctx.nodeSet.has(p);
  const verdict = claimed_by.length > 0 ? 'claimed' : in_graph ? 'connected_unclaimed' : 'isolated';
  return { in_graph, verdict, claimed_by };
}

router.get('/locate', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing required param: q' });
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const ctx = await loadGraphContext();
    const ql = q.toLowerCase();
    const features = ctx.classified.filter((c) => c.name.toLowerCase().includes(ql)).slice(0, limit);
    const promiseMap = await promisesForFeatures(features.map((f) => f.feature_id));
    const files = [...ctx.nodeSet].filter((p) => p.toLowerCase().includes(ql)).sort().slice(0, limit);
    return res.json({
      q,
      features: features.map((f) => ({ ...f, promises: promiseMap.get(f.feature_id) || [] })),
      files,
      freshness: ctx.freshness,
      anchor_coverage: ctx.anchor_coverage,
    });
  } catch (err) {
    console.error('[graph] locate error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/related', async (req, res) => {
  try {
    const raw = String(req.query.path || '').trim();
    if (!raw) return res.status(400).json({ error: 'Missing required param: path' });
    const p = normalizePath(raw);
    const ctx = await loadGraphContext();
    const dependencies = (ctx.adj.fwd.get(p) || []).map((e) => ({ path: e.dst, edge_type: e.edge_type }));
    const dependents = (ctx.adj.rev.get(p) || []).map((e) => ({ path: e.src, edge_type: e.edge_type }));
    const claimedFeatures = ctx.classified.filter((c) => c.anchors.some((a) => a.matched_node === p));
    let step_siblings = [];
    const ids = claimedFeatures.map((c) => c.feature_id);
    if (ids.length > 0) {
      const { rows } = await pool.query(
        `SELECT DISTINCT l2.feature_id, f.name
         FROM journey_step_links l1
         JOIN journey_step_links l2 ON l2.step_id = l1.step_id AND l2.feature_id IS NOT NULL
         JOIN journey_features f ON f.id = l2.feature_id
         WHERE l1.feature_id = ANY($1) AND NOT (l2.feature_id = ANY($1))`, [ids]);
      step_siblings = rows;
    }
    return res.json({
      path: p,
      in_graph: ctx.nodeSet.has(p),
      dependencies,
      dependents,
      claimed_by: claimedFeatures.map((c) => ({ feature_id: c.feature_id, name: c.name })),
      step_siblings,
      freshness: ctx.freshness,
    });
  } catch (err) {
    console.error('[graph] related error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/claim-status', async (req, res) => {
  try {
    const raw = String(req.query.path || '').trim();
    if (!raw) return res.status(400).json({ error: 'Missing required param: path' });
    const p = normalizePath(raw);
    const ctx = await loadGraphContext();
    const zones = buildClaimZones(ctx);
    const v = claimVerdict(p, ctx, zones);
    return res.json({ path: p, claimed: v.verdict === 'claimed', ...v, freshness: ctx.freshness });
  } catch (err) {
    console.error('[graph] claim-status error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 4: 跑测试全绿 → commit-2(Green)**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/graph.test.js`(9 passed)

```bash
git add packages/brain/src/routes/graph.js
git commit -m "feat(brain): graph 路由 locate/related/claim-status(Green) [972402fb]"
```

---

### Task 3: radius + island-check + server.js 挂载

**Files:**
- Modify: `packages/brain/src/routes/graph.js`(追加两个 POST,复用 loadGraphContext/buildClaimZones/claimVerdict/promisesForFeatures)
- Modify: `packages/brain/src/routes/__tests__/graph.test.js`(追加两个 describe)
- Modify: `packages/brain/server.js`(import 区加 `import graphRoutes from './src/routes/graph.js';`;250 行附近挂载区加 `app.use('/api/brain/graph', graphRoutes);`)

**Interfaces:**
- Consumes: Task 2 的公共装配
- Produces: POST /radius、POST /island-check(shape 见下测试)

- [ ] **Step 1: 追加失败测试(Red)**

```js
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
```

Run 确认恰好新增用例红,commit-1:

```bash
git add packages/brain/src/routes/__tests__/graph.test.js
git commit -m "test(brain): graph 路由 radius/island-check 失败测试(Red) [972402fb]"
```

- [ ] **Step 2: 实现两个 POST(追加到 graph.js,export default 之前)**

```js
router.post('/radius', async (req, res) => {
  try {
    const files = req.body && req.body.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files must be a non-empty array' });
    }
    const maxDepth = Math.min(Math.max(parseInt(req.body.max_depth) || 10, 1), 20);
    const ctx = await loadGraphContext();
    const norm = files.map(normalizePath);
    const reached = reachable(ctx.adj, norm, { dir: 'rev', maxDepth });
    const affected_tests = [...reached].filter(isTestPath).sort();
    const affected = ctx.classified.filter((c) =>
      c.anchors.some((a) => a.matched_node && reached.has(a.matched_node)));
    const promiseMap = await promisesForFeatures(affected.map((f) => f.feature_id));
    return res.json({
      input_files: norm,
      reached_count: reached.size,
      affected_tests,
      affected_features: affected.map((f) => ({
        feature_id: f.feature_id, name: f.name, anchors: f.anchors,
        promises: promiseMap.get(f.feature_id) || [],
      })),
      uncovered_anchor_features: ctx.classified.filter((c) => c.status === 'uncovered').length,
      freshness: ctx.freshness,
    });
  } catch (err) {
    console.error('[graph] radius error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/island-check', async (req, res) => {
  try {
    const files = req.body && req.body.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files must be a non-empty array' });
    }
    const ctx = await loadGraphContext();
    const zones = buildClaimZones(ctx);
    const results = files.map((raw) => {
      const p = normalizePath(raw);
      const v = claimVerdict(p, ctx, zones);
      return { file: p, ...v };
    });
    return res.json({ results, freshness: ctx.freshness, anchor_coverage: ctx.anchor_coverage });
  } catch (err) {
    console.error('[graph] island-check error:', err);
    return res.status(500).json({ error: err.message });
  }
});
```

注:radius 的 reached 含起点(reachable 语义),锚点 matched_node ∈ reached 已覆盖"改的就是锚点文件"场景。

- [ ] **Step 3: server.js 挂载**(import 区一行 + app.use('/api/brain/graph', graphRoutes) 挂载区一行,照 250 行附近现有风格)

- [ ] **Step 4: 全绿 + node --check server.js → commit-2(Green)**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/graph.test.js && node --check server.js`(14 passed;syntax OK)

```bash
git add packages/brain/src/routes/graph.js packages/brain/src/routes/__tests__/graph.test.js packages/brain/server.js
git commit -m "feat(brain): graph 路由 radius/island-check + server 挂载(Green) [972402fb]"
```

---

### Task 4: integration + smoke

**Files:**
- Create: `packages/brain/src/__tests__/integration/graph-query.integration.test.js`
- Create: `packages/brain/scripts/smoke/graph-query-api-smoke.sh`(框架照 graph-photo-layer-smoke.sh)
- Modify: `packages/quality/smoke-allowlist.txt`(追加一行)

- [ ] **Step 1: integration(真库,DB_DEFAULTS;只插 graph_edges 的 itest-gq/ 前缀边,严禁碰 journey_features)**

```js
// packages/brain/src/__tests__/integration/graph-query.integration.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { buildAdjacency, reachable, isTestPath } from '../../lib/graph-query.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const PFX = 'itest-gq/';

beforeAll(async () => {
  await pool.query(`DELETE FROM graph_edges WHERE src_path LIKE $1 OR dst_path LIKE $1`, [`${PFX}%`]);
  await pool.query(
    `INSERT INTO graph_edges (repo, src_path, dst_path, edge_type) VALUES
     ('cecelia', '${PFX}a.js', '${PFX}b.js', 'import'),
     ('cecelia', '${PFX}__tests__/t.test.js', '${PFX}b.js', 'import')`);
});

afterAll(async () => {
  await pool.query(`DELETE FROM graph_edges WHERE src_path LIKE $1 OR dst_path LIKE $1`, [`${PFX}%`]);
  await pool.end();
});

describe('graph-query 真库链路', () => {
  it('真库边 → 邻接 → rev BFS → 测试文件识别', async () => {
    const { rows } = await pool.query(
      `SELECT src_path, dst_path, edge_type FROM graph_edges WHERE src_path LIKE $1 OR dst_path LIKE $1`,
      [`${PFX}%`]);
    expect(rows.length).toBe(2);
    const adj = buildAdjacency(rows);
    const reached = reachable(adj, [`${PFX}b.js`], { dir: 'rev', maxDepth: 5 });
    expect(reached.has(`${PFX}a.js`)).toBe(true);
    expect([...reached].filter(isTestPath)).toEqual([`${PFX}__tests__/t.test.js`]);
  });
});
```

- [ ] **Step 2: 跑 integration**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/graph-query.integration.test.js`(1 passed)

- [ ] **Step 3: smoke(框架照 graph-photo-layer-smoke.sh:set -uo pipefail 同款计数/ROOT 定位)**

断言两条:
1. 离线 BFS:`node --input-type=module -e` 调 buildAdjacency+reachable 对内联 fixture(a→b→c)断言 rev 从 c 可达 a,错则 exit 1
2. 活端点 shape(空库安全):`curl -sf "${BRAIN_URL}/api/brain/graph/claim-status?path=smoke-nonexistent.js"` → node 解析断言含 `claimed`(布尔)与 `freshness` 字段

- [ ] **Step 4: 本地验证 + allowlist + Commit**

Run: `bash -n packages/brain/scripts/smoke/graph-query-api-smoke.sh && bash packages/brain/scripts/smoke/graph-query-api-smoke.sh`;活端点断言的 SKIP 判据(本地生产 brain 是旧版没有 /graph):**HTTP 404 或连不上 → SKIP+WARN 不算 FAIL;其余状态码 → 正常断言 shape**。CI 里 brain 容器从 PR 源码 build,/graph 存在,断言真跑。本地预期:离线断言 PASS + 活端点 SKIP

```bash
git add packages/brain/src/__tests__/integration/graph-query.integration.test.js packages/brain/scripts/smoke/graph-query-api-smoke.sh packages/quality/smoke-allowlist.txt
git commit -m "test(brain): graph-query 真库链路 integration + 端点 smoke [972402fb]"
```

---

### Task 5: 版本 bump + learning + DevGate

**Files:**
- Modify: `packages/brain/package.json`(1.267.5 → 1.267.6)+ check-version-sync.sh 指出的同步处
- Create: `docs/learnings/cp-07181704-graph-query-api.md`

- [ ] **Step 1: bump 后 `bash scripts/check-version-sync.sh` 补到 exit 0**

- [ ] **Step 2: DevGate 三件全过**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`(三条 exit 0)

- [ ] **Step 3: learning**

```markdown
# Learning: 刀A2 索引服务五查询端点

### 根本原因
图(刀A1)只是数据,AI 用不上——缺"开工问路/波及点名/认领判据"的机械查询面。锚点大多指向 zenithjoy-workspace(本仓图罩不住),端点必须三态诚实(covered/uncovered/unanchored),否则会拿半张图冒充全图。

### 下次预防
- [ ] 半覆盖数据做查询服务必须显式呈现覆盖率与三态,禁把 unmatched 静默当不存在(假阴性)
- [ ] journey_features 有 Notion 自动 push,任何测试禁往里插行——语义表的测试一律 fixture 行走单测
- [ ] 查询端点对空数据源必须优雅(空结果+stale 标记),CI smoke 依赖此行为
```

- [ ] **Step 4: 全量回归(前台,预算 12 分钟)**

Run: `cd packages/brain && npx vitest run --exclude='src/__tests__/integration/**' 2>&1 | tail -4`(与基线比无新红;既有红 8-9 文件)

- [ ] **Step 5: Commit**

```bash
git add packages/brain/package.json docs/learnings/cp-07181704-graph-query-api.md
# 加 check-version-sync 要求的其他文件
git commit -m "chore(brain): bump 1.267.6 + 刀A2 learning——索引服务五查询端点 [972402fb]"
```

---

## 合并后手动步骤(本 session 收尾执行)

1. Gate3 部署 1.267.6 后生产终验:
   - `curl -s -X POST localhost:5221/api/brain/graph/radius -H 'Content-Type: application/json' -d '{"files":["packages/brain/src/executor.js"]}'` → reached_count>0 且 affected_tests 非空
   - `curl -s 'localhost:5221/api/brain/graph/claim-status?path=packages/brain/src/__tests__/integration/blast-radius.integration.test.js'` → claimed:true(CRM 表底座锚点,本仓唯一 covered 种子)
   - `curl -s 'localhost:5221/api/brain/graph/locate?q=抖音'` → features 非空(uncovered 态,诚实呈现)
