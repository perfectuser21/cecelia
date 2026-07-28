'use strict';

const { createHash, createHmac } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createCredentialEnvelopeConsumer } = require('./credential-envelope.cjs');

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const REF = '33333333-3333-4333-8333-333333333333';
const NONCE = '44444444-4444-4444-8444-444444444444';
const NOW = Date.parse('2026-07-27T15:00:00.000Z');
const SIGNING_SECRET = 'fleet-worker-envelope-secret-at-least-32-bytes';
const SECRET = 'worker-refresh-token-must-never-persist';
const roots = [];
const SIGNED_FIELDS = [
  'contract_version',
  'credential_ref',
  'delivery_nonce',
  'attempt_id',
  'run_id',
  'provider',
  'account_id',
  'machine_id',
  'lease_owner',
  'lease_generation',
  'issued_at',
  'expires_at',
  'payload_hash',
  'payload',
];

function payload(provider = 'codex') {
  if (provider === 'claude') {
    return JSON.stringify({
      claudeAiOauth: {
        accessToken: SECRET,
        refreshToken: 'claude-refresh-secret',
        expiresAt: NOW + 7_200_000,
      },
    });
  }
  if (provider === 'grok') {
    return JSON.stringify({
      'https://auth.x.ai::principal': {
        key: SECRET,
        refresh_token: 'grok-refresh-secret',
        expires_at: new Date(NOW + 7_200_000).toISOString(),
      },
    });
  }
  return JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: 'header.payload.signature',
      refresh_token: SECRET,
    },
  });
}

function sign(value) {
  const canonical = {};
  for (const field of SIGNED_FIELDS) canonical[field] = value[field];
  return `hmac-sha256:${createHmac('sha256', SIGNING_SECRET)
    .update(JSON.stringify(canonical))
    .digest('hex')}`;
}

function envelope(overrides = {}) {
  const provider = overrides.provider ?? 'codex';
  const raw = overrides.rawPayload ?? payload(provider);
  const unsigned = {
    contract_version: 'provider-credential-envelope/v2',
    credential_ref: REF,
    delivery_nonce: NONCE,
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    provider,
    account_id: provider === 'codex'
      ? 'team4'
      : provider === 'claude' ? 'account2' : 'grok',
    machine_id: 'xian-mac-m4',
    lease_owner: 'kernel-controller:1234',
    lease_generation: 7,
    issued_at: new Date(NOW - 1000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    payload_hash: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    payload: Buffer.from(raw).toString('base64'),
    ...overrides,
  };
  delete unsigned.rawPayload;
  return { ...unsigned, signature: overrides.signature ?? sign(unsigned) };
}

function binding(provider = 'codex') {
  return {
    attemptId: ATTEMPT_ID,
    runId: RUN_ID,
    provider,
    accountId: provider === 'codex'
      ? 'team4'
      : provider === 'claude' ? 'account2' : 'grok',
    machineId: 'xian-mac-m4',
    leaseOwner: 'kernel-controller:1234',
    leaseGeneration: 7,
  };
}

function consumer(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-credential-consume-'));
  roots.push(root);
  return {
    root,
    value: createCredentialEnvelopeConsumer({
      consumptionRoot: root,
      signingSecret: SIGNING_SECRET,
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

describe('Fleet Worker provider CredentialEnvelope consumption', () => {
  it.each(['codex', 'claude', 'grok'])(
    'atomically consumes a signed bound %s envelope and persists metadata only',
    (provider) => {
      const { root, value } = consumer();
      const result = value.consume(envelope({ provider }), binding(provider));
      expect(result).toMatchObject({
        credentialRef: REF,
        deliveryNonce: NONCE,
        provider,
        accountId: binding(provider).accountId,
        authJson: payload(provider),
      });

      const persisted = fs.readFileSync(path.join(root, `${NONCE}.json`), 'utf8');
      expect(persisted).toContain(REF);
      expect(persisted).toContain(NONCE);
      expect(persisted).toContain(ATTEMPT_ID);
      expect(persisted).not.toContain(SECRET);
      expect(persisted).not.toMatch(/access_token|refresh_token|"payload"|signature/i);
    },
  );

  it.each([
    ['missing', null, {}, 'credential_envelope_required'],
    ['expired', envelope({ expires_at: new Date(NOW).toISOString() }), {}, 'credential_envelope_expired'],
    [
      'expiry before issuance',
      envelope({
        issued_at: new Date(NOW - 1000).toISOString(),
        expires_at: new Date(NOW - 2000).toISOString(),
      }),
      {},
      'credential_envelope_expiry_invalid',
    ],
    ['Attempt mismatch', envelope(), { attemptId: '55555555-5555-4555-8555-555555555555' }, 'credential_attempt_mismatch'],
    ['Run mismatch', envelope(), { runId: '55555555-5555-4555-8555-555555555555' }, 'credential_run_mismatch'],
    ['provider mismatch', envelope(), { provider: 'claude', accountId: 'account2' }, 'credential_provider_mismatch'],
    ['account mismatch', envelope(), { accountId: 'team3' }, 'credential_account_mismatch'],
    ['machine mismatch', envelope(), { machineId: 'us-mac-m4' }, 'credential_machine_mismatch'],
    ['lease owner mismatch', envelope(), { leaseOwner: 'other-controller' }, 'credential_lease_owner_mismatch'],
    ['lease generation mismatch', envelope(), { leaseGeneration: 8 }, 'credential_lease_generation_mismatch'],
    [
      'payload tamper',
      {
        ...envelope(),
        payload: Buffer.from(payload().replace(SECRET, 'tampered-secret')).toString('base64'),
      },
      {},
      'credential_envelope_signature_invalid',
    ],
    [
      'hash tamper',
      { ...envelope(), payload_hash: `sha256:${'0'.repeat(64)}` },
      {},
      'credential_envelope_signature_invalid',
    ],
    [
      'signature tamper',
      envelope({ signature: `hmac-sha256:${'0'.repeat(64)}` }),
      {},
      'credential_envelope_signature_invalid',
    ],
    [
      'oversized payload',
      envelope({ payload: Buffer.from('x'.repeat(196_609)).toString('base64') }),
      {},
      'credential_payload_invalid',
    ],
  ])('rejects %s without creating a consumption marker', (
    _label,
    input,
    bindingOverrides,
    code,
  ) => {
    const { root, value } = consumer();
    expect(() => value.consume(input, {
      ...binding(),
      ...bindingOverrides,
    })).toThrow(code);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('rejects replay across consumers using the same durable nonce marker', () => {
    const { root, value } = consumer();
    value.consume(envelope(), binding());
    const reloaded = createCredentialEnvelopeConsumer({
      consumptionRoot: root,
      signingSecret: SIGNING_SECRET,
      now: () => NOW,
    });
    expect(() => reloaded.consume(envelope(), binding()))
      .toThrow('credential_envelope_replayed');
  });

  it('rejects an invalid Worker clock before creating a consumption marker', () => {
    const { root, value } = consumer({ now: () => Number.MAX_VALUE });
    expect(() => value.consume(envelope(), binding())).toThrow(
      'credential_clock_invalid',
    );
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each(['short', `${SIGNING_SECRET}\n`])(
    'rejects an unsafe signing secret at construction',
    (signingSecret) => {
      expect(() => consumer({ signingSecret }))
        .toThrow('credential_signing_secret_invalid');
    },
  );
});
