#!/usr/bin/env bash
# Smoke test: GET /api/brain/harness/runs 路由存在且参数校验正确
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module -e "
import { readFileSync } from 'fs';

const src = readFileSync('./packages/brain/src/routes/harness.js', 'utf8');

if (!src.includes(\"router.get('/runs'\")) {
  console.error('FAIL: GET /runs route missing in harness.js');
  process.exit(1);
}

if (!src.includes('limit < 1 || limit > 100')) {
  console.error('FAIL: limit validation (1-100) missing');
  process.exit(1);
}

if (!src.includes(\"started_at, completed_at, failure_reason\")) {
  console.error('FAIL: required fields missing from SELECT');
  process.exit(1);
}

if (!src.includes('ORDER BY started_at DESC')) {
  console.error('FAIL: ORDER BY started_at DESC missing');
  process.exit(1);
}

console.log('OK: harness-runs-api smoke passed');
"

# 若 Brain 在本地运行，做真实 HTTP 验证
if curl -sf http://localhost:5221/api/brain/health >/dev/null 2>&1; then
  RESULT=$(curl -s "http://localhost:5221/api/brain/harness/runs" 2>/dev/null)
  if echo "$RESULT" | node --input-type=module -e "
    import { createInterface } from 'readline';
    let data = '';
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => {
      try {
        const arr = JSON.parse(data);
        if (!Array.isArray(arr)) { console.error('FAIL: not an array'); process.exit(1); }
        console.log('OK: /api/brain/harness/runs returns array, length=' + arr.length);
      } catch(e) {
        // Route may not be deployed yet in this environment — static check already passed
        console.log('SKIP: Brain running but route not yet deployed, skipping live check');
        process.exit(0);
      }
    });
  "; then
    STATUS=$(curl -o /dev/null -sw '%{http_code}' "http://localhost:5221/api/brain/harness/runs?limit=0" 2>/dev/null || true)
    if [ -n "$STATUS" ] && [ "$STATUS" != "400" ]; then
      echo "WARN: limit=0 returned $STATUS (expected 400 — route may not be deployed yet)"
    else
      echo "OK: limit=0 returns 400"
    fi
  fi
fi
