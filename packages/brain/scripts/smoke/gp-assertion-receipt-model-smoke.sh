#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BRAIN_DIR"

node --input-type=module <<'NODE'
import {
  assertionDigest,
  deriveAssertionVerification,
} from './src/lib/journey-assertion-receipt.js';

const cell = {
  assertion_ref: 'tests/smoke.test.js',
  assertion_revision: 1,
};
const receipt = {
  id: 'smoke-pass',
  run_id: 'smoke-run',
  assertion_revision: 1,
  assertion_digest: assertionDigest(cell.assertion_ref),
  verdict: 'PASS',
  source_sha: 'a'.repeat(40),
  machine_id: 'smoke-runner',
  output_digest: 'b'.repeat(64),
  exit_code: 0,
  synthetic: false,
  completed_at: '2026-07-30T00:00:00Z',
};
const legacy = deriveAssertionVerification(cell, [{
  ...receipt, scenario_count: 0, scenario_evidence: {},
}]);
const evidenced = deriveAssertionVerification(cell, [{
  ...receipt, scenario_count: 1, scenario_evidence: { kind: 'smoke', passed: 1 },
}]);
if (legacy.state !== 'never_run' || legacy.verified) process.exit(1);
if (evidenced.state !== 'verified' || !evidenced.verified) process.exit(1);
console.log('GP_ASSERTION_RECEIPT_MODEL_SMOKE_PASS');
NODE
