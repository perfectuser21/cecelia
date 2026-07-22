#!/usr/bin/env bash
# conversation-capture-multitool-smoke.sh
# 验收：对话捕获多工具扩展（decision 39fa77ac）——Codex/Grok 适配器 + session 闲置判定 +
# migration 356 历史行改名。与 conversation-capture-smoke.sh（PR#4135 原版）互补，本脚本
# 聚焦本次新增的多工具/闲置判定/迁移部分。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # packages/brain
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# ── L1 静态：Codex/Grok 适配器关键结构 ──
echo "── L1 Codex 适配器结构 ──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/conversation-capture-codex.js', 'utf8');
const checks = [
  ['export function extractCodexSessions', 'extractCodexSessions 导出'],
  ['history.jsonl', '读 history.jsonl'],
  ['session_id', '按 session_id 分组'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) { console.error('FAIL: ' + missing.map(m=>m[1]).join(', ')); process.exit(1); }
console.log('Codex 适配器结构正确');
" && ok "conversation-capture-codex.js 结构正确" || fail "Codex 适配器结构缺失"

echo "── L1 Grok 适配器结构 ──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/conversation-capture-grok.js', 'utf8');
const checks = [
  ['export function extractGrokSessions', 'extractGrokSessions 导出'],
  ['prompt_history.jsonl', '读 prompt_history.jsonl'],
  ['session_id', '按 session_id 分组'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) { console.error('FAIL: ' + missing.map(m=>m[1]).join(', ')); process.exit(1); }
console.log('Grok 适配器结构正确');
" && ok "conversation-capture-grok.js 结构正确" || fail "Grok 适配器结构缺失"

echo "── L1 编排层：闲置判定 + dedupeKey 只绑 sessionId + LLM 摘要 ──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/conversation-capture.js', 'utf8');
const checks = [
  ['IDLE_THRESHOLD_MS', '15分钟闲置阈值常量'],
  ['LOOKBACK_WINDOW_MS', '固定回看窗口（修复mtime窗口互斥bug）'],
  ['sessionDedupeKey', 'dedupeKey 生成函数'],
  ['summarizeSession', 'Haiku摘要函数'],
  ['session_summary', '摘要 nature 值'],
  ['adapter_failures', '适配器失败可观测字段'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) { console.error('FAIL: ' + missing.map(m=>m[1]).join(', ')); process.exit(1); }
// dedupeKey 只绑 sessionId（2026-07-22 起，不再绑 lastEntryId）：函数体不能再拼 lastEntryId，
// 否则同一 session 复聊后再闲置会被当新会话重复摘要（回归 captures 表噪音事故）。
const fnBody = src.slice(src.indexOf('export function sessionDedupeKey'), src.indexOf('export function sessionDedupeKey') + 300);
if (fnBody.includes('lastEntryId')) { console.error('FAIL: sessionDedupeKey 仍绑定 lastEntryId（应只绑 sessionId）'); process.exit(1); }
console.log('编排层关键结构正确');
" && ok "conversation-capture.js 编排层结构正确（含mtime窗口修复+dedupeKey只绑sessionId）" || fail "编排层结构缺失"

echo "── L1 dedupe 前置检查（防重复LLM计费，2026-07-22 起改内容比对）──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/conversation-capture.js', 'utf8');
// 内容未变化直接跳过（既不重新 push 也不重新摘要）：按 dedupeKey 查 content 比对，
// 而非只判存在性——存在性判断挡不住'复聊内容变了但 key 没变'的场景，会漏内容。
if (!/SELECT content FROM captures WHERE dedupe_key/.test(src)) {
  console.error('FAIL: 缺少 dedupe_key 内容比对前置检查（会导致LLM重复计费或漏内容）');
  process.exit(1);
}
if (!/existingContent === rawText/.test(src)) {
  console.error('FAIL: 缺少内容未变化跳过逻辑（existingContent === rawText）');
  process.exit(1);
}
console.log('LLM调用前有dedupe_key内容比对检查');
" && ok "LLM调用前置去重检查存在" || fail "缺少LLM前置去重检查"

# ── L1 migration 356 内容 ──
echo "── L1 migration 356 ──"
MIG="$ROOT/migrations/356_rename_conversation_source.sql"
if [ -f "$MIG" ] && grep -q "conversation-claude" "$MIG" && grep -q "source = 'conversation'" "$MIG"; then
  ok "migration 356 存在且改名逻辑正确"
else
  fail "migration 356 缺失或内容不对"
fi

# ── L3 真库：三工具 source 值真实可插入 + migration 已应用 ──
echo "── L3 真库（psql）──"
if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql 不可用（L1 静态已 PASS）"
elif ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: DB 不可达（L1 静态已 PASS）"
else
  for src in conversation-codex conversation-grok; do
    psql "$DB" -tAc "BEGIN; INSERT INTO captures (content, source, dedupe_key) VALUES ('smoke-test', '$src', 'smoke-mt-$src-$$'); ROLLBACK;" >/dev/null 2>&1 \
      && ok "captures 表接受 source=$src 插入" \
      || fail "captures 表拒绝 source=$src 插入"
  done
  psql "$DB" -tAc "BEGIN; INSERT INTO captures (content, source, nature, dedupe_key) VALUES ('smoke-test', 'conversation-claude', 'session_summary', 'smoke-mt-summary-$$'); ROLLBACK;" >/dev/null 2>&1 \
    && ok "captures 表接受 nature=session_summary 插入" \
    || fail "captures 表拒绝 nature=session_summary 插入"
  LEGACY=$(psql "$DB" -tAc "SELECT count(*) FROM captures WHERE source = 'conversation'" 2>/dev/null)
  [ "$LEGACY" = "0" ] && ok "无残留 source='conversation'（migration 356 已生效）" || fail "仍有 $LEGACY 行 source='conversation' 未改名"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
