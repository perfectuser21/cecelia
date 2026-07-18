#!/usr/bin/env bash
# notify.sh — 哨兵共享告警函数,POST Brain harness/notify
# 测试注入:NOTIFY_CMD(设置了就调用它而不是 curl)
notify() {
  local title="$1"
  local message="$2"
  if [ -n "${NOTIFY_CMD:-}" ]; then
    $NOTIFY_CMD "$message" || true
  else
    curl -s -m 5 -X POST localhost:5221/api/brain/harness/notify \
      -H 'Content-Type: application/json' \
      -d "{\"title\":\"${title}\",\"message\":\"${message}\"}" >/dev/null 2>&1 || true
  fi
}
