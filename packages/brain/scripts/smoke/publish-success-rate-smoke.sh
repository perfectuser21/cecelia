#!/usr/bin/env bash
# publish-success-rate-smoke.sh
# GET /api/brain/publish/success-rate 端点验收
# Case 1: HTTP 200 返回数组
# Case 2: 返回数组长度 <= days 参数
# Case 3: 每项含 date/success_rate/total/completed/failed 字段（即使为空数组也不报错）
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[smoke:publish-success-rate] 验收 GET /api/brain/publish/success-rate"

# ── Case 1: HTTP 200 ──────────────────────────────────────────────────────────
echo "[smoke] Case 1: HTTP 200"
HTTP_STATUS=$(curl -s -o /tmp/success_rate_resp.json -w "%{http_code}" \
  "${BRAIN_URL}/api/brain/publish/success-rate?days=7")

if [ "$HTTP_STATUS" != "200" ]; then
  echo "FAIL Case 1: expected HTTP 200, got $HTTP_STATUS"
  cat /tmp/success_rate_resp.json
  exit 1
fi
echo "[smoke] Case 1 PASS: HTTP 200"

# ── Case 2: 返回数组，长度 <= 7 ───────────────────────────────────────────────
echo "[smoke] Case 2: 返回数组且长度 <= 7"
RESP=$(cat /tmp/success_rate_resp.json)

IS_ARRAY=$(node -e "const r = JSON.parse(process.argv[1]); console.log(Array.isArray(r) ? 'yes' : 'no')" "$RESP")
if [ "$IS_ARRAY" != "yes" ]; then
  echo "FAIL Case 2: response is not an array"
  echo "$RESP"
  exit 1
fi

LEN=$(node -e "const r = JSON.parse(process.argv[1]); console.log(r.length)" "$RESP")
if [ "$LEN" -gt 7 ]; then
  echo "FAIL Case 2: array length $LEN > 7"
  exit 1
fi
echo "[smoke] Case 2 PASS: 数组长度 = $LEN (<= 7)"

# ── Case 3: 字段完整性（如有数据则验证字段） ─────────────────────────────────
echo "[smoke] Case 3: 字段完整性检查"
node - "$RESP" << 'JS'
const rows = JSON.parse(process.argv[1]);
for (const r of rows) {
  const missing = ['date','success_rate','total','completed','failed'].filter(k => !(k in r));
  if (missing.length > 0) {
    console.error('FAIL Case 3: row missing fields:', missing.join(','), JSON.stringify(r));
    process.exit(1);
  }
}
console.log('[smoke] Case 3 PASS: 字段完整 (' + rows.length + ' 行)');
JS

echo "[smoke:publish-success-rate] 全部验收通过"
