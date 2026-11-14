#!/usr/bin/env bash
# disk-guard-smoke.sh — 磁盘哨兵 smoke 验证（任务 ba6fe51c）
# 验证磁盘哨兵核心导出、调度注册与日志
set -euo pipefail

DISK_GUARD_FILE="packages/brain/src/cron/disk-guard.js"
SCHEDULER_FILE="packages/brain/src/scheduler-jobs.js"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

cd "$REPO_ROOT"

echo "[disk-guard-smoke] 检查文件存在..."
[ -f "$DISK_GUARD_FILE" ] || { echo "FAIL: $DISK_GUARD_FILE 不存在"; exit 1; }
echo "  OK: disk-guard.js"

echo "[disk-guard-smoke] 检查 disk-guard.js 核心导出..."
grep -q "export.*runDiskGuard" "$DISK_GUARD_FILE" || { echo "FAIL: runDiskGuard 未导出"; exit 1; }
grep -q "export.*__resetDiskGuardForTest" "$DISK_GUARD_FILE" || { echo "FAIL: __resetDiskGuardForTest 未导出"; exit 1; }
grep -q "export.*DISK_GUARD_INTERVAL_MS" "$DISK_GUARD_FILE" || { echo "FAIL: DISK_GUARD_INTERVAL_MS 未导出"; exit 1; }
echo "  OK: runDiskGuard / __resetDiskGuardForTest / DISK_GUARD_INTERVAL_MS"

echo "[disk-guard-smoke] 检查 scheduler-jobs.js disk-guard 注册..."
grep -q "'disk-guard'" "$SCHEDULER_FILE" || { echo "FAIL: disk-guard 未注册到 JOBS"; exit 1; }
grep -q "120_000" "$SCHEDULER_FILE" || grep -q "120000" "$SCHEDULER_FILE" || { echo "FAIL: timeoutMs=120000 未设置"; exit 1; }
grep -q "runDiskGuard" "$SCHEDULER_FILE" || { echo "FAIL: runDiskGuard 未 import 到 scheduler"; exit 1; }
echo "  OK: disk-guard job 已注册，timeoutMs=120000，needsPool=false"

echo "[disk-guard-smoke] 检查 INV-03（[disk_check] 日志）..."
grep -q "\[disk_check\]" "$DISK_GUARD_FILE" || { echo "FAIL: 缺少 [disk_check] 日志"; exit 1; }
echo "  OK: [disk_check] 日志存在"

echo ""
echo "[disk-guard-smoke] ALL PASS"
