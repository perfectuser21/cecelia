#!/usr/bin/env bash
# scheduler-jobs-smoke.sh
#
# 作战循环 P1-PR1 smoke 验证：
#   1. scheduler-jobs.js 存在且语法正确
#   2. 导出 JOBS / runSchedulerJobsOnce / startSchedulerJobsLoop / SENTINEL_KEY_PREFIX
#   3. 首批 job 注册在位（arch-review / strategy-trigger；conversation-digest/capture-digestion 已于 P0 清场退役，decisions a823206d）
#   4. loop 带 running 重入守卫（防慢 handler 轮次叠加并发）
#   5. server.js 非阻断挂载（startSchedulerJobsLoop + non-fatal catch）
#   6. tick-runner.js 4 处死调用已标 DEPRECATED(P1-PR1)

set -euo pipefail

BRAIN_DIR="${BRAIN_DIR:-packages/brain}"
PASS=0
FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo ""
echo "═══════════════════════════════════════════════"
echo "  scheduler-jobs 注册表 smoke（P1-PR1）"
echo "═══════════════════════════════════════════════"
echo ""

SJ_FILE="${BRAIN_DIR}/src/scheduler-jobs.js"

# ── 1. 文件存在且语法正确 ──
if [[ -f "$SJ_FILE" ]] && node --check "$SJ_FILE" 2>/dev/null; then
  ok "scheduler-jobs.js 存在且语法正确"
else
  fail "scheduler-jobs.js 缺失或语法错误"
fi

# ── 2. 导出齐全 ──
for sym in "export const JOBS" "export async function runSchedulerJobsOnce" "export function startSchedulerJobsLoop" "export const SENTINEL_KEY_PREFIX"; do
  if grep -q "$sym" "$SJ_FILE" 2>/dev/null; then
    ok "导出存在: $sym"
  else
    fail "导出缺失: $sym"
  fi
done

# ── 3. 首批 4 job 注册 ──
for job in "arch-review" "strategy-trigger"; do
  if grep -q "name: '$job'" "$SJ_FILE" 2>/dev/null; then
    ok "job 已注册: $job"
  else
    fail "job 缺失: $job"
  fi
done

# ── 4. 重入守卫 ──
if grep -q "let running = false" "$SJ_FILE" && grep -q "if (running) return" "$SJ_FILE"; then
  ok "loop 带 running 重入守卫"
else
  fail "重入守卫缺失"
fi

# ── 5. server.js 非阻断挂载 ──
SERVER_FILE="${BRAIN_DIR}/server.js"
if grep -q "startSchedulerJobsLoop(pool)" "$SERVER_FILE" && grep -q "scheduler-jobs init failed (non-fatal)" "$SERVER_FILE"; then
  ok "server.js 非阻断挂载在位"
else
  fail "server.js 挂载缺失或非 non-fatal"
fi

# ── 6. tick-runner DEPRECATED 标注 ──
TR_FILE="${BRAIN_DIR}/src/tick-runner.js"
# P0 清场（decisions a823206d）删除了 conversation-digest/capture-digestion 两处死调用，剩 2 处
DEP_COUNT=$(grep -c "DEPRECATED(P1-PR1" "$TR_FILE" 2>/dev/null || echo 0)
if [[ "$DEP_COUNT" == "2" ]]; then
  ok "tick-runner 2 处死调用已标 DEPRECATED"
else
  fail "tick-runner DEPRECATED 标注数=$DEP_COUNT（预期 2）"
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "  结果: $PASS 通过 / $FAIL 失败"
echo "═══════════════════════════════════════════════"
[[ "$FAIL" == "0" ]] || exit 1
