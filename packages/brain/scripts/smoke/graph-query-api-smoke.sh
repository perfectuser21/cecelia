#!/usr/bin/env bash
# graph-query-api-smoke.sh — 索引服务五查询端点验收(刀A2 Task 4,2026-07-18)
#
# 验收项：
# [1] 离线 BFS：buildAdjacency + reachable 对内联 fixture(a→b→c)断言 rev 从 c 可达 a
# [2] 活端点 shape(空库安全)：GET /api/brain/graph/claim-status 返回含 claimed(布尔)+freshness
#     SKIP 判据：HTTP 404 或连不上 → SKIP+WARN 不算 FAIL（本地生产 brain 可能是旧版没有 /graph）；
#     其余状态码 → 正常断言 shape。CI 里 brain 容器从 PR 源码 build，/graph 存在，断言真跑。
set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

PASS=0
FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
warn() { echo "  ⚠️  $1"; }

echo "── graph-query-api-smoke ──"

# 定位 repo root（脚本在 packages/brain/scripts/smoke/ 下，需要向上 3 级）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

# [1] 离线 BFS（纯逻辑，零依赖）
echo ""
echo "检查离线 BFS(buildAdjacency + reachable)..."
if node --input-type=module -e "
import { buildAdjacency, reachable } from './packages/brain/src/lib/graph-query.js';
const edges = [
  { src_path: 'a.js', dst_path: 'b.js', edge_type: 'import' },
  { src_path: 'b.js', dst_path: 'c.js', edge_type: 'import' },
];
const adj = buildAdjacency(edges);
const reached = reachable(adj, ['c.js'], { dir: 'rev', maxDepth: 5 });
if (!reached.has('a.js')) {
  console.error('rev BFS 未能从 c.js 可达 a.js', JSON.stringify([...reached]));
  process.exit(1);
}
console.log('离线 BFS OK');
" 2>/dev/null; then
  ok "离线 BFS 正确(rev 从 c 可达 a)"
else
  fail "离线 BFS 异常"
fi

# [2] 活端点 shape(空库安全)
echo ""
echo "检查活端点 /api/brain/graph/claim-status ..."
http_code=$(curl -s -o /tmp/graph-query-api-smoke-resp.json -w "%{http_code}" \
  "${BRAIN_URL}/api/brain/graph/claim-status?path=smoke-nonexistent.js" 2>/dev/null || echo "000")

if [ "$http_code" = "404" ] || [ "$http_code" = "000" ]; then
  warn "端点不可用(HTTP ${http_code})，本地生产 brain 可能是旧版没有 /graph — SKIP"
elif node -e "
    const fs = require('fs');
    let j;
    try { j = JSON.parse(fs.readFileSync('/tmp/graph-query-api-smoke-resp.json', 'utf8')); }
    catch (e) { console.error('非法 JSON'); process.exit(1); }
    if (typeof j.claimed !== 'boolean') { console.error('claimed 不是布尔'); process.exit(1); }
    if (!('freshness' in j)) { console.error('freshness 字段缺失'); process.exit(1); }
    console.log('OK: claim-status shape 正确');
  " 2>/dev/null; then
  ok "活端点 claim-status shape 正确(claimed 布尔 + freshness)"
else
  fail "活端点 claim-status shape 异常(HTTP ${http_code})"
fi
rm -f /tmp/graph-query-api-smoke-resp.json

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过"
  exit 0
else
  echo "❌ 有 $FAIL 项失败"
  exit 1
fi
