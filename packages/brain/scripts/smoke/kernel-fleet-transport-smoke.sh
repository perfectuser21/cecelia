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
  if (request.method === 'POST' && request.url === '/harness/attempts/prepare') {
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
    return;
  }
  if (request.method === 'POST' && request.url === `/harness/attempts/${attempt.id}/start`) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      status: 'running',
      attempt_id: attempt.id,
    }));
    return;
  }
  response.writeHead(404).end();
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
  await disabledTransport.prepare({
    attempt,
    bundle: { constraints: { timeout_seconds: 60 } },
    spec: { provider: 'codex', args: [], stdin: 'remote smoke' },
    target: { machine },
  })
    .then(() => { throw new Error('disabled remote prepare unexpectedly succeeded'); })
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
  const result = await transport.prepare({
    attempt,
    bundle: { constraints: { timeout_seconds: 60 } },
    spec: { provider: 'codex', args: [], stdin: 'remote smoke' },
    target: { machine },
  });
  const startResult = await transport.start({
    attempt,
    target: { machine },
  });
  if (result.executionTransport !== 'fleet-worker'
      || result.actualMachineId !== machine
      || result.remoteJobId !== jobId
      || result.attestationStatus !== 'verified'
      || startResult.status !== 'running'
      || startResult.attempt_id !== attempt.id
      || requestCount !== 2) {
    throw new Error(`Fleet Worker route drifted: ${JSON.stringify({ result, startResult, requestCount })}`);
  }
  console.log('PASS: fleet transport is disabled by default and verifies prepare/start Worker receipts');
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
NODE
