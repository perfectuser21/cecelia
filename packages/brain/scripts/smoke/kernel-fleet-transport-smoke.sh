#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

node --input-type=module <<'NODE'
import { createServer } from 'node:http';

import { signMachineAttestation } from './packages/brain/src/orchestrator/machine-attestation.js';
import { createRemoteBridgeTransport } from './packages/brain/src/orchestrator/remote-bridge-transport.js';

const machine = 'xian-mac-m4';
const sharedSecret = 'fleet-smoke-secret-that-is-at-least-32-bytes';
const jobId = 'fleet-smoke-job';
const attempt = {
  id: '87654321-0000-4000-8000-000000000000',
  run_id: 'run-remote-smoke',
  callbackSecret: 'remote-smoke-callback-token',
  lease_owner: 'remote-smoke-owner',
  lease_generation: 1,
};

let requestCount = 0;
const server = createServer((request, response) => {
  requestCount += 1;
  if (request.method !== 'POST' || request.url !== '/harness/attempts') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(202, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    status: 'accepted',
    job_id: jobId,
    actual_machine_id: machine,
    attestation: signMachineAttestation({
      secret: sharedSecret,
      attemptId: attempt.id,
      machineId: machine,
      jobId,
    }),
  }));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const { port } = server.address();

try {
  const disabledTransport = createRemoteBridgeTransport({
    enabled: false,
    bridgeUrls: { [machine]: `http://127.0.0.1:${port}` },
    sharedSecret,
    brainUrl: 'http://127.0.0.1:5221',
  });
  await disabledTransport.launch({ attempt, target: { machine } })
    .then(() => { throw new Error('disabled remote launch unexpectedly succeeded'); })
    .catch((error) => {
      if (error.message !== 'remote_bridge_disabled') throw error;
    });
  if (requestCount !== 0) throw new Error('disabled transport reached the Bridge');

  const transport = createRemoteBridgeTransport({
    enabled: true,
    bridgeUrls: { [machine]: `http://127.0.0.1:${port}` },
    sharedSecret,
    brainUrl: 'http://127.0.0.1:5221',
  });
  const result = await transport.launch({
    attempt,
    spec: { provider: 'codex', args: [], stdin: 'remote smoke' },
    target: { machine },
  });
  if (result.executionTransport !== 'remote-bridge'
      || result.actualMachineId !== machine
      || result.remoteJobId !== jobId
      || result.attestationStatus !== 'verified'
      || requestCount !== 1) {
    throw new Error(`remote Bridge route drifted: ${JSON.stringify({ result, requestCount })}`);
  }
  console.log('PASS: remote fleet transport is disabled by default and verifies an enabled Bridge receipt');
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
NODE
