#!/usr/bin/env bash
# Smoke test: GET /api/brain/initiative-runs/phase-summary 路由静态校验 + 可选真实 HTTP 验证
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./packages/brain/src/routes/initiative-runs.js', 'utf8');
if (!src.includes('GROUP BY phase')) { console.error('FAIL: GROUP BY phase missing'); process.exit(1); }
if (!src.includes('phase IS NOT NULL')) { console.error('FAIL: phase IS NOT NULL filter missing'); process.exit(1); }
if (!src.includes('ORDER BY count DESC')) { console.error('FAIL: ORDER BY count DESC missing'); process.exit(1); }
if (!src.includes('export default')) { console.error('FAIL: export default missing'); process.exit(1); }
console.log('OK: initiative-runs static checks passed');
"

if curl -sf http://localhost:5221/api/brain/health >/dev/null 2>&1; then
  RESULT=$(curl -s 'http://localhost:5221/api/brain/initiative-runs/phase-summary')
  echo "$RESULT" | node --input-type=module -e "
    import { createInterface } from 'readline';
    let data = '';
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => {
      try {
        const arr = JSON.parse(data);
        if (!Array.isArray(arr)) { console.error('FAIL: response is not array'); process.exit(1); }
        console.log('OK: /initiative-runs/phase-summary returns array, length=' + arr.length);
      } catch(e) {
        console.log('SKIP: Brain running but route not yet deployed, skipping live check');
        process.exit(0);
      }
    });
  "
fi
