#!/usr/bin/env bash
# =============================================================================
# rescan-if-changed.sh — 照相层事件扳机(2026-07-18)
# main SHA 变化或事实快照接近 freshness 上限时全量重扫。
# cron 安装(SSOT,系统时区 America/Los_Angeles):
#   */5 * * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/rescan-if-changed.sh >> /tmp/registry-scan.log 2>&1
# 每日 05:00 的 run-all-scans 全扫保留作兜底;账龄哨兵(>24h stale:true)继续押尾。
# 语义:
#   - ls-remote 失败 → 静默跳过(网络抖动不误触发,哨兵兜底)
#   - SHA 未变且最近成功扫描 <10min → 无输出退出
#   - SHA 变了 → 跑 run-all-scans,成功才记 SHA;失败不记账,下一轮自动重试
# 测试注入:RESCAN_STATE_FILE / RESCAN_SCAN_CMD
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."

STATE_FILE="${RESCAN_STATE_FILE:-/tmp/registry-scan-last-sha}"
SCAN_CMD="${RESCAN_SCAN_CMD:-bash scripts/scan/run-all-scans.sh}"
MAX_AGE_SEC="${RESCAN_MAX_AGE_SEC:-600}"
NOW_EPOCH="${RESCAN_NOW_EPOCH:-$(date +%s)}"

REMOTE_SHA=$(git ls-remote origin refs/heads/main 2>/dev/null | awk '{print $1}')
if [ -z "$REMOTE_SHA" ]; then
  exit 0
fi

STATE_VALUE=$(cat "$STATE_FILE" 2>/dev/null || echo "none|0")
LAST_SHA="${STATE_VALUE%%|*}"
if [[ "$STATE_VALUE" == *"|"* ]]; then
  LAST_SCAN_EPOCH="${STATE_VALUE#*|}"
else
  LAST_SCAN_EPOCH=0
fi
[[ "$LAST_SCAN_EPOCH" =~ ^[0-9]+$ ]] || LAST_SCAN_EPOCH=0
AGE_SEC=$((NOW_EPOCH - LAST_SCAN_EPOCH))
if [ "$REMOTE_SHA" = "$LAST_SHA" ] && (( AGE_SEC < MAX_AGE_SEC )); then
  exit 0
fi

echo "=== rescan-if-changed: main ${LAST_SHA:0:9} -> ${REMOTE_SHA:0:9} $(date '+%F %T %Z') ==="
if EXPECTED_SCAN_SHA="$REMOTE_SHA" $SCAN_CMD; then
  STATE_TMP="${STATE_FILE}.tmp.$$"
  printf '%s|%s\n' "$REMOTE_SHA" "$NOW_EPOCH" > "$STATE_TMP"
  mv "$STATE_TMP" "$STATE_FILE"
  echo "=== rescan 完成,SHA 已记账 ==="
else
  echo "=== rescan 失败,SHA 不记账(下一轮重试) ==="
  exit 1
fi
