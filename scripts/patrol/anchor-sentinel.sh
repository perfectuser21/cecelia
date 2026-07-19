#!/usr/bin/env bash
# anchor-sentinel.sh — 锚点断锚数哨兵(刀C 件②,2026-07-19)
# 规矩:断锚数(unanchored+uncovered)只许降不许升,升了告警不阻断。
# cron 安装(SSOT):
#   0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh && bash scripts/patrol/anchor-sentinel.sh >> /tmp/anchor-sentinel.log 2>&1
# 测试注入:ANCHOR_SENTINEL_STATE_FILE / ANCHOR_SENTINEL_CHECK_CMD / SENTINEL_NOTIFY_CMD
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/notify.sh"
NOTIFY_CMD="${SENTINEL_NOTIFY_CMD:-}"

STATE_FILE="${ANCHOR_SENTINEL_STATE_FILE:-/tmp/anchor-sentinel-last-broken-count}"
CHECK_CMD="${ANCHOR_SENTINEL_CHECK_CMD:-node $SCRIPT_DIR/../../packages/brain/scripts/anchor-sentinel-check.mjs}"

result=$($CHECK_CMD 2>&1)
broken=$(echo "$result" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).broken))" 2>/dev/null)

if [ -z "$broken" ]; then
  echo "ALERT: 锚点检查失败,输出: $result"
  exit 1
fi

if [ -f "$STATE_FILE" ]; then
  last=$(cat "$STATE_FILE" 2>/dev/null); last="${last:-0}"
  if [ "$broken" -gt "$last" ]; then
    echo "ALERT: 断锚数上升 $last → $broken"
    notify "锚点哨兵" "断锚数上升: $last → $broken,查 /api/brain/graph/locate 排查"
  else
    echo "OK: 断锚数 $broken(历史最高 $last)"
  fi
else
  echo "OK: 断锚数 $broken(首次记录,无历史基线)"
fi

echo "$broken" > "$STATE_FILE"
exit 0
