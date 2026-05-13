#!/usr/bin/env bash
# B21 smoke — mergePrNode 函数源码含 `gh pr merge --auto --squash` 与 state.pr_url
set -euo pipefail
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"
if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[B21 smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi
docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-task.graph.js', 'utf8');
const checks = [
  { name: 'mergePrNode 含 gh pr merge --auto/--squash', regex: /gh.*pr.*merge.*--auto|gh.*pr.*merge.*--squash/i },
  { name: '使用 state.pr_url', regex: /state[?]?\\.pr_url/ },
];
let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) { console.error('FAIL:', c.name); fail = true; }
}
if (fail) process.exit(1);
console.log('[B21 smoke] PASS');
" || { echo '[B21 smoke] FAIL'; exit 1; }
