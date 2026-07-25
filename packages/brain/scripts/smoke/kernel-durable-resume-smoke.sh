#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { recoverDurableRun } from './packages/brain/src/orchestrator/durable-resume.js';

if (typeof recoverDurableRun !== 'function') {
  throw new Error('recoverDurableRun export missing');
}

const relay = readFileSync(
  'packages/brain/src/harness-skill-relay.js',
  'utf8',
);
for (const token of [
  'BEGIN',
  'initiative_contracts',
  'contract_id',
  'COMMIT',
  'ROLLBACK',
]) {
  if (!relay.includes(token)) {
    throw new Error(`kernel bootstrap transaction token missing: ${token}`);
  }
}

const resume = readFileSync(
  'packages/brain/src/orchestrator/durable-resume.js',
  'utf8',
);
for (const token of [
  'getActiveByRun',
  'provider_session_id',
  'orphan_without_provider_session',
  'collectGroundTruth',
  'deriveCounters',
]) {
  if (!resume.includes(token)) {
    throw new Error(`durable resume wiring token missing: ${token}`);
  }
}
NODE

bash scripts/check-version-sync.sh
echo "OK: kernel durable resume smoke"
