#!/usr/bin/env bash
# harness-initiative-detail smoke — static checks only (no live server needed, CI-safe)
set -euo pipefail

ROUTE_FILE="packages/brain/src/routes/harness.js"

echo "[harness-initiative-detail-smoke] Checking route file exists..."
[ -f "$ROUTE_FILE" ] || { echo "FAIL: $ROUTE_FILE not found"; exit 1; }

echo "[harness-initiative-detail-smoke] Checking /initiative/:id/detail route defined..."
node -e "const c=require('fs').readFileSync('$ROUTE_FILE','utf8');if(!c.includes('/initiative/:id/detail'))throw new Error('route missing');console.log('OK')"

echo "[harness-initiative-detail-smoke] Checking UUID validation present..."
node -e "const c=require('fs').readFileSync('$ROUTE_FILE','utf8');if(!c.includes('invalid id'))throw new Error('UUID validation missing');console.log('OK')"

echo "[harness-initiative-detail-smoke] Checking screenshot_urls empty array response..."
node -e "const c=require('fs').readFileSync('$ROUTE_FILE','utf8');if(!c.includes('screenshot_urls'))throw new Error('screenshot_urls field missing');console.log('OK')"

echo "[harness-initiative-detail-smoke] Checking step_timing field present..."
node -e "const c=require('fs').readFileSync('$ROUTE_FILE','utf8');if(!c.includes('step_timing'))throw new Error('step_timing field missing');console.log('OK')"

echo "[harness-initiative-detail-smoke] ALL CHECKS PASSED"
exit 0
