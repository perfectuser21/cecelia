#!/usr/bin/env bash
# gate5-a1-otel-smoke.sh
#
# Gate 5 A1 smoke 验证：
#   1. otel.js 文件存在且语法正确
#   2. otel.js 导出 initOtel 函数
#   3. server.js 顶部包含 initOtel import
#   4. 三个 OTel 依赖已安装（package.json）
#   5. initOtel() 在无 HONEYCOMB_API_KEY 时 graceful skip 逻辑存在

set -euo pipefail

BRAIN_DIR="${BRAIN_DIR:-packages/brain}"
PASS=0
FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo ""
echo "═══════════════════════════════════════════════"
echo "  Gate 5 A1 — OTel / Honeycomb smoke"
echo "═══════════════════════════════════════════════"
echo ""

# ── 1. otel.js 存在且语法正确 ───────────────────────────────────────────────
OTEL_FILE="${BRAIN_DIR}/src/otel.js"
if [[ -f "$OTEL_FILE" ]]; then
  if node --check "$OTEL_FILE" 2>/dev/null; then
    ok "otel.js 存在且语法正确"
  else
    fail "otel.js 语法检查失败"
  fi
else
  fail "otel.js 不存在: $OTEL_FILE"
fi

# ── 2. otel.js 导出 initOtel ────────────────────────────────────────────────
if node -e "
const c = require('fs').readFileSync('${OTEL_FILE}', 'utf8');
if (!c.includes('export async function initOtel')) { process.exit(1); }
" 2>/dev/null; then
  ok "otel.js 导出 initOtel() 函数"
else
  fail "otel.js 未找到 'export async function initOtel'"
fi

# ── 3. server.js 顶部包含 initOtel import ───────────────────────────────────
SERVER_FILE="${BRAIN_DIR}/server.js"
if node -e "
const c = require('fs').readFileSync('${SERVER_FILE}', 'utf8');
if (!c.includes('initOtel')) { process.exit(1); }
const lines = c.split('\n').slice(0, 10).join('\n');
if (!lines.includes('initOtel')) { console.error('initOtel not in first 10 lines'); process.exit(1); }
" 2>/dev/null; then
  ok "server.js 顶部（前 10 行）包含 initOtel"
else
  fail "server.js 顶部未找到 initOtel import/调用"
fi

# ── 4. 三个 OTel 依赖已安装 ──────────────────────────────────────────────────
PKG_FILE="${BRAIN_DIR}/package.json"
for pkg in "@opentelemetry/sdk-node" "@opentelemetry/exporter-otlp-http" "@opentelemetry/auto-instrumentations-node"; do
  if node -e "
const c = require('fs').readFileSync('${PKG_FILE}', 'utf8');
if (!c.includes('${pkg}')) { process.exit(1); }
" 2>/dev/null; then
    ok "依赖已声明: $pkg"
  else
    fail "依赖缺失: $pkg"
  fi
done

# ── 5. initOtel() 无 key 时 graceful skip 逻辑验证 ──────────────────────────
SKIP_TEST=$(node -e "
const src = require('fs').readFileSync('${OTEL_FILE}', 'utf8');
if (!src.includes('HONEYCOMB_API_KEY')) {
  console.error('FAIL: 未找到 HONEYCOMB_API_KEY 检查逻辑');
  process.exit(1);
}
if (!src.includes('return null')) {
  console.error('FAIL: 未找到 graceful skip (return null)');
  process.exit(1);
}
console.log('OK: graceful skip 逻辑存在');
" 2>&1) || SKIP_TEST="ERROR"

if [[ "$SKIP_TEST" == *"OK"* ]]; then
  ok "initOtel() 包含 graceful skip 逻辑"
else
  fail "initOtel() graceful skip 验证失败: $SKIP_TEST"
fi

# ── 汇总 ─────────────────────────────────────────────────────────────────────
echo ""
echo "  PASS: $PASS  FAIL: $FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "  ❌ Gate 5 A1 smoke FAILED"
  exit 1
fi

echo "  ✅ Gate 5 A1 smoke PASSED"
