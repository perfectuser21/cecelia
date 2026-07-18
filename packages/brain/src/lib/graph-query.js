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
