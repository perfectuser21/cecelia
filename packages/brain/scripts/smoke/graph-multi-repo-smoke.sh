#!/usr/bin/env bash
# graph-multi-repo-smoke.sh — 多仓库扫描扩展验收(Task 85806b9a,2026-07-20)
#
# 验收项：
# [1] scan-graph.mjs 不再有硬编码 const REPO = 'cecelia'
# [2] scan-graph.mjs 导出 REPOS 清单，含三仓
# [3] scan-graph.mjs 导出 scanRepo 或 scanRepoList
# [4] routes/graph.js 不再有 const REPO = 'cecelia' 常量
# [5] routes/graph.js 从 req.query.repo 读取 repo（GET 端点）
# [6] routes/graph.js 从 req.body.repo 读取 repo（POST 端点）
# [7] routes/graph.js 的 loadGraphContext 被调用时传入 repo 变量
set -uo pipefail

PASS=0
FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── graph-multi-repo-smoke ──"

# 定位 repo root（脚本在 packages/brain/scripts/smoke/ 下，需要向上 3 级）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

SCAN_FILE="scripts/scan/scan-graph.mjs"
ROUTE_FILE="packages/brain/src/routes/graph.js"

# [1] scan-graph.mjs 不再有硬编码 const REPO = 'cecelia'
echo ""
echo "检查 scan-graph.mjs 无硬编码 REPO ..."
if ! grep -q "^const REPO = 'cecelia'" "$SCAN_FILE" 2>/dev/null; then
  ok "scan-graph.mjs 无硬编码 const REPO = 'cecelia'"
else
  fail "scan-graph.mjs 仍有硬编码 const REPO = 'cecelia'"
fi

# [2] scan-graph.mjs 导出 REPOS 清单含三仓
echo ""
echo "检查 scan-graph.mjs REPOS 清单..."
if grep -q "zenithjoy-workspace" "$SCAN_FILE" && grep -q "zenithjoy-skills" "$SCAN_FILE" && grep -q "REPO_ROOT_CECELIA" "$SCAN_FILE"; then
  ok "scan-graph.mjs 含三仓清单（cecelia/zenithjoy-workspace/zenithjoy-skills）及环境变量"
else
  fail "scan-graph.mjs 缺少三仓清单或环境变量"
fi

# [3] scan-graph.mjs 导出 scanRepo / scanRepoList（JavaScript 静态验证）
echo ""
echo "检查 scan-graph.mjs 导出 scanRepo/scanRepoList ..."
if grep -qE "^export (async )?function (scanRepo|scanRepoList)" "$SCAN_FILE" && \
   grep -qE "^export const REPOS" "$SCAN_FILE"; then
  ok "scan-graph.mjs 导出 scanRepo/scanRepoList，REPOS 三仓完整"
else
  fail "scan-graph.mjs 导出或 REPOS 清单有问题"
fi

# [4] routes/graph.js 无 const REPO = 'cecelia' 常量
echo ""
echo "检查 routes/graph.js 无硬编码 REPO 常量..."
if ! grep -q "const REPO = 'cecelia'" "$ROUTE_FILE" 2>/dev/null; then
  ok "routes/graph.js 无硬编码 const REPO = 'cecelia'"
else
  fail "routes/graph.js 仍有硬编码 const REPO = 'cecelia'"
fi

# [5] routes/graph.js GET 端点从 req.query.repo 读取
echo ""
echo "检查 routes/graph.js req.query.repo ..."
if grep -q "req\.query\.repo" "$ROUTE_FILE" 2>/dev/null; then
  ok "routes/graph.js 含 req.query.repo（GET 端点）"
else
  fail "routes/graph.js 缺少 req.query.repo"
fi

# [6] routes/graph.js POST 端点从 req.body.repo 读取
echo ""
echo "检查 routes/graph.js req.body.repo ..."
if grep -q "req\.body\.repo" "$ROUTE_FILE" 2>/dev/null; then
  ok "routes/graph.js 含 req.body.repo（POST 端点）"
else
  fail "routes/graph.js 缺少 req.body.repo"
fi

# [7] loadGraphContext 被传入 repo 变量调用
echo ""
echo "检查 loadGraphContext(repo) 调用方式..."
if grep -qE "loadGraphContext\(\s*repo\s*\)" "$ROUTE_FILE" 2>/dev/null; then
  ok "loadGraphContext 以 repo 变量调用（非硬编码字符串）"
else
  fail "loadGraphContext 未以 repo 变量调用"
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
