'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createCredentialEnvelopeConsumer } = require('./credential-envelope.cjs');

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const REF = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-07-27T15:00:00.000Z');
const SECRET = 'worker-refresh-token-must-never-persist';
const roots = [];

function payload() {
  return JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: 'header.payload.signature',
      refresh_token: SECRET,
    },
  });
}

function envelope(overrides = {}) {
  const raw = payload();
  return {
    contract_version: 'credential-envelope/v1',
    credential_ref: REF,
    attempt_id: ATTEMPT_ID,
    account_id: 'team4',
    machine_id: 'xian-mac-m4',
    issued_at: new Date(NOW - 1000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    payload_hash: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    payload: Buffer.from(raw).toString('base64'),
    ...overrides,
  };
}

function consumer(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-credential-consume-'));
  roots.push(root);
  return {
    root,
    value: createCredentialEnvelopeConsumer({
      consumptionRoot: root,
      now: () => NOW,
      ...overrides,
    }),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Fleet Worker CredentialEnvelope consumption', () => {
  it('atomically consumes a bound envelope and persists metadata only', () => {
    const { root, value } = consumer();
    const result = value.consume(envelope(), {
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
    });
    expect(result).toMatchObject({
      credentialRef: REF,
      accountId: 'team4',
      authJson: payload(),
    });

    const persisted = fs.readFileSync(path.join(root, `${REF}.json`), 'utf8');
    expect(persisted).toContain(REF);
    expect(persisted).toContain(ATTEMPT_ID);
    expect(persisted).not.toContain(SECRET);
    expect(persisted).not.toContain('access_token');
    expect(persisted).not.toContain('refresh_token');
    expect(persisted).not.toContain('"payload"');
  });

  it.each([
    ['missing', null, 'credential_envelope_required'],
    ['expired', envelope({ expires_at: new Date(NOW).toISOString() }), 'credential_envelope_expired'],
    [
      'expiry before issuance',
      envelope({
        issued_at: new Date(NOW - 1000).toISOString(),
        expires_at: new Date(NOW - 2000).toISOString(),
      }),
      'credential_envelope_expiry_invalid',
    ],
    ['Attempt mismatch', envelope({ attempt_id: '33333333-3333-4333-8333-333333333333' }), 'credential_attempt_mismatch'],
    ['account mismatch', envelope({ account_id: 'team3' }), 'credential_account_mismatch'],
    ['machine mismatch', envelope({ machine_id: 'us-mac-m4' }), 'credential_machine_mismatch'],
    ['hash mismatch', envelope({ payload_hash: `sha256:${'0'.repeat(64)}` }), 'credential_payload_hash_mismatch'],
    [
      'oversized payload',
      envelope({ payload: Buffer.from('x'.repeat(196_609)).toString('base64') }),
      'credential_payload_invalid',
    ],
  ])('rejects %s without creating a consumption marker', (_label, input, code) => {
    const { root, value } = consumer();
    expect(() => value.consume(input, {
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
    })).toThrow(code);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('rejects replay across consumers using the same durable marker root', () => {
    const { root, value } = consumer();
    value.consume(envelope(), {
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
    });
    const reloaded = createCredentialEnvelopeConsumer({
      consumptionRoot: root,
      now: () => NOW,
    });
    expect(() => reloaded.consume(envelope(), {
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
    })).toThrow('credential_envelope_replayed');
  });

  it('rejects an invalid Worker clock before creating a consumption marker', () => {
    const { root, value } = consumer({ now: () => Number.MAX_VALUE });
    expect(() => value.consume(envelope(), {
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
    })).toThrow('credential_clock_invalid');
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
