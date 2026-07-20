#!/usr/bin/env bash
# conversation-capture-smoke.sh
# 验收：对话原始捕获多工具编排层（decision 39fa77ac，前身 f64adaaf/0c9e1652）。
# L1 静态：三工具适配器导出 + conversation-capture.js 编排层关键导出 + captures.js
#          VALID_SOURCES/VALID_NATURES + scheduler-jobs.js 接线。
# L3 真库：captures 表接受 source=conversation-claude 插入 + working_memory 可写扫描哨兵。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # packages/brain
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# ── L1 静态：三个适配器文件存在且导出正确 ──
echo "── L1 三个适配器文件存在且导出正确 ──"
node -e "
const fs = require('fs');
const checks = [
  ['$ROOT/src/conversation-capture-claude.js', 'export function extractClaudeSessions'],
  ['$ROOT/src/conversation-capture-codex.js', 'export function extractCodexSessions'],
  ['$ROOT/src/conversation-capture-grok.js', 'export function extractGrokSessions'],
];
const missing = checks.filter(([f, p]) => !fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes(p));
if (missing.length > 0) {
  console.error('FAIL: 适配器缺失:');
  missing.forEach(([f]) => console.error('  - ' + f));
  process.exit(1);
}
console.log('三个适配器文件存在且导出正确');
" && ok "三个工具适配器存在" || fail "适配器文件缺失"

# ── L1 静态：conversation-capture.js 编排层关键导出 ──
echo "── L1 conversation-capture.js 编排层关键导出 ──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/conversation-capture.js', 'utf8');
const checks = [
  ['export async function runConversationCapture', 'runConversationCapture 导出'],
  ['export async function summarizeSession', 'summarizeSession 导出'],
  ['export function sessionDedupeKey', 'sessionDedupeKey 导出'],
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

echo "── L1 captures.js VALID_SOURCES 含三个 conversation-* 值 ──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/routes/captures.js', 'utf8');
const need = ['conversation-claude', 'conversation-codex', 'conversation-grok'];
const missing = need.filter((v) => !src.includes(\"'\" + v + \"'\"));
if (missing.length > 0) { console.error('FAIL: 缺少 source 值: ' + missing.join(',')); process.exit(1); }
if (!src.includes(\"'session_summary'\")) { console.error('FAIL: VALID_NATURES 缺 session_summary'); process.exit(1); }
console.log('VALID_SOURCES/VALID_NATURES 正确');
" && ok "captures.js 三工具 source + session_summary nature 齐全" || fail "captures.js 值域不全"

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

# ── L3 真库：captures 表真实接受 source=conversation-claude ──
echo "── L3 真库（psql）──"
if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql 不可用（L1 静态已 PASS）"
elif ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: DB 不可达（L1 静态已 PASS）"
else
  # source=conversation-claude 真实可插入并回滚（不留痕）
  psql "$DB" -tAc "BEGIN; INSERT INTO captures (content, source, dedupe_key) VALUES ('smoke-test', 'conversation-claude', 'smoke-conversation-capture-$$'); ROLLBACK;" >/dev/null 2>&1 \
    && ok "captures 表接受 source=conversation-claude 插入" \
    || fail "captures 表拒绝 source=conversation-claude 插入"
  # working_memory 表存在（哨兵落点）
  WM=$(psql "$DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_name='working_memory'" 2>/dev/null)
  [ "$WM" = "1" ] && ok "working_memory 表存在（扫描哨兵落点）" || fail "working_memory 表不存在"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
