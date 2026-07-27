import { describe, expect, it, vi } from 'vitest';

import { createRemoteBridgeTransport } from '../../../packages/brain/src/orchestrator/remote-bridge-transport.js';

describe('Kernel remote bridge signed receipt contract', () => {
  it('remote bridge launch body 必须携带 exact signed receipt 绑定字段', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({
        status: 'accepted',
        job_id: 'job-1',
        actualMachineId: 'xian-mac-m4',
        executionTransport: 'remote-bridge',
        remoteJobId: 'job-1',
        attestationStatus: 'verified',
        jobId: 'job-1',
      }),
    }));

    const transport = createRemoteBridgeTransport({
      enabled: true,
      bridgeUrls: { 'xian-mac-m4': 'http://bridge.example' },
      sharedSecret: 'a'.repeat(32),
      brainUrl: 'http://brain.example',
      credentialBroker: {
        issue: async () => ({
          contract_version: 'credential-envelope/v1',
          credential_ref: '33333333-3333-4333-8333-333333333333',
          attempt_id: '44444444-4444-4444-8444-444444444444',
          account_id: 'team1',
          machine_id: 'xian-mac-m4',
          issued_at: '2026-07-27T12:00:00.000Z',
          expires_at: '2026-07-27T13:00:00.000Z',
          payload_hash: 'sha256:1234',
          payload: 'e30=',
        }),
      },
      fetchFn,
    });

    await transport.launch({
      attempt: {
        id: '44444444-4444-4444-8444-444444444444',
        run_id: '55555555-5555-4555-8555-555555555555',
        lease_owner: 'lease-owner',
        lease_generation: 0,
        callbackSecret: 'callback-secret',
      },
      bundle: {
        role: 'generator',
        constraints: { timeout_seconds: 600 },
        inputs: { worktree_path: '/workspace' },
      },
      spec: { provider: 'codex', command: 'codex', args: ['run'] },
      target: { provider: 'codex', account: 'team1', model: 'gpt-5', machine: 'xian-mac-m4' },
    }).catch(() => null);

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body ?? '{}'));
    expect(body.credential_envelope?.signed_payload).toBeTruthy();
    expect(body.credential_envelope?.payload_digest).toMatch(/^sha256:/);
    expect(body.credential_envelope?.contract_id).toEqual(expect.any(String));
    expect(body.credential_envelope?.contract_sha).toEqual(expect.any(String));
    expect(body.credential_envelope?.pr_head_sha).toEqual(expect.any(String));
    expect(body.credential_envelope?.db_name).toEqual(expect.any(String));
  });
});
