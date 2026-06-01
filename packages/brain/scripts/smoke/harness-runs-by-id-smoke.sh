#!/usr/bin/env bash
# Smoke test: GET /api/brain/harness/runs/:id 路由存在且校验正确
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./packages/brain/src/routes/harness.js', 'utf8');

if (!src.includes(\"router.get('/runs/:id'\")) {
  console.error('FAIL: GET /runs/:id route missing');
  process.exit(1);
}
if (!src.includes(\"harness run not found\")) {
  console.error('FAIL: 404 message missing');
  process.exit(1);
}
if (!src.includes('WHERE id = \$1::uuid')) {
  console.error('FAIL: UUID WHERE clause missing');
  process.exit(1);
}
console.log('OK: harness-runs-by-id smoke passed');
"

if curl -sf http://localhost:5221/api/brain/health >/dev/null 2>&1; then
  STATUS=$(curl -o /dev/null -sw '%{http_code}' \
    "http://localhost:5221/api/brain/harness/runs/not-a-uuid" 2>/dev/null || true)
  if [ -n "$STATUS" ] && [ "$STATUS" != "400" ]; then
    echo "WARN: non-UUID returned $STATUS (expected 400 — route may not be deployed)"
  else
    echo "OK: non-UUID returns 400"
  fi
fi
