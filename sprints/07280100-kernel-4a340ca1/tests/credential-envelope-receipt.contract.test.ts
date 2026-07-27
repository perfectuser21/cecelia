import { afterEach, describe, expect, it } from 'vitest';

import {
  createCredentialBroker,
} from '../../../packages/brain/src/orchestrator/credential-broker.js';

const NOW = Date.parse('2026-07-27T12:00:00.000Z');

function jwt(expMs: number) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expMs / 1000) })).toString('base64url');
  return `${header}.${payload}.sig`;
}

afterEach(() => {
  delete process.env.TEST_DATABASE_URL;
});

describe('Kernel signed credential envelope contract', () => {
  it('CredentialEnvelope 必须带 signed_payload 外层签名与全绑定字段', async () => {
    const broker = createCredentialBroker({
      controllerMachineId: 'us-mac-m4',
      now: () => NOW,
      randomUUID: () => '11111111-1111-4111-8111-111111111111',
      loadCredential: async () => JSON.stringify({
        tokens: { access_token: jwt(NOW + 2 * 60 * 60 * 1000) },
      }),
    });

    const envelope = await broker.issue({
      attemptId: '22222222-2222-4222-8222-222222222222',
      accountId: 'team1',
      machineId: 'us-mac-m4',
      deadlineAt: new Date(NOW + 15 * 60 * 1000).toISOString(),
    });

    expect(envelope).toMatchObject({
      signed_payload: expect.any(Object),
      signature: expect.any(String),
      key_id: expect.any(String),
      algorithm: expect.any(String),
      payload_digest: expect.stringMatching(/^sha256:/),
      nonce: expect.any(String),
      contract_id: expect.any(String),
      contract_sha: expect.any(String),
      pr_head_sha: expect.any(String),
      db_name: expect.any(String),
    });
  });
});
