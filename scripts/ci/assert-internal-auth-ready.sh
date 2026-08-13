#!/usr/bin/env bash
# 生产内部鉴权效果断言：敏感入口的匿名请求必须在鉴权层返回 401。
set -uo pipefail

BRAIN_URL="${1:?用法: assert-internal-auth-ready.sh <brain_url>}"

if [[ -n "${INTERNAL_AUTH_STATUS_OVERRIDE:-}" ]]; then
  STATUS="$INTERNAL_AUTH_STATUS_OVERRIDE"
else
  STATUS=$(curl -sS -o /dev/null -w '%{http_code}' \
    --connect-timeout 10 --max-time 20 \
    -X POST "${BRAIN_URL%/}/api/brain/map/rebuild" \
    -H 'Content-Type: application/json' \
    --data '{}' 2>/dev/null || true)
fi

case "$STATUS" in
  401)
    echo "INTERNAL_AUTH_READY：敏感入口拒绝匿名请求"
    exit 0
    ;;
  503)
    echo "INTERNAL_AUTH_NOT_CONFIGURED：生产容器未注入 CECELIA_INTERNAL_TOKEN"
    exit 5
    ;;
  *)
    echo "INTERNAL_AUTH_UNENFORCED：敏感入口预期 HTTP 401，实际 HTTP ${STATUS:-000}"
    exit 6
    ;;
esac
