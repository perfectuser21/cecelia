#!/usr/bin/env bash
# publish-success-rate-smoke.sh
# GET /api/brain/publish/success-rate 端点验收
# Case 1: HTTP 200 返回数组
# Case 2: 返回数组长度 <= days 参数
# Case 3: 每项含 date/success_rate/total/completed/failed 字段
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP_FILE="/tmp/publish_success_rate_smoke.json"

echo "[smoke:publish-success-rate] 验收 GET /api/brain/publish/success-rate"

# ── Case 1: HTTP 200 ──────────────────────────────────────────────────────────
echo "[smoke] Case 1: HTTP 200"
HTTP_STATUS=$(curl -s -o "$RESP_FILE" -w "%{http_code}" \
  "${BRAIN_URL}/api/brain/publish/success-rate?days=7")

if [ "$HTTP_STATUS" != "200" ]; then
  echo "FAIL Case 1: expected HTTP 200, got $HTTP_STATUS"
  cat "$RESP_FILE"
  exit 1
fi
echo "[smoke] Case 1 PASS: HTTP 200"

# ── Case 2: 返回数组，长度 <= 7 ───────────────────────────────────────────────
echo "[smoke] Case 2: 返回数组且长度 <= 7"
node -e "
  const fs = require('fs');
  const rows = JSON.parse(fs.readFileSync('$RESP_FILE', 'utf8'));
  if (!Array.isArray(rows)) { console.error('FAIL: not array'); process.exit(1); }
  if (rows.length > 7) { console.error('FAIL: length', rows.length, '> 7'); process.exit(1); }
  console.log('[smoke] Case 2 PASS: array length =', rows.length);
"

# ── Case 3: 字段完整性 ────────────────────────────────────────────────────────
echo "[smoke] Case 3: 字段完整性检查"
node -e "
  const fs = require('fs');
  const rows = JSON.parse(fs.readFileSync('$RESP_FILE', 'utf8'));
  const REQUIRED = ['date', 'success_rate', 'total', 'completed', 'failed'];
  for (const r of rows) {
    const missing = REQUIRED.filter(k => !(k in r));
    if (missing.length > 0) {
      console.error('FAIL Case 3: row missing fields:', missing.join(','), JSON.stringify(r));
      process.exit(1);
    }
  }
  console.log('[smoke] Case 3 PASS: 字段完整 (' + rows.length + ' 行)');
"

echo "[smoke:publish-success-rate] 全部验收通过"
