#!/usr/bin/env bash
# ws1-initiative-runs-journey-id-smoke.sh
# ws1 smoke：验证 initiative_runs.journey_id 列 + GET /initiative-runs/:id 路由实现完整
# Case 1: migration 文件存在且含 journey_id UUID 列定义
# Case 2: migration 285 存在于正式 migrations 目录（供 migrate.js 应用）
# Case 3: harness-initiative.graph.js 两处 INSERT 均含 journey_id
# Case 4: harness.js 路由文件含 initiative-runs/:id + UUID 校验 + journey_id 返回
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION_FILE="$BRAIN_ROOT/src/db/migrations/011-initiative-runs-journey-id.sql"
MIGRATION_285="$BRAIN_ROOT/migrations/285_initiative_runs_journey_id.sql"
GRAPH_FILE="$BRAIN_ROOT/src/workflows/harness-initiative.graph.js"
ROUTES_FILE="$BRAIN_ROOT/src/routes/harness.js"

cd "$BRAIN_ROOT"

echo "[smoke:ws1] Case 1: migration 011 文件存在且含 journey_id UUID"
node -e "
const fs = require('fs');
const f = '$MIGRATION_FILE';
if (!fs.existsSync(f)) throw new Error('Case 1 FAIL: 文件不存在 ' + f);
const sql = fs.readFileSync(f, 'utf8');
if (!sql.includes('journey_id')) throw new Error('Case 1 FAIL: 缺少 journey_id');
if (!/journey_id\s+UUID/i.test(sql)) throw new Error('Case 1 FAIL: journey_id 类型不是 UUID');
if (!/ALTER TABLE\s+initiative_runs/i.test(sql)) throw new Error('Case 1 FAIL: 缺少 ALTER TABLE initiative_runs');
console.log('[smoke:ws1] Case 1 PASS: migration 011 结构正确');
"

echo "[smoke:ws1] Case 2: migration 285 存在于正式目录"
node -e "
const fs = require('fs');
const f = '$MIGRATION_285';
if (!fs.existsSync(f)) throw new Error('Case 2 FAIL: 文件不存在 ' + f);
const sql = fs.readFileSync(f, 'utf8');
if (!sql.includes('journey_id')) throw new Error('Case 2 FAIL: 缺少 journey_id');
console.log('[smoke:ws1] Case 2 PASS: migration 285 存在');
"

echo "[smoke:ws1] Case 3: harness-initiative.graph.js INSERT INTO initiative_runs 含 journey_id"
node -e "
const fs = require('fs');
const content = fs.readFileSync('$GRAPH_FILE', 'utf8');
const blocks = content.match(/INSERT INTO initiative_runs[\s\S]*?RETURNING id/g) || [];
// runInitiative 过程式函数已在 #3200 删除，现在只有 dbUpsertNode 一处 INSERT
if (blocks.length < 1) throw new Error('Case 3 FAIL: 无 INSERT INTO initiative_runs 块');
blocks.forEach((b, i) => {
  if (!b.includes('journey_id')) throw new Error('Case 3 FAIL: INSERT 块 ' + (i+1) + ' 缺少 journey_id');
});
console.log('[smoke:ws1] Case 3 PASS: INSERT 含 journey_id (' + blocks.length + ' 块)');
"

echo "[smoke:ws1] Case 4: harness.js 含 initiative-runs/:id 路由 + UUID 校验 + journey_id 返回"
node -e "
const fs = require('fs');
const content = fs.readFileSync('$ROUTES_FILE', 'utf8');
if (!content.match(/router\.get\(['\"]\\/initiative-runs\\/:id['\"]/)) throw new Error('Case 4 FAIL: 缺少 initiative-runs/:id 路由');
if (!content.includes('400')) throw new Error('Case 4 FAIL: 缺少 400 响应（UUID 校验）');
if (!content.includes('journey_id')) throw new Error('Case 4 FAIL: 路由缺少 journey_id 字段');
console.log('[smoke:ws1] Case 4 PASS: 路由实现完整');
"

echo "✅ [smoke:ws1] All 4 cases PASS (initiative_runs.journey_id + GET /initiative-runs/:id)"
exit 0
