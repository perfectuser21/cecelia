#!/usr/bin/env bash
# conversation-capture-smoke.sh
# 验收：对话原始捕获（decision f64adaaf/0c9e1652）——机械过滤 JSONL 真人文本进 captures inbox。
# L1 静态：conversation-capture.js 关键导出 + captures.js VALID_SOURCES + scheduler-jobs.js 接线。
# L3 真库：captures 表接受 source=conversation 插入 + working_memory 可写扫描哨兵。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # packages/brain
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# ── L1 静态：模块结构 ──
echo "── L1 conversation-capture.js 关键导出 ──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/conversation-capture.js', 'utf8');
const checks = [
  ['export function extractUserTurns', 'extractUserTurns 导出'],
  ['export async function runConversationCapture', 'runConversationCapture 导出'],
  ['export function __resetConversationCaptureForTest', '__resetConversationCaptureForTest 导出'],
  [\"pushCapture\", 'pushCapture 复用（不手写 INSERT）'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: conversation-capture.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('conversation-capture.js 结构正确');
" && ok "conversation-capture.js 关键导出齐全" || fail "conversation-capture.js 结构缺失"

echo "── L1 captures.js VALID_SOURCES 含 conversation ──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/routes/captures.js', 'utf8');
if (!/VALID_SOURCES\s*=\s*\[[^\]]*'conversation'/.test(src)) {
  console.error('FAIL: VALID_SOURCES 未含 conversation');
  process.exit(1);
}
console.log('VALID_SOURCES 含 conversation');
" && ok "captures.js VALID_SOURCES 含 conversation" || fail "captures.js VALID_SOURCES 缺 conversation"

echo "── L1 scheduler-jobs.js 已接入 conversation-capture job ──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/scheduler-jobs.js', 'utf8');
const checks = [
  [\"import { runConversationCapture } from './conversation-capture.js'\", 'import runConversationCapture'],
  [\"name: 'conversation-capture'\", 'JOBS 含 conversation-capture 条目'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: scheduler-jobs.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('scheduler-jobs.js 接线正确');
" && ok "scheduler-jobs.js 已注册 conversation-capture job" || fail "scheduler-jobs.js 未接线"

# ── L3 真库：captures 表真实接受 source=conversation ──
echo "── L3 真库（psql）──"
if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql 不可用（L1 静态已 PASS）"
elif ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: DB 不可达（L1 静态已 PASS）"
else
  # source=conversation 真实可插入并回滚（不留痕）
  psql "$DB" -tAc "BEGIN; INSERT INTO captures (content, source, dedupe_key) VALUES ('smoke-test', 'conversation', 'smoke-conversation-capture-$$'); ROLLBACK;" >/dev/null 2>&1 \
    && ok "captures 表接受 source=conversation 插入" \
    || fail "captures 表拒绝 source=conversation 插入"
  # working_memory 表存在（哨兵落点）
  WM=$(psql "$DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name='working_memory'" 2>/dev/null)
  [ "$WM" = "1" ] && ok "working_memory 表存在（扫描哨兵落点）" || fail "working_memory 表不存在"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
