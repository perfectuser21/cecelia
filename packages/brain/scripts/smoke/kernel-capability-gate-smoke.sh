#!/usr/bin/env bash
# Permanent offline smoke for the Kernel dispatch capability gate.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import {
  buildCapabilityEvidence,
  createCapabilityGate,
  parseCapabilityRequirements,
} from './packages/brain/src/orchestrator/preflight/capability-gate.js';
import {
  isVerifiedExecutionTarget,
  listVerifiedExecutionTargets,
  resolveExecutionTarget,
} from './packages/brain/src/orchestrator/preflight/execution-targets.js';
import {
  resolveCanonicalMachineId,
} from './packages/brain/src/orchestrator/preflight/canonical-machine-id.js';

for (const [name, value] of Object.entries({
  buildCapabilityEvidence,
  createCapabilityGate,
  parseCapabilityRequirements,
  isVerifiedExecutionTarget,
  listVerifiedExecutionTargets,
  resolveExecutionTarget,
  resolveCanonicalMachineId,
})) {
  if (typeof value !== 'function') throw new Error(`missing export ${name}`);
}

const targets = listVerifiedExecutionTargets();
if (targets.length !== 18 || targets.some((target) => !isVerifiedExecutionTarget(target))) {
  throw new Error('verified ExecutionTarget matrix is not exactly 18 valid entries');
}
if (isVerifiedExecutionTarget({
  provider: 'claude',
  account: 'account1',
  machine: 'xian-mac-m4',
})) {
  throw new Error('unverified cross-vendor target was accepted');
}

const machine = resolveCanonicalMachineId({
  envMachineId: 'us-mac-m4',
  hostname: 'docker-ephemeral-hostname',
});
if (machine !== 'us-mac-m4') throw new Error('canonical machine resolver drifted');

const evidence = buildCapabilityEvidence({
  capability_snapshot_id: 'smoke',
  authorization: 'secret',
  token: 'secret',
});
if (JSON.stringify(evidence).includes('secret')) {
  throw new Error('capability evidence leaked credential material');
}
NODE

grep -q 'preflightGate.evaluate' packages/brain/src/orchestrator/dispatcher.js
grep -q 'validateSnapshotForDispatch' packages/brain/src/orchestrator/dispatcher.js

echo "kernel-capability-gate-smoke: PASS"

