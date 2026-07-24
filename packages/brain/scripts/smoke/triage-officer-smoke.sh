#!/usr/bin/env bash
# Smoke: triage-officer（排序官接线三件）
# 覆盖：① scheduler-jobs 注册两条新 job（triage-officer-rank + triage-officer-15min）
#       ② triage-officer-rank.js 导出合约（窗口函数 / 产能预算 / 榜单 / 线水位）
#       ③ triage-officer-15min.js 导出合约（规则小轮 / 否决窗放行）
#       ④ morning-cockpit-bark.js 接榜单 veto 模式（LEADERBOARD_KEY import）
#
# 纯静态结构验证：不依赖 Brain HTTP / DB，可在任意环境安全跑。
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# ── 1. scheduler-jobs 注册检查 ──────────────────────────────────────────────
SJ="packages/brain/src/scheduler-jobs.js"
[ -f "$SJ" ] || { echo "FAIL: $SJ 不存在"; exit 1; }
grep -q "triage-officer-rank" "$SJ" || { echo "FAIL: scheduler-jobs 未注册 triage-officer-rank"; exit 1; }
grep -q "triage-officer-15min" "$SJ" || { echo "FAIL: scheduler-jobs 未注册 triage-officer-15min"; exit 1; }
grep -q "maybeRunTriageOfficerRank" "$SJ" || { echo "FAIL: scheduler-jobs 未 import maybeRunTriageOfficerRank"; exit 1; }
grep -q "runTriageOfficer15min" "$SJ" || { echo "FAIL: scheduler-jobs 未 import runTriageOfficer15min"; exit 1; }
echo "OK: scheduler-jobs 已注册 triage-officer-rank + triage-officer-15min"

# ── 2. triage-officer-rank.js 合约 ─────────────────────────────────────────
RANK="packages/brain/src/triage-officer-rank.js"
[ -f "$RANK" ] || { echo "FAIL: $RANK 不存在"; exit 1; }
grep -q "isInTriageOfficerRankWindow" "$RANK" || { echo "FAIL: isInTriageOfficerRankWindow 未导出"; exit 1; }
grep -q "computeAvgPrHours" "$RANK" || { echo "FAIL: computeAvgPrHours 未导出"; exit 1; }
grep -q "computeCapacityBudget" "$RANK" || { echo "FAIL: computeCapacityBudget 未导出"; exit 1; }
grep -q "buildRankedLeaderboard" "$RANK" || { echo "FAIL: buildRankedLeaderboard 未导出"; exit 1; }
grep -q "computeLineWatermarks" "$RANK" || { echo "FAIL: computeLineWatermarks 未导出"; exit 1; }
grep -q "maybeRunTriageOfficerRank" "$RANK" || { echo "FAIL: maybeRunTriageOfficerRank 未导出"; exit 1; }
grep -q "LEADERBOARD_KEY" "$RANK" || { echo "FAIL: LEADERBOARD_KEY 未导出"; exit 1; }
grep -q "VETO_WINDOW_MIN\|veto_deadline" "$RANK" || { echo "FAIL: 否决窗逻辑缺失"; exit 1; }
echo "OK: triage-officer-rank.js 合约完整"

# ── 3. triage-officer-15min.js 合约 ────────────────────────────────────────
MIN15="packages/brain/src/triage-officer-15min.js"
[ -f "$MIN15" ] || { echo "FAIL: $MIN15 不存在"; exit 1; }
grep -q "runTriageOfficer15min" "$MIN15" || { echo "FAIL: runTriageOfficer15min 未导出"; exit 1; }
grep -q "INTERVAL_MS" "$MIN15" || { echo "FAIL: 15min gate 常量缺失"; exit 1; }
grep -q "triage_approved" "$MIN15" || { echo "FAIL: triage_approved 标记缺失"; exit 1; }
grep -q "重名.*归并\|ranked\|cancel" "$MIN15" || { echo "FAIL: 规则1 重名归并逻辑缺失"; exit 1; }
echo "OK: triage-officer-15min.js 合约完整"

# ── 4. morning-cockpit-bark.js veto 接入 ───────────────────────────────────
MCB="packages/brain/src/morning-cockpit-bark.js"
[ -f "$MCB" ] || { echo "FAIL: $MCB 不存在"; exit 1; }
grep -q "LEADERBOARD_KEY" "$MCB" || { echo "FAIL: morning-cockpit-bark 未 import LEADERBOARD_KEY"; exit 1; }
grep -q "leaderboard\|veto\|triage" "$MCB" || { echo "FAIL: morning-cockpit-bark 未接榜单 veto"; exit 1; }
echo "OK: morning-cockpit-bark.js 已接榜单 veto 模式"

echo ""
echo "✅ triage-officer smoke 全部通过"
