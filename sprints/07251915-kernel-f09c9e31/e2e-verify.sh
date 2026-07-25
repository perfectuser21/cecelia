#!/usr/bin/env bash
set -euo pipefail

SPRINT_DIR="${SPRINT_DIR:-sprints/07251915-kernel-f09c9e31}"
export NODE_ENV=test
export DB_NAME="${DB_NAME:-cecelia_test}"

echo "kernel durable resume E2E start $(date -u +%Y-%m-%dT%H:%M:%SZ)"

npx vitest run "${SPRINT_DIR}/tests/kernel-durable-resume.test.ts" --reporter=verbose

CURRENT_BRANCH="$(git branch --show-current)"
PR_JSON="$(gh pr view "${CURRENT_BRANCH}" --json url,state,headRefOid,statusCheckRollup)"
echo "${PR_JSON}" | jq -e '.state == "OPEN" and (.url | type == "string" and startswith("https://github.com/")) and (.headRefOid | type == "string" and length >= 7) and (.statusCheckRollup | type == "array")'

(
  cd packages/brain
  npx vitest run \
    src/orchestrator/__tests__/contract-store.test.js \
    src/orchestrator/__tests__/attempt-store.test.js \
    src/orchestrator/__tests__/ground-truth.test.js \
    src/orchestrator/__tests__/derive.test.js \
    src/orchestrator/__tests__/counters.test.js \
    src/orchestrator/__tests__/loop.test.js \
    src/__tests__/harness-kernel-resume-secret.test.js \
    --reporter=verbose
)

node --input-type=module <<'NODE'
import { existsSync, readFileSync } from 'node:fs';

const paths = [
  'packages/brain/src/orchestrator/durable-resume.js',
  'packages/brain/src/orchestrator/contract-store.js',
  'packages/brain/src/orchestrator/ground-truth.js',
  'packages/brain/src/orchestrator/counters.js',
  'packages/brain/src/orchestrator/derive.js',
  'packages/brain/src/orchestrator/attempt-store.js',
  'packages/brain/src/harness-skill-relay.js',
];
for (const path of paths) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
}
const source = paths.map((path) => readFileSync(path, 'utf8')).join('\n');
for (const token of ['contract_branch', 'natural language status']) {
  if (source.includes(token)) throw new Error(`forbidden token ${token}`);
}
console.log('OK: existing Kernel modules present and no forbidden ledger token');
NODE

bash scripts/check-version-sync.sh
node -e "const fs=require('fs');const pkg=require('./packages/brain/package.json').version;const v=fs.readFileSync('packages/brain/VERSION','utf8').trim();if(v!==pkg)process.exit(1);console.log('OK: Brain VERSION sync')"

echo "OK kernel durable resume E2E"
