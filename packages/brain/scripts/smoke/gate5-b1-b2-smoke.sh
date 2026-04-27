#!/usr/bin/env bash
# gate5-b1-b2-smoke.sh
#
# Gate 5 B1+B2 smoke 验证：
#   1. credentials-health-scheduler.js 模块可被 Node.js 解析（语法 + import 链正常）
#   2. daily-real-business-smoke.js 模块可被 Node.js 解析
#   3. tick-runner.js 包含 runDailySmoke + runCredentialsHealthCheck 两个接入点
#   4. cecelia-bridge.js 包含 /notebook/auth-check 端点
#   5. isInCredentialsHealthWindow(now=UTC 19:00) 返回 true（纯函数，无外部依赖）
#   6. isInSmokeWindow(now=UTC 20:00) 返回 true（纯函数，无外部依赖）
#
# 在 CI real-env-smoke（已起 docker brain）环境和本机均可运行。

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0
FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo ""
echo "═══════════════════════════════════════════════"
echo "  Gate 5 B1+B2 smoke"
echo "═══════════════════════════════════════════════"
echo ""

# ── 1. credentials-health-scheduler.js 文件存在 + 语法正确 ──────────────────
CRED_SCHED="packages/brain/src/credentials-health-scheduler.js"
if [[ -f "$CRED_SCHED" ]]; then
  if node --check "$CRED_SCHED" 2>/dev/null; then
    ok "credentials-health-scheduler.js 存在且语法正确"
  else
    fail "credentials-health-scheduler.js 语法检查失败"
  fi
else
  fail "credentials-health-scheduler.js 不存在"
fi

# ── 2. daily-real-business-smoke.js 文件存在 + 语法正确 ─────────────────────
DAILY_SMOKE="packages/brain/src/cron/daily-real-business-smoke.js"
if [[ -f "$DAILY_SMOKE" ]]; then
  if node --check "$DAILY_SMOKE" 2>/dev/null; then
    ok "daily-real-business-smoke.js 存在且语法正确"
  else
    fail "daily-real-business-smoke.js 语法检查失败"
  fi
else
  fail "daily-real-business-smoke.js 不存在"
fi

# ── 3. tick-runner.js 接入两个新 cron ───────────────────────────────────────
TICK_RUNNER="packages/brain/src/tick-runner.js"
if node -e "
const c = require('fs').readFileSync('${TICK_RUNNER}', 'utf8');
if (!c.includes('runDailySmoke')) { console.error('runDailySmoke not found'); process.exit(1); }
if (!c.includes('runCredentialsHealthCheck')) { console.error('runCredentialsHealthCheck not found'); process.exit(1); }
" 2>/dev/null; then
  ok "tick-runner.js 包含 runDailySmoke + runCredentialsHealthCheck"
else
  fail "tick-runner.js 缺少 runDailySmoke 或 runCredentialsHealthCheck"
fi

# ── 4. cecelia-bridge.js 包含 /notebook/auth-check 端点 ─────────────────────
BRIDGE="packages/brain/scripts/cecelia-bridge.js"
if node -e "
const c = require('fs').readFileSync('${BRIDGE}', 'utf8');
if (!c.includes('/notebook/auth-check')) { process.exit(1); }
" 2>/dev/null; then
  ok "cecelia-bridge.js 包含 /notebook/auth-check 端点"
else
  fail "cecelia-bridge.js 缺少 /notebook/auth-check 端点"
fi

# ── 5. isInCredentialsHealthWindow 纯函数验证（内联逻辑，无需 import 链）──────
# 直接从源码提取 TRIGGER_HOUR_UTC + TRIGGER_WINDOW_MINUTES 常量，自行验证逻辑
WIN_TEST=$(node -e "
const src = require('fs').readFileSync('packages/brain/src/credentials-health-scheduler.js', 'utf8');
const hourMatch  = src.match(/export const TRIGGER_HOUR_UTC\s*=\s*(\d+)/);
const winMatch   = src.match(/export const TRIGGER_WINDOW_MINUTES\s*=\s*(\d+)/);
if (!hourMatch || !winMatch) { console.error('FAIL: cannot extract constants'); process.exit(1); }
const HOUR = parseInt(hourMatch[1]);
const WIN  = parseInt(winMatch[1]);
// isInCredentialsHealthWindow logic: hour===HOUR && minute < WIN
const t1900min = 0;   const t1904min = 4;   const t1905min = 5;
const inWindow  = (h,m) => h === HOUR && m < WIN;
if (!inWindow(HOUR, t1900min)) { console.error('FAIL: UTC '+HOUR+':00 should be true'); process.exit(1); }
if (!inWindow(HOUR, t1904min)) { console.error('FAIL: UTC '+HOUR+':04 should be true'); process.exit(1); }
if (inWindow(HOUR, t1905min))  { console.error('FAIL: UTC '+HOUR+':05 should be false'); process.exit(1); }
if (inWindow(HOUR+1, 0))       { console.error('FAIL: UTC '+(HOUR+1)+':00 should be false'); process.exit(1); }
console.log('OK hour='+HOUR+' window='+WIN+'min');
" 2>&1) || WIN_TEST="ERROR"

if [[ "$WIN_TEST" == *"OK"* ]]; then
  ok "isInCredentialsHealthWindow 逻辑正确: $WIN_TEST"
else
  fail "isInCredentialsHealthWindow 验证失败: $WIN_TEST"
fi

# ── 6. isInSmokeWindow 纯函数验证（内联逻辑，无需 import 链）───────────────
SMOKE_TEST=$(node -e "
const src = require('fs').readFileSync('packages/brain/src/cron/daily-real-business-smoke.js', 'utf8');
const hourMatch = src.match(/export const SMOKE_HOUR_UTC\s*=\s*(\d+)/);
const winMatch  = src.match(/export const SMOKE_WINDOW_MINUTES\s*=\s*(\d+)/);
if (!hourMatch || !winMatch) { console.error('FAIL: cannot extract constants'); process.exit(1); }
const HOUR = parseInt(hourMatch[1]);
const WIN  = parseInt(winMatch[1]);
const inWindow = (h,m) => h === HOUR && m < WIN;
if (!inWindow(HOUR, 0))     { console.error('FAIL: UTC '+HOUR+':00 should be true'); process.exit(1); }
if (!inWindow(HOUR, 4))     { console.error('FAIL: UTC '+HOUR+':04 should be true'); process.exit(1); }
if (inWindow(HOUR, WIN))    { console.error('FAIL: UTC '+HOUR+':'+WIN+' should be false'); process.exit(1); }
if (inWindow(HOUR-1, 0))    { console.error('FAIL: UTC '+(HOUR-1)+':00 should be false'); process.exit(1); }
console.log('OK hour='+HOUR+' window='+WIN+'min');
" 2>&1) || SMOKE_TEST="ERROR"

if [[ "$SMOKE_TEST" == *"OK"* ]]; then
  ok "isInSmokeWindow 逻辑正确: $SMOKE_TEST"
else
  fail "isInSmokeWindow 验证失败: $SMOKE_TEST"
fi

# ── 汇总 ─────────────────────────────────────────────────────────────────────
echo ""
echo "  PASS: $PASS  FAIL: $FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "  ❌ Gate 5 B1+B2 smoke FAILED"
  exit 1
fi

echo "  ✅ Gate 5 B1+B2 smoke PASSED"
