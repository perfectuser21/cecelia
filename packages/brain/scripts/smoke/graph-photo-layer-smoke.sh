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

# [1] graph_edges 表存在（migration 351 生效）
echo ""
echo "检查 graph_edges 表结构..."
COLS=$(psql -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='graph_edges'" 2>/dev/null | tr -d ' ') || COLS="0"
if [ "${COLS:-0}" -ge 7 ]; then
  ok "graph_edges 表存在 (${COLS} 列)"
else
  fail "graph_edges 表缺失或列不全 (${COLS} 列)"
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
