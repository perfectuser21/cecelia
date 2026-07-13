#!/usr/bin/env bash
# p1pr2-deadman-trigger-backup-smoke.sh — 作战循环 P1-PR2 smoke
#   1. active-goals-zero-trigger gate 枚举含 'active'（枚举漂移修复）
#   2. scheduler-jobs 注册 daily-backup 第 5 job
#   3. startSchedulerJobsLoop 写 scheduler_jobs_expected 预期键
#   4. dead-man-switch.sh 存在、语法正确、读库中预期数而非硬编码
set -euo pipefail
BRAIN_DIR="${BRAIN_DIR:-packages/brain}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

TRIG="${BRAIN_DIR}/src/active-goals-zero-trigger.js"
grep -q "status IN ('active', 'in_progress')" "$TRIG" && ok "trigger gate 枚举兼容 active" || fail "trigger gate 枚举未修"

SJ="${BRAIN_DIR}/src/scheduler-jobs.js"
grep -q "name: 'daily-backup'" "$SJ" && ok "daily-backup 已注册第 5 job" || fail "daily-backup 未注册"
grep -q "scheduler_jobs_expected" "$SJ" && ok "预期键写入在位" || fail "预期键缺失"

DMS="scripts/sentinel/dead-man-switch.sh"
if [[ -f "$DMS" ]] && bash -n "$DMS" 2>/dev/null; then ok "dead-man-switch.sh 存在且语法正确"; else fail "dead-man-switch.sh 缺失/语法错"; fi
grep -q "scheduler_jobs_expected" "$DMS" && ok "哨兵读库中预期数（非硬编码）" || fail "哨兵仍硬编码预期数"
[[ -f "scripts/sentinel/com.cecelia.dead-man-switch.plist" ]] && ok "launchd plist 模板在位" || fail "plist 缺失"
grep -q "date '+%m-%d %H:%M:%S'" "$DMS" && ok "日志带时间戳前缀" || fail "日志缺时间戳"
grep -q "orbctl start" "$DMS" && ok "含 docker 引擎自愈分支（orbctl start）" || fail "缺 docker 引擎自愈分支"

echo "  结果: $PASS 通过 / $FAIL 失败"
[[ "$FAIL" == "0" ]] || exit 1
