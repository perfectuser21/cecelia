#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(cd "$SCRIPT_DIR/../.." && pwd)"

node --input-type=module <<'NODE'
import { buildTrustedExecutionRequest, verifyTrustedExecution }
  from './src/lib/gp-assertion-trusted-execution.js';

const digest = `sha256:${'a'.repeat(64)}`;
const request = buildTrustedExecutionRequest({
  run_id: '11111111-1111-4111-8111-111111111111',
  journey_step_link_id: '22222222-2222-4222-8222-222222222222',
  machine_id: 'us-mac-m4',
  expected_runner_digest: digest,
  source_repo: 'github.com/perfectuser21/cecelia',
  source_sha: 'c'.repeat(40),
  workspace_root: '/workspace',
  timeout_ms: 2_000,
  command: { executable: '/bin/bash', argv: ['/workspace/smoke/assertion.sh'],
    options: { cwd: '/workspace', evidenceKind: 'bash' } },
});
const admission = {
  machine_id: 'us-mac-m4',
  state: 'base_admitted',
  base_admitted: true,
  dispatch_ready: true,
  observed_at: '2026-07-30T07:59:59.000Z',
};
const verified = verifyTrustedExecution({
  request,
  admission,
  receipt: {
    schema_version: 'gp-assertion-execution/v1',
    run_id: request.run_id,
    journey_step_link_id: request.journey_step_link_id,
    machine_id: request.machine_id,
    runner_image_digest: digest,
    source_repo: request.source_repo,
    source_sha: request.source_sha,
    command_digest: request.command_digest,
    isolation: { rootfs_read_only: true, workspace_read_only: true },
    exit_code: 0, stdout: 'GP_ASSERTION_SCENARIO_COUNT=1', stderr: '',
    started_at: '2026-07-30T08:00:00.000Z',
    completed_at: '2026-07-30T08:00:01.000Z',
  },
});
if (!Object.isFrozen(request.command.argv)) process.exit(1);
if (verified.execution.exitCode !== 0) process.exit(1);
if (verified.scenario_evidence.trusted_execution.runner_image_digest !== digest)
  process.exit(1);
console.log('GP_ASSERTION_TRUSTED_EXECUTION_CONTRACT_SMOKE_PASS');
NODE
