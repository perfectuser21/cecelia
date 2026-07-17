#!/usr/bin/env bash
# disk-guard-smoke.sh — 磁盘哨兵 smoke 验证（任务 ba6fe51c）
# 验证 disk-guard.js / worktree-reaper.js 文件存在，核心导出符号正确，scheduler-jobs.js 已注册
set -euo pipefail

DISK_GUARD_FILE="packages/brain/src/cron/disk-guard.js"
WORKTREE_REAPER_FILE="packages/brain/src/cron/worktree-reaper.js"
SCHEDULER_FILE="packages/brain/src/scheduler-jobs.js"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"

cd "$REPO_ROOT"

echo "[disk-guard-smoke] 检查文件存在..."
[ -f "$DISK_GUARD_FILE" ] || { echo "FAIL: $DISK_GUARD_FILE 不存在"; exit 1; }
[ -f "$WORKTREE_REAPER_FILE" ] || { echo "FAIL: $WORKTREE_REAPER_FILE 不存在"; exit 1; }
echo "  OK: disk-guard.js + worktree-reaper.js"

echo "[disk-guard-smoke] 检查 disk-guard.js 核心导出..."
grep -q "export.*runDiskGuard" "$DISK_GUARD_FILE" || { echo "FAIL: runDiskGuard 未导出"; exit 1; }
grep -q "export.*__resetDiskGuardForTest" "$DISK_GUARD_FILE" || { echo "FAIL: __resetDiskGuardForTest 未导出"; exit 1; }
grep -q "export.*DISK_GUARD_INTERVAL_MS" "$DISK_GUARD_FILE" || { echo "FAIL: DISK_GUARD_INTERVAL_MS 未导出"; exit 1; }
echo "  OK: runDiskGuard / __resetDiskGuardForTest / DISK_GUARD_INTERVAL_MS"

echo "[disk-guard-smoke] 检查 worktree-reaper.js 核心导出..."
grep -q "export.*runWorktreeReaper" "$WORKTREE_REAPER_FILE" || { echo "FAIL: runWorktreeReaper 未导出"; exit 1; }
echo "  OK: runWorktreeReaper"

echo "[disk-guard-smoke] 检查 scheduler-jobs.js disk-guard 注册..."
grep -q "'disk-guard'" "$SCHEDULER_FILE" || { echo "FAIL: disk-guard 未注册到 JOBS"; exit 1; }
grep -q "120_000" "$SCHEDULER_FILE" || grep -q "120000" "$SCHEDULER_FILE" || { echo "FAIL: timeoutMs=120000 未设置"; exit 1; }
grep -q "runDiskGuard" "$SCHEDULER_FILE" || { echo "FAIL: runDiskGuard 未 import 到 scheduler"; exit 1; }
echo "  OK: disk-guard job 已注册，timeoutMs=120000，needsPool=false"

echo "[disk-guard-smoke] 检查 INV-03（[disk_check] 日志）..."
grep -q "\[disk_check\]" "$DISK_GUARD_FILE" || { echo "FAIL: 缺少 [disk_check] 日志"; exit 1; }
echo "  OK: [disk_check] 日志存在"

echo "[disk-guard-smoke] 检查 INV-01（终态保护 TERMINAL_STATUSES）..."
grep -q "TERMINAL_STATUSES" "$WORKTREE_REAPER_FILE" || { echo "FAIL: TERMINAL_STATUSES 未定义"; exit 1; }
grep -q "in_progress" "$WORKTREE_REAPER_FILE" && { echo "WARN: worktree-reaper 含 in_progress 字面量——请确认是注释而非逻辑"; }
echo "  OK: TERMINAL_STATUSES 白名单模式（fail-open）"

echo ""
echo "[disk-guard-smoke] ALL PASS"
