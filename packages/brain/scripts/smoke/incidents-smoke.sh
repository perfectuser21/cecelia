#!/usr/bin/env bash
# incidents-smoke.sh — incidents-layer smoke 验证
# task_id: c11cdec4-c845-447f-80da-9d528753be1d
# sprint: 07151515-incidents-layer
#
# 验证：GET /api/brain/incidents 端点可达，返回 JSON { incidents: [] }

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[smoke] incidents-layer smoke: GET ${BRAIN_URL}/api/brain/incidents"

RESPONSE=$(curl -sf --max-time 5 "${BRAIN_URL}/api/brain/incidents" 2>&1) || {
  echo "[smoke] FAIL: incidents endpoint unreachable or returned error"
  echo "[smoke] Response: ${RESPONSE:-<empty>}"
  exit 1
}

# 验证 response 含 incidents 字段
echo "$RESPONSE" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if (!Array.isArray(d.incidents)) {
  console.error('[smoke] FAIL: response.incidents is not an array');
  process.exit(1);
}
console.log('[smoke] PASS: incidents endpoint OK, count=' + d.incidents.length);
" || exit 1
