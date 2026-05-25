#!/usr/bin/env bash
# ws4-report-node-smoke — static checks for reportNode step_timing/ws_issues/ws_costs fields
set -euo pipefail

GRAPH_FILE="packages/brain/src/workflows/harness-initiative.graph.js"

echo "[ws4-report-node-smoke] Checking graph file exists..."
[ -f "$GRAPH_FILE" ] || { echo "FAIL: $GRAPH_FILE not found"; exit 1; }

echo "[ws4-report-node-smoke] Checking reportNode function present..."
node -e "
const c = require('fs').readFileSync('$GRAPH_FILE', 'utf8');
if (!c.includes('export async function reportNode')) { process.stderr.write('FAIL: reportNode not exported\n'); process.exit(1); }
" || exit 1

echo "[ws4-report-node-smoke] Checking step_timing field..."
node -e "
const c = require('fs').readFileSync('$GRAPH_FILE', 'utf8');
const fn = c.slice(c.indexOf('reportNode'));
if (!fn.includes('step_timing')) { process.stderr.write('FAIL: step_timing missing\n'); process.exit(1); }
" || exit 1

echo "[ws4-report-node-smoke] Checking ws_issues and ws_costs fields..."
node -e "
const c = require('fs').readFileSync('$GRAPH_FILE', 'utf8');
const fn = c.slice(c.indexOf('reportNode'));
if (!fn.includes('ws_issues') || !fn.includes('ws_costs')) { process.stderr.write('FAIL: ws_issues or ws_costs missing\n'); process.exit(1); }
" || exit 1

echo "[ws4-report-node-smoke] Checking report_content key used (not report_path)..."
node -e "
const c = require('fs').readFileSync('$GRAPH_FILE', 'utf8');
const fn = c.slice(c.indexOf('reportNode'), c.indexOf('reportNode') + 3000);
if (!fn.includes('report_content')) { process.stderr.write('FAIL: report_content key missing\n'); process.exit(1); }
if (fn.includes('report_path')) { process.stderr.write('FAIL: banned report_path key present\n'); process.exit(1); }
" || exit 1

echo "[ws4-report-node-smoke] Checking no banned field names (timings/timing/issues/costs/breakdown)..."
node -e "
const c = require('fs').readFileSync('$GRAPH_FILE', 'utf8');
const fn = c.slice(c.indexOf('reportNode'), c.indexOf('reportNode') + 3000);
['timings:', 'timing:', 'issues:', 'costs:', 'breakdown:'].forEach(k => {
  if (fn.includes(k)) { process.stderr.write('FAIL: banned field ' + k + '\n'); process.exit(1); }
});
" || exit 1

echo "[ws4-report-node-smoke] ALL CHECKS PASSED"
exit 0
