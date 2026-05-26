#!/usr/bin/env bash
# reportNode fields smoke — static checks only (no live server needed, CI-safe)
set -euo pipefail

IMPL_FILE="packages/brain/src/workflows/harness-initiative.graph.js"

echo "[reportnode-fields-smoke] Checking step_timing field..."
grep -q "step_timing" "$IMPL_FILE" || { echo "FAIL: step_timing missing from reportNode"; exit 1; }

echo "[reportnode-fields-smoke] Checking ws_issues field..."
grep -q "ws_issues" "$IMPL_FILE" || { echo "FAIL: ws_issues missing from reportNode"; exit 1; }

echo "[reportnode-fields-smoke] Checking ws_costs field..."
grep -q "ws_costs" "$IMPL_FILE" || { echo "FAIL: ws_costs missing from reportNode"; exit 1; }

echo "[reportnode-fields-smoke] Checking report_content write..."
grep -q "report_content" "$IMPL_FILE" || { echo "FAIL: report_content write missing from reportNode"; exit 1; }

echo "[reportnode-fields-smoke] Checking no banned field names in reportNode context..."
node -e "
const c = require('fs').readFileSync('$IMPL_FILE', 'utf8');
const start = c.indexOf('export async function reportNode');
const slice = c.slice(start, start + 3000);
const banned = ['timings', 'timing', 'issues', 'costs', 'breakdown'];
banned.forEach(f => {
  const rx = new RegExp('[\"\\x27]' + f + '[\"\\x27]\\s*:');
  if (rx.test(slice)) {
    console.error('FAIL: banned field used as key in reportNode:', f);
    process.exit(1);
  }
});
console.log('OK');
"

echo "[reportnode-fields-smoke] ALL CHECKS PASSED"
exit 0
