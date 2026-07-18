#!/usr/bin/env bash
# graph-photo-layer-smoke.sh — 图层照相机验收(Task 5,2026-07-18)
#
# 验收项：
# [1] graph_edges 表存在（migration 351 生效），列数 >= 7
# [2] 抽取器离线出边正确（extractSpawnEdges + extractHttpEdges）
set -euo pipefail

PASS=0
FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── graph-photo-layer-smoke ──"

# 定位 repo root（脚本在 packages/brain/scripts/smoke/ 下，需要向上 3 级）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

# [1] migration 351 定义完整（静态断言,环境无关——real-env-smoke 的库不保证迁到最新,
#     活库列数断言会误红;DB 级验证由 brain-integration 的 graph-edges-schema 测试兜底。
#     姊妹先例:promise-map-ledger / guard-ref-bare-fr 均静态断言 migration 文件)
echo ""
echo "检查 migration 351 定义..."
MIG="packages/brain/migrations/351_graph_edges.sql"
if [ -f "$MIG" ] \
  && /usr/bin/grep -q "CREATE TABLE IF NOT EXISTS graph_edges" "$MIG" \
  && /usr/bin/grep -q "edge_type IN ('import', 'spawn', 'http')" "$MIG" \
  && /usr/bin/grep -q "idx_graph_edges_dst" "$MIG"; then
  ok "migration 351 定义完整(表+CHECK+索引)"
else
  fail "migration 351 缺失或定义不全"
fi

# [2] 抽取器离线出边（纯逻辑，零依赖）
echo ""
echo "检查抽取器离线出边..."
if node --input-type=module -e "
import { extractSpawnEdges, extractHttpEdges } from './packages/brain/src/lib/graph-extract.js';
const s = extractSpawnEdges(\"spawn('bash', ['scripts/x.sh'])\", 'f.js');
const h = extractHttpEdges(\"fetch('http://localhost:5221/api/brain/tasks')\", 'f.js');
if (s.length !== 2 || h.length !== 1) {
  console.error('抽取器输出异常', JSON.stringify({spawn: s, http: h}));
  process.exit(1);
}
console.log('抽取器 OK');
" 2>/dev/null; then
  ok "抽取器离线出边正确"
else
  fail "抽取器输出异常"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过"
  exit 0
else
  echo "❌ 有 $FAIL 项失败"
  exit 1
fi
