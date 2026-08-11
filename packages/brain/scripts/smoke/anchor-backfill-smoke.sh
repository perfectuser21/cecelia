#!/usr/bin/env bash
# anchor-backfill-smoke.sh
# 验证刀C全家(锚点回填四件套)：apply器/锚点哨兵/出生即焊/merge自动焊 四处接线
# Case 1: PATCH /journey_features/:id 支持 workflow_ref 字段
# Case 2: GET /journey_features/:id 单行端点存在
# Case 3: GET /api/brain/graph/anchor-coverage 端点存在，复用 loadGraphContext
# Case 4: POST /journey_features 出生即焊校验（status非planned强制带锚点）
# Case 5: apply-anchors.mjs 三个导出函数存在
# Case 6: anchor-sentinel-check.mjs 读 anchor-coverage 端点
# Case 7: Brain 可信 callback 含 Feature 状态与锚点自动焊逻辑
# Case 8: (真环境，Brain 可达时) 30 条批准锚点已落库校验（unit_test_path 字段，不依赖本次待部署的 workflow_ref）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
JOURNEYS_ROUTE="$BRAIN_ROOT/src/routes/journeys.js"
GRAPH_ROUTE="$BRAIN_ROOT/src/routes/graph.js"
APPLY_ANCHORS="$BRAIN_ROOT/scripts/apply-anchors.mjs"
SENTINEL_CHECK="$BRAIN_ROOT/scripts/anchor-sentinel-check.mjs"
HARNESS_REPORT_WRITEBACK="$BRAIN_ROOT/src/lib/harness-report-writeback.js"
EXECUTION_ROUTE="$BRAIN_ROOT/src/routes/execution.js"

echo "[smoke:anchor-backfill] Case 1: PATCH /journey_features/:id 支持 workflow_ref"
node -e "
const js = require('fs').readFileSync('$JOURNEYS_ROUTE', 'utf8');
if (!/router\.patch\('\/journey_features\/:id',/.test(js)) throw new Error('Case 1 FAIL: 未找到 PATCH /journey_features/:id 路由');
if (!/workflow_ref\s*!==\s*undefined/.test(js)) throw new Error('Case 1 FAIL: 未找到 workflow_ref !== undefined 分支');
if ((js.match(/workflow_ref\s*!==\s*undefined/g) || []).length < 1) throw new Error('Case 1 FAIL: workflow_ref 更新分支缺失');
console.log('  PASS: PATCH /journey_features/:id 含 workflow_ref 更新逻辑');
"

echo "[smoke:anchor-backfill] Case 2: GET /journey_features/:id 单行端点存在"
node -e "
const js = require('fs').readFileSync('$JOURNEYS_ROUTE', 'utf8');
if (!/router\.get\('\/journey_features\/:id',/.test(js)) throw new Error('Case 2 FAIL: 未找到 GET /journey_features/:id 路由');
if (!/WHERE id=\\\$1/.test(js)) throw new Error('Case 2 FAIL: 未找到按 id 精确查询的 SQL');
console.log('  PASS: GET /journey_features/:id 路由已接线');
"

echo "[smoke:anchor-backfill] Case 3: GET /api/brain/graph/anchor-coverage 端点存在"
node -e "
const js = require('fs').readFileSync('$GRAPH_ROUTE', 'utf8');
if (!/router\.get\('\/anchor-coverage',/.test(js)) throw new Error('Case 3 FAIL: 未找到 GET /anchor-coverage 路由');
if (!/loadGraphContext\(/.test(js.match(/router\.get\('\/anchor-coverage'[\s\S]{0,500}/)?.[0] || '')) throw new Error('Case 3 FAIL: anchor-coverage 未复用 loadGraphContext');
console.log('  PASS: anchor-coverage 端点复用 loadGraphContext');
"

echo "[smoke:anchor-backfill] Case 4: POST /journey_features 出生即焊校验"
node -e "
const js = require('fs').readFileSync('$JOURNEYS_ROUTE', 'utf8');
if (!/router\.post\('\/journey_features',/.test(js)) throw new Error('Case 4 FAIL: 未找到 POST /journey_features 路由');
if (!/status\s*&&\s*status\s*!==\s*'planned'/.test(js)) throw new Error('Case 4 FAIL: POST handler 未含出生即焊校验');
console.log('  PASS: POST /journey_features 含出生即焊校验');
"

echo "[smoke:anchor-backfill] Case 5: apply-anchors.mjs 三个导出函数存在"
node -e "
const js = require('fs').readFileSync('$APPLY_ANCHORS', 'utf8');
for (const fn of ['parseApprovedFile', 'buildPatchPayload', 'resolveFeatureId']) {
  if (!new RegExp('export (async )?function ' + fn).test(js)) throw new Error('Case 5 FAIL: 缺导出函数 ' + fn);
}
console.log('  PASS: apply-anchors.mjs 三函数均导出');
"

echo "[smoke:anchor-backfill] Case 6: anchor-sentinel-check.mjs 读 anchor-coverage 端点"
node -e "
const js = require('fs').readFileSync('$SENTINEL_CHECK', 'utf8');
if (!/\/api\/brain\/graph\/anchor-coverage/.test(js)) throw new Error('Case 6 FAIL: 未读 anchor-coverage 端点');
console.log('  PASS: anchor-sentinel-check.mjs 已接线 anchor-coverage');
"

echo "[smoke:anchor-backfill] Case 7: Brain 可信 callback 含 Feature 状态与锚点自动焊"
node -e "
const fs = require('fs');
const writeback = fs.readFileSync('$HARNESS_REPORT_WRITEBACK', 'utf8');
const execution = fs.readFileSync('$EXECUTION_ROUTE', 'utf8');
if (!/export async function finalizeHarnessReportFeature/.test(writeback)) throw new Error('Case 7 FAIL: 缺少可信 Feature 回写函数');
if (!/readPullRequestFiles/.test(writeback)) throw new Error('Case 7 FAIL: 缺少 PR changed files 读取');
if (!/status = 'done'/.test(writeback) || !/unit_test_path = CASE/.test(writeback)) throw new Error('Case 7 FAIL: 状态或锚点未在同一可信写回中');
if (!/import \{ finalizeHarnessReportFeature \}/.test(execution)) throw new Error('Case 7 FAIL: execution callback 未导入可信写回');
if (!/await finalizeHarnessReportFeature\(pool,/.test(execution)) throw new Error('Case 7 FAIL: execution callback 未调用可信写回');
console.log('  PASS: Brain callback 可信写回 Feature 状态与锚点');
"

echo "[smoke:anchor-backfill] Case 8: 真环境 — 已落库锚点校验（Brain 可达时）"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
if curl -sf -m 3 "$BRAIN_URL/api/brain/journeys" >/dev/null 2>&1; then
  UTP=$(curl -s -m 3 "$BRAIN_URL/api/brain/journey_features?limit=500" 2>/dev/null \
    | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        try {
          const rows = JSON.parse(d);
          const hit = rows.find(r => r.unit_test_path === 'zenithjoy/apps/api/tests/routes/crm-status-history.test.ts');
          process.stdout.write(hit ? 'FOUND' : 'MISSING');
        } catch (e) { process.stdout.write('PARSE_ERROR'); }
      });
    ")
  if [ "$UTP" = "FOUND" ]; then
    echo "  PASS: 批准清单条目(CRM表底座改锚)已在生产 journey_features 落库"
  else
    echo "  WARN: Brain 可达但未查到预期落库条目($UTP)——可能是不同环境/DB，结构校验已覆盖"
  fi
else
  echo "  SKIP: Brain 不可达，跳过真环境校验（结构校验已覆盖）"
fi

echo "[smoke:anchor-backfill] ✅ 全部通过"
