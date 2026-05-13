#!/usr/bin/env bash
# B19 smoke — fixDispatchNode 不 reset pr_url/pr_branch
set -euo pipefail
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"
if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[B19 smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi
docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { fixDispatchNode } from './src/workflows/harness-task.graph.js';
const result = await fixDispatchNode({ fix_round: 1, pr_url: 'https://github.com/x/y/pull/2937', pr_branch: 'cp-test' });
if (result.pr_url !== undefined) { console.error('FAIL: pr_url 应 undefined, got', result.pr_url); process.exit(1); }
if (result.pr_branch !== undefined) { console.error('FAIL: pr_branch 应 undefined, got', result.pr_branch); process.exit(1); }
if (result.fix_round !== 2) { console.error('FAIL: fix_round 应 2, got', result.fix_round); process.exit(1); }
console.log('[B19 smoke] PASS — fixDispatchNode 保留 pr_url/pr_branch');
" || { echo "[B19 smoke] FAIL"; exit 1; }
