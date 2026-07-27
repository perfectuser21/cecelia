import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signMachineAttestation } from '../../../packages/brain/src/orchestrator/machine-attestation.js';
import { createRemoteBridgeTransport } from '../../../packages/brain/src/orchestrator/remote-bridge-transport.js';

const SECRET = 'contract-transport-secret-at-least-32-bytes';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const MACHINE = 'xian-mac-m4';
let server;
let baseUrl;
let observedRequest;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      observedRequest = {
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      };
      const jobId = 'real-http-worker-job';
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        status: 'accepted',
        job_id: jobId,
        actual_machine_id: MACHINE,
        attestation: signMachineAttestation({
          secret: SECRET,
          attemptId: ATTEMPT_ID,
          machineId: MACHINE,
          jobId,
        }),
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('生产 remote bridge 的瞬态 capability 边（真实 HTTP，不替代 Docker host gate）', () => {
  it('authenticated server-to-worker POST 携带 capability，TaskBundle/provider_spec 均不携带', async () => {
    const capability = Object.freeze({
      databaseUrl: 'postgresql://opaque@db.internal/harness_attempt_2222',
      databaseName: 'harness_attempt_2222',
      roleName: 'harness_role_2222',
      receipt: Object.freeze({
        version: 'harness-db-receipt/v1',
        attempt_id: ATTEMPT_ID,
        run_id: RUN_ID,
        nonce: 'nonce-2222',
        signature: `hmac-sha256:${'a'.repeat(64)}`,
      }),
    });
    const transport = createRemoteBridgeTransport({
      enabled: true,
      bridgeUrls: { [MACHINE]: baseUrl },
      sharedSecret: SECRET,
      brainUrl: 'http://brain.internal:5221',
      timeoutMs: 3_000,
    });
    await transport.launch({
      attempt: {
        id: ATTEMPT_ID,
        run_id: RUN_ID,
        lease_owner: 'contract-test',
        lease_generation: 0,
        callbackSecret: 'callback-secret',
      },
      bundle: {
        role: 'evaluator',
        constraints: { timeout_seconds: 60 },
        inputs: {
          execution_surface: 'fleet-worker',
          workspace_spec: {
            repo: 'perfectuser21/cecelia',
            base_sha: 'a'.repeat(40),
            branch: 'cp-contract',
            expected_head_sha: 'a'.repeat(40),
            mode: 'read-write',
            run_id: RUN_ID,
            attempt_id: ATTEMPT_ID,
          },
        },
      },
      spec: {
        provider: 'claude',
        command: 'claude',
        args: ['--output-format', 'json'],
        stdin: 'bounded',
        output: { format: 'json' },
      },
      target: { provider: 'claude', account: 'account1', machine: MACHINE },
      testEnvironmentCapability: capability,
    });
    expect(observedRequest.authorization).toBe(`Bearer ${SECRET}`);
    expect(
      observedRequest.body.test_environment_capability,
      'BUSINESS_RED: remote bridge 丢弃 authenticated transient capability',
    ).toEqual(capability);
    expect(observedRequest.body.provider_spec).not.toHaveProperty('environment');
    expect(JSON.stringify(observedRequest.body.workspace_spec)).not.toContain('postgresql://');
  });
});
