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
const CLAIM_DEPTH = 10;

export async function loadGraphContext(repo = 'cecelia') {
  const { rows: edges } = await pool.query(
    `SELECT src_path, dst_path, edge_type FROM graph_edges WHERE repo = $1`, [repo]);
  const { rows: fr } = await pool.query(
    `SELECT repo, scanned_at, source_revision, scanner_version
       FROM graph_edges
      WHERE repo = $1
      ORDER BY scanned_at DESC
      LIMIT 1`, [repo]);
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
  return {
    adj, nodeSet, classified, anchor_coverage,
    freshness: { repo, ...computeFreshness(fr[0] ?? null) },
  };
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
    const repo = String(req.query.repo || 'cecelia');
    const ctx = await loadGraphContext(repo);
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
    const repo = String(req.query.repo || 'cecelia');
    const ctx = await loadGraphContext(repo);
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
    const repo = String(req.query.repo || 'cecelia');
    const ctx = await loadGraphContext(repo);
    const zones = buildClaimZones(ctx);
    const v = claimVerdict(p, ctx, zones);
    return res.json({ path: p, claimed: v.verdict === 'claimed', ...v, freshness: ctx.freshness });
  } catch (err) {
    console.error('[graph] claim-status error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/radius', async (req, res) => {
  try {
    // 兼容 file（singular）和 files（array）两种 payload 格式
    const raw = req.body;
    const files = Array.isArray(raw?.files) ? raw.files
      : (raw?.file ? [raw.file] : null);
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'files must be a non-empty array' });
    }
    const rawDepth = req.body.max_depth == null ? 10 : parseInt(req.body.max_depth);
    const maxDepth = Math.min(Math.max(Number.isNaN(rawDepth) ? 10 : rawDepth, 1), 20);
    const repo = String(req.body.repo || 'cecelia');
    const ctx = await loadGraphContext(repo);
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
    const repo = String(req.body.repo || 'cecelia');
    const ctx = await loadGraphContext(repo);
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

// GET /api/brain/graph/anchor-coverage — 全量锚点覆盖率(nightly 断锚哨兵消费)
router.get('/anchor-coverage', async (req, res) => {
  try {
    const repo = String(req.query.repo || 'cecelia');
    const { anchor_coverage, freshness } = await loadGraphContext(repo);
    const broken = anchor_coverage.total_features - anchor_coverage.covered_by_graph;
    res.json({ anchor_coverage, freshness, broken });
  } catch (err) {
    console.error('[graph] GET /anchor-coverage error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
