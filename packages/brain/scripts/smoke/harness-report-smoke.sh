#!/usr/bin/env bash
# harness-report-smoke.sh
# 验收：harness-report.mjs CLI 脚本可执行，reportNode 机械回写正常
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. 脚本文件存在
echo "── harness-report.mjs 存在 ──"
[[ -f "packages/brain/scripts/harness-report.mjs" ]] \
  && ok "packages/brain/scripts/harness-report.mjs 存在" \
  || fail "packages/brain/scripts/harness-report.mjs 不存在"

# 2. 缺参数时有错误提示
echo "── CLI 缺参数检测 ──"
OUTPUT=$(node packages/brain/scripts/harness-report.mjs 2>&1 || true)
echo "$OUTPUT" | grep -qiE "task-id|sprint-dir|usage|required|error" \
  && ok "缺参数时有错误提示" \
  || fail "缺参数时无错误提示（output: $OUTPUT）"

# 3. patchFeatureDone 不含 thickness 字段（stale fix）
echo "── stale fix 验证：无 thickness:done ──"
node -e "const c=require('fs').readFileSync('packages/brain/scripts/harness-report.mjs','utf8');if(/thickness.*[\"']done[\"']|[\"']done[\"'].*thickness/.test(c)){process.exit(1);}process.exit(0);" \
  && ok "脚本无 thickness:done stale" \
  || fail "脚本仍含 thickness:done stale"

# 4. reportNode 中有 harness-report 引用（机械段接线）
echo "── reportNode 接线检查 ──"
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('harness-report')){process.exit(1);}process.exit(0);" \
  && ok "reportNode 含 harness-report 引用" \
  || fail "reportNode 未接线 harness-report.mjs"

# 5. 单测文件存在
echo "── vitest 单测文件存在 ──"
[[ -f "packages/brain/src/__tests__/harness-report-script.test.js" ]] \
  && ok "harness-report-script.test.js 存在" \
  || fail "harness-report-script.test.js 不存在"

echo ""
echo "─────────────────────────────────────────────"
echo "✅ $PASS passed | ❌ $FAIL failed"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
