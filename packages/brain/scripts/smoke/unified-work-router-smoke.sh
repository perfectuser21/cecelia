#!/usr/bin/env bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
test -f packages/brain/src/work-router.js
test -f packages/brain/src/work-routing-store.js
test -f packages/brain/src/orchestrator/preflight/map-impact-contract.js
node --input-type=module -e "import('./packages/brain/src/work-router.js').then(m=>{const r=m.selectPipeline({work_kind:'coding_mutation',change_kind:'bugfix'});if(r.pipeline!=='harness'||!r.impact_contract_required)process.exit(1)})"
echo 'Unified Work Router smoke PASS'
