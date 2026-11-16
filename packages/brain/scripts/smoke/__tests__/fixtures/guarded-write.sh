#!/usr/bin/env bash
# 仅供安全回归调用：地址必须同时匹配fixture私有随机端口。
set -euo pipefail
BRAIN="${BRAIN:-${BRAIN_URL:-}}"
if ! node "$(dirname "${BASH_SOURCE[0]}")/../../../lib/smoke-production-guard.mjs" "$BRAIN"; then
  exit 0
fi
[[ "$BRAIN" = "${GUARD_PRIVATE_BRAIN_URL:-}" && "$BRAIN" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || exit 1
curl -q -sf --max-time 3 -X POST "$BRAIN/api/brain/notes" \
  -H 'Content-Type: application/json' -d '{"title":"private guard fixture","content":"synthetic"}' >/dev/null
