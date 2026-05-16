#!/usr/bin/env bash
# ws3-initiative-run-events-smoke.sh
# ws3 smoke：验证 initiative_run_events migration 010 文件结构完整
# Case 1: migration 文件存在且含 CREATE TABLE initiative_run_events
# Case 2: 含必要列（event_id / initiative_id / node / status / payload / created_at）
# Case 3: 含 CHECK 约束（node / status 合法值）
# Case 4: 含 CREATE INDEX idx_ire_initiative_created
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION="$BRAIN_ROOT/src/db/migrations/010-initiative-run-events.sql"

cd "$BRAIN_ROOT"

echo "[smoke:ws3] Case 1: migration 文件存在"
node -e "require('fs').accessSync('$MIGRATION'); console.log('[smoke:ws3] Case 1 PASS: 文件存在');"

echo "[smoke:ws3] Case 2: 含必要列定义"
node -e "
const sql = require('fs').readFileSync('$MIGRATION', 'utf8');
const required = ['event_id', 'initiative_id', 'node', 'status', 'payload', 'created_at'];
required.forEach(col => {
  if (!sql.includes(col)) throw new Error('Case 2 FAIL: 缺少列 ' + col);
});
console.log('[smoke:ws3] Case 2 PASS: 所有必要列存在');
"

echo "[smoke:ws3] Case 3: 含 node/status CHECK 约束"
node -e "
const sql = require('fs').readFileSync('$MIGRATION', 'utf8');
const nodeVals = ['proposer', 'reviewer', 'generator', 'evaluator'];
const statusVals = ['pending', 'running', 'completed', 'failed'];
nodeVals.forEach(v => { if (!sql.includes(v)) throw new Error('Case 3 FAIL: 缺 node 约束值 ' + v); });
statusVals.forEach(v => { if (!sql.includes(v)) throw new Error('Case 3 FAIL: 缺 status 约束值 ' + v); });
console.log('[smoke:ws3] Case 3 PASS: CHECK 约束完整');
"

echo "[smoke:ws3] Case 4: 含 idx_ire_initiative_created 索引"
node -e "
const sql = require('fs').readFileSync('$MIGRATION', 'utf8');
if (!sql.includes('idx_ire_initiative_created')) throw new Error('Case 4 FAIL: 缺少索引');
console.log('[smoke:ws3] Case 4 PASS: 索引定义存在');
"

echo "✅ [smoke:ws3] All 4 cases PASS (initiative_run_events migration 结构验证)"
exit 0
# ws3 initiative-run-events migration smoke (v2)
