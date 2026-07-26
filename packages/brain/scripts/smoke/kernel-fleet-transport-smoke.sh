#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

node --input-type=module <<'NODE'
import {
  createProductionExecutionTransport,
  DEFAULT_LOCAL_MACHINE_ID,
} from './packages/brain/src/orchestrator/production-transport.js';

let fetchCalls = 0;
let spawnCalls = 0;
const transport = createProductionExecutionTransport({
  env: {},
  fetchFn: async () => {
    fetchCalls += 1;
    throw new Error('remote fetch must stay disabled');
  },
  spawnDetached: async ({ containerId }) => {
    spawnCalls += 1;
    return { containerId };
  },
});

try {
  await transport.launch({
    attempt: { id: 'remote-attempt' },
    target: { machine: 'xian-mac-m4' },
  });
  throw new Error('default remote launch unexpectedly succeeded');
} catch (error) {
  if (error.message !== 'execution_transport_unavailable:xian-mac-m4') throw error;
}
if (fetchCalls !== 0) throw new Error(`disabled remote transport fetched ${fetchCalls} times`);

const attempt = {
  id: '87654321-0000-4000-8000-000000000000',
  run_id: 'run-local-smoke',
  hop: 1,
  role: 'generator',
  callbackSecret: 'local-smoke-callback-token',
  lease_owner: 'local-smoke-owner',
  lease_generation: 0,
};
const result = await transport.launch({
  attempt,
  bundle: {
    inputs: { task_id: 'task-local-smoke', worktree_path: '/tmp/kernel-local-smoke' },
    constraints: { read_only: false },
  },
  spec: { provider: 'codex', env: {}, args: [], stdin: 'local smoke' },
  task: { id: 'task-local-smoke' },
  target: { machine: DEFAULT_LOCAL_MACHINE_ID },
  leaseClaimed: true,
});
if (result.executionTransport !== 'local-docker'
    || result.actualMachineId !== DEFAULT_LOCAL_MACHINE_ID
    || result.containerId !== 'cecelia-harness-87654321-g0'
    || spawnCalls !== 1) {
  throw new Error(`local production route drifted: ${JSON.stringify({ result, spawnCalls })}`);
}

console.log('PASS: production fleet transport is remote-disabled and local-capable by default');
NODE
