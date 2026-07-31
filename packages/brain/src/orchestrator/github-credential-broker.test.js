import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createGitHubCredentialBroker } from './github-credential-broker.js';

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL_REF = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-07-31T03:00:00.000Z');
const DEADLINE = '2026-07-31T04:00:00.000Z';
const TOKEN = 'github_pat_attempt_scoped_test_token';

describe('GitHub Credential Broker', () => {
  it('issues one opaque Attempt-bound envelope from the US M4 authority', async () => {
    const broker = createGitHubCredentialBroker({
      controllerMachineId: 'us-mac-m4',
      loadToken: vi.fn(async () => TOKEN),
      now: () => NOW,
      randomUUID: () => CREDENTIAL_REF,
    });

    const envelope = await broker.issue({
      attemptId: ATTEMPT_ID,
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    });

    expect(envelope).toEqual({
      contract_version: 'github-credential-envelope/v1',
      credential_ref: CREDENTIAL_REF,
      attempt_id: ATTEMPT_ID,
      machine_id: 'xian-mac-m4',
      issued_at: '2026-07-31T03:00:00.000Z',
      expires_at: DEADLINE,
      payload_hash: `sha256:${createHash('sha256').update(TOKEN).digest('hex')}`,
      payload: Buffer.from(TOKEN).toString('base64'),
    });
    expect(JSON.stringify(envelope)).not.toContain(TOKEN);
  });

  it('fails closed outside US M4 and for an empty token', async () => {
    const outsideAuthority = createGitHubCredentialBroker({
      controllerMachineId: 'xian-mac-m4',
      loadToken: vi.fn(async () => TOKEN),
    });
    await expect(outsideAuthority.issue({
      attemptId: ATTEMPT_ID,
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('github_credential_broker_us_authority_required');

    const missing = createGitHubCredentialBroker({
      controllerMachineId: 'us-mac-m4',
      loadToken: vi.fn(async () => ''),
      now: () => NOW,
    });
    await expect(missing.issue({
      attemptId: ATTEMPT_ID,
      machineId: 'us-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('github_credential_payload_invalid');

    const nonString = createGitHubCredentialBroker({
      controllerMachineId: 'us-mac-m4',
      loadToken: vi.fn(async () => null),
      now: () => NOW,
    });
    await expect(nonString.issue({
      attemptId: ATTEMPT_ID,
      machineId: 'us-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('github_credential_payload_invalid');
  });
});
