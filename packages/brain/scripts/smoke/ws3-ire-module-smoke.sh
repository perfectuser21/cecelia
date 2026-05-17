#!/usr/bin/env bash
# ws3-ire-module-smoke.sh
# ws3 smoke：验证 initiativeRunEvents.js 模块结构 + migration 279 存在
# Case 1: initiativeRunEvents.js 存在且含 writeInitiativeRunEvent 导出
# Case 2: migration 279_initiative_run_events.sql 存在且含正确 schema
# Case 3: executor.js 含 initiativeRunEvents import
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$BRAIN_ROOT"

echo "[smoke:ws3-ire] Case 1: initiativeRunEvents.js 存在且含 writeInitiativeRunEvent"
node -e "
const c = require('fs').readFileSync('src/events/initiativeRunEvents.js', 'utf8');
if (!c.includes('writeInitiativeRunEvent')) throw new Error('缺少 writeInitiativeRunEvent');
// 检查 INSERT 语句不含 label 列（注释里可以有 label 文字）
const insertStmt = c.match(/INSERT INTO initiative_run_events[^;]+/)?.[0] || '';
if (insertStmt.includes('label')) throw new Error('INSERT 语句不能含 label 列');
console.log('[smoke:ws3-ire] Case 1 PASS');
"

echo "[smoke:ws3-ire] Case 2: migration 279 存在且含 ts BIGINT"
node -e "
const c = require('fs').readFileSync('migrations/279_initiative_run_events.sql', 'utf8');
if (!c.includes('initiative_run_events')) throw new Error('缺少表名');
if (!c.includes('ts')) throw new Error('缺少 ts 列');
if (!c.includes('BIGINT')) throw new Error('ts 必须为 BIGINT');
// 检查 CREATE TABLE 语句不含 label 列定义
const createStmt = c.match(/CREATE TABLE[^;]+/)?.[0] || '';
if (/^\s*label\b/m.test(createStmt)) throw new Error('CREATE TABLE 不能含 label 列定义');
console.log('[smoke:ws3-ire] Case 2 PASS');
"

echo "[smoke:ws3-ire] Case 3: executor.js 含 initiativeRunEvents import"
node -e "
const c = require('fs').readFileSync('src/executor.js', 'utf8');
if (!c.includes('initiativeRunEvents')) throw new Error('executor.js 缺少 initiativeRunEvents import');
if (!c.includes('writeInitiativeRunEvent')) throw new Error('executor.js 缺少 writeInitiativeRunEvent 调用');
console.log('[smoke:ws3-ire] Case 3 PASS');
"

echo "✅ [smoke:ws3-ire] All 3 cases PASS"
exit 0
