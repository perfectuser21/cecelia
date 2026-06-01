#!/usr/bin/env bash
# Smoke test: GET /api/brain/harness/runs/:id — 按 UUID 精确查询 initiative_runs
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module -e "
import { readFileSync } from 'fs';

const src = readFileSync('./packages/brain/src/routes/harness.js', 'utf8');

if (!src.includes(\"router.get('/runs/:id'\")) {
  console.error('FAIL: GET /runs/:id route missing in harness.js');
  process.exit(1);
}

if (!src.includes('invalid id: must be a UUID')) {
  console.error('FAIL: UUID validation error message missing');
  process.exit(1);
}

if (!src.includes('run not found')) {
  console.error('FAIL: 404 error message missing');
  process.exit(1);
}

if (!src.includes('WHERE id = \$1::uuid')) {
  console.error('FAIL: WHERE id = \$1::uuid clause missing');
  process.exit(1);
}

console.log('OK: harness-runs-by-id static check passed');
"

# 若 Brain 在本地运行，做真实 HTTP 验证
if curl -sf http://localhost:5221/api/brain/health >/dev/null 2>&1; then
  STATUS=$(curl -o /dev/null -sw '%{http_code}' \
    "http://localhost:5221/api/brain/harness/runs/not-a-uuid" 2>/dev/null || true)
  if [ "$STATUS" = "400" ]; then
    echo "OK: non-UUID returns 400"
  else
    echo "WARN: non-UUID returned $STATUS (expected 400)"
  fi

  STATUS=$(curl -o /dev/null -sw '%{http_code}' \
    "http://localhost:5221/api/brain/harness/runs/00000000-0000-0000-0000-000000000000" 2>/dev/null || true)
  if [ "$STATUS" = "404" ]; then
    echo "OK: unknown UUID returns 404"
  else
    echo "WARN: unknown UUID returned $STATUS (expected 404)"
  fi
fi
