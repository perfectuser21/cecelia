'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL_REF = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'github_pat_attempt_scoped_test_token';
const NOW = Date.parse('2026-07-31T03:00:00.000Z');
const roots = [];

function envelope(overrides = {}) {
  return {
    contract_version: 'github-credential-envelope/v1',
    credential_ref: CREDENTIAL_REF,
    attempt_id: ATTEMPT_ID,
    machine_id: 'us-mac-m4',
    issued_at: '2026-07-31T02:59:00.000Z',
    expires_at: '2026-07-31T04:00:00.000Z',
    payload_hash: `sha256:${createHash('sha256').update(TOKEN).digest('hex')}`,
    payload: Buffer.from(TOKEN).toString('base64'),
    ...overrides,
  };
}

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('Fleet GitHub credential envelope consumer', () => {
  it('consumes once and persists metadata without the token or payload', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-envelope-'));
    roots.push(root);
    const { createGitHubCredentialEnvelopeConsumer } = require(
      './github-credential-envelope.cjs',
    );
    const consumer = createGitHubCredentialEnvelopeConsumer({
      consumptionRoot: root,
      now: () => NOW,
    });

    const consumed = consumer.consume(envelope(), {
      attemptId: ATTEMPT_ID,
      machineId: 'us-mac-m4',
    });

    expect(consumed.token).toBe(TOKEN);
    expect(consumed.metadata).not.toHaveProperty('payload');
    const marker = fs.readFileSync(
      path.join(root, `${CREDENTIAL_REF}.json`),
      'utf8',
    );
    expect(marker).not.toContain(TOKEN);
    expect(marker).not.toContain(Buffer.from(TOKEN).toString('base64'));
    expect(() => consumer.consume(envelope(), {
      attemptId: ATTEMPT_ID,
      machineId: 'us-mac-m4',
    })).toThrow('github_credential_envelope_replayed');
  });

  it('rejects a payload hash mismatch without persisting a marker', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-envelope-'));
    roots.push(root);
    const { createGitHubCredentialEnvelopeConsumer } = require(
      './github-credential-envelope.cjs',
    );
    const consumer = createGitHubCredentialEnvelopeConsumer({
      consumptionRoot: root,
      now: () => NOW,
    });

    expect(() => consumer.consume(envelope({
      payload_hash: `sha256:${'a'.repeat(64)}`,
    }), {
      attemptId: ATTEMPT_ID,
      machineId: 'us-mac-m4',
    })).toThrow('github_credential_payload_hash_mismatch');
    expect(fs.existsSync(path.join(root, `${CREDENTIAL_REF}.json`))).toBe(false);
  });
});
