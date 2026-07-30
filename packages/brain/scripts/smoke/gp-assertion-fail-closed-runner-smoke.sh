#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT/packages/brain"

node --input-type=module <<'NODE'
const { runGpAssertion } = await import('./src/gp-assertion-runner.js');
let touched = false;
try {
  await runGpAssertion({
    pool: { connect() { touched = true; } },
    getSourceSha() { touched = true; },
    execute() { touched = true; },
  });
  throw new Error('trusted Runner absence did not fail closed');
} catch (error) {
  if (error.code !== 'ASSERTION_TRUSTED_RUNNER_UNAVAILABLE' || touched) throw error;
}
console.log('GP_ASSERTION_FAIL_CLOSED_RUNNER_SMOKE_PASS');
NODE
