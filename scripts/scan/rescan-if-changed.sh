#!/usr/bin/env bash
# =============================================================================
# rescan-if-changed.sh — 照相层事件扳机(2026-07-18)
# main SHA 变化或上次成功扫描超过 10 分钟就重扫，保证 15 分钟 freshness 不腐烂。
# cron 安装(SSOT,系统时区 America/Los_Angeles):
#   */5 * * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/rescan-if-changed.sh >> /tmp/registry-scan.log 2>&1
# 每日 05:00 的 run-all-scans 全扫保留作兜底;账龄哨兵(>24h stale:true)继续押尾。
# 语义:
#   - ls-remote 失败 → 静默跳过(网络抖动不误触发,哨兵兜底)
#   - SHA 未变且成功扫描账龄 <10min → 无输出退出(cron 日志不刷屏)
#   - SHA 变了 → 跑 run-all-scans,成功才记 SHA;失败不记账,下一轮自动重试
# 测试注入:RESCAN_STATE_FILE / RESCAN_SCAN_CMD
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

STATE_FILE="${RESCAN_STATE_FILE:-/tmp/registry-scan-last-sha}"
SCAN_CMD="${RESCAN_SCAN_CMD:-bash scripts/scan/run-all-scans.sh}"
MAX_SCAN_AGE_SECONDS="${RESCAN_MAX_AGE_SECONDS:-600}"
NOW_EPOCH="${RESCAN_NOW_EPOCH:-$(date +%s)}"

REMOTE_SHA=$(git ls-remote origin refs/heads/main 2>/dev/null | awk '{print $1}')
if [ -z "$REMOTE_SHA" ]; then
  exit 0
fi

read -r LAST_SHA LAST_SCAN_EPOCH < "$STATE_FILE" 2>/dev/null || {
  LAST_SHA="none"
  LAST_SCAN_EPOCH=0
}
if [[ -z "${LAST_SCAN_EPOCH:-}" || ! "$LAST_SCAN_EPOCH" =~ ^[0-9]+$ ]]; then
  LAST_SCAN_EPOCH=$(stat -f %m "$STATE_FILE" 2>/dev/null || stat -c %Y "$STATE_FILE" 2>/dev/null || echo 0)
fi
SCAN_AGE=$((NOW_EPOCH - LAST_SCAN_EPOCH))
if [ "$REMOTE_SHA" = "$LAST_SHA" ] && (( SCAN_AGE < MAX_SCAN_AGE_SECONDS )); then
  exit 0
fi

echo "=== rescan-if-changed: main ${LAST_SHA:0:9} -> ${REMOTE_SHA:0:9} age=${SCAN_AGE}s $(date '+%F %T %Z') ==="
if $SCAN_CMD; then
  printf '%s %s\n' "$REMOTE_SHA" "$NOW_EPOCH" > "$STATE_FILE"
  echo "=== rescan 完成,SHA 已记账 ==="
else
  echo "=== rescan 失败,SHA 不记账(下一轮重试) ==="
  exit 1
fi
