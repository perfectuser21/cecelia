import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createCredentialBroker,
  createFileCredentialLoader,
} from './credential-broker.js';

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL_REF = '33333333-3333-4333-8333-333333333333';
const DELIVERY_NONCE = '44444444-4444-4444-8444-444444444444';
const NOW = Date.parse('2026-07-27T15:00:00.000Z');
const DEADLINE = new Date(NOW + 60 * 60 * 1000).toISOString();
const SIGNING_SECRET = 'provider-envelope-signing-secret-at-least-32-bytes';
const SECRET = 'broker-access-token-must-never-leak';

function jwt(expSeconds) {
  const encoded = Buffer.from(JSON.stringify({ exp: expSeconds }))
    .toString('base64url');
  return `header.${encoded}.signature`;
}

function codexAuth(expMs = NOW + 2 * 60 * 60 * 1000) {
  return JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: jwt(Math.floor(expMs / 1000)),
      refresh_token: SECRET,
      account_id: 'acct-team4',
    },
  });
}

function claudeAuth(expMs = NOW + 2 * 60 * 60 * 1000) {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: SECRET,
      refreshToken: 'claude-refresh-secret',
      expiresAt: expMs,
    },
  });
}

function grokAuth(expMs = NOW + 2 * 60 * 60 * 1000) {
  return JSON.stringify({
    'https://auth.x.ai::principal': {
      key: SECRET,
      refresh_token: 'grok-refresh-secret',
      expires_at: new Date(expMs).toISOString(),
    },
  });
}

function input(overrides = {}) {
  return {
    attemptId: ATTEMPT_ID,
    runId: RUN_ID,
    provider: 'codex',
    accountId: 'team4',
    machineId: 'xian-mac-m4',
    leaseOwner: 'kernel-controller:1234',
    leaseGeneration: 7,
    deadlineAt: DEADLINE,
    ...overrides,
  };
}

function broker(overrides = {}) {
  const ids = [CREDENTIAL_REF, DELIVERY_NONCE];
  return createCredentialBroker({
    controllerMachineId: 'us-mac-m4',
    signingSecret: SIGNING_SECRET,
    loadCredential: vi.fn(async (provider) => ({
      codex: codexAuth(),
      claude: claudeAuth(),
      grok: grokAuth(),
    })[provider]),
    now: () => NOW,
    randomUUID: () => ids.shift(),
    safetyMarginMs: 5 * 60 * 1000,
    deliveryTtlMs: 60_000,
    ...overrides,
  });
}

describe('central provider Credential Broker', () => {
  it.each([
    ['codex', 'team4', codexAuth()],
    ['claude', 'account2', claudeAuth()],
    ['grok', 'grok', grokAuth()],
  ])('issues one signed short-lived %s envelope bound to run and lease', async (
    provider,
    accountId,
    payload,
  ) => {
    const loadCredential = vi.fn(async () => payload);
    const result = await broker({ loadCredential }).issue(input({
      provider,
      accountId,
    }));

    expect(loadCredential).toHaveBeenCalledTimes(1);
    expect(loadCredential).toHaveBeenCalledWith(provider, accountId);
    expect(result).toMatchObject({
      contract_version: 'provider-credential-envelope/v2',
      credential_ref: CREDENTIAL_REF,
      delivery_nonce: DELIVERY_NONCE,
      attempt_id: ATTEMPT_ID,
      run_id: RUN_ID,
      provider,
      account_id: accountId,
      machine_id: 'xian-mac-m4',
      lease_owner: 'kernel-controller:1234',
      lease_generation: 7,
      issued_at: '2026-07-27T15:00:00.000Z',
      expires_at: '2026-07-27T15:01:00.000Z',
      payload_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      payload: Buffer.from(payload).toString('base64'),
      signature: expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/),
    });
    expect(Object.keys(result)).toEqual([
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
      'signature',
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    const metadata = { ...result };
    delete metadata.payload;
    expect(JSON.stringify(metadata)).not.toContain(SECRET);
  });

  it('signs every execution binding and payload byte', async () => {
    const first = await broker().issue(input());
    const second = await broker().issue(input({ leaseGeneration: 8 }));
    const third = await broker({
      loadCredential: vi.fn(async () => codexAuth().replace(SECRET, `${SECRET}-changed`)),
    }).issue(input());

    expect(first.signature).not.toBe(second.signature);
    expect(first.signature).not.toBe(third.signature);
  });

  it.each([
    ['non-US controller', { controllerMachineId: 'xian-mac-m4' }, {}, 'credential_broker_us_authority_required'],
    ['unknown provider', {}, { provider: 'other' }, 'credential_provider_not_allowed'],
    ['unknown Codex account', {}, { accountId: 'team6' }, 'credential_account_not_allowed'],
    ['wrong Claude account namespace', {}, {
      provider: 'claude', accountId: 'team1',
    }, 'credential_account_not_allowed'],
    ['wrong Grok account', {}, {
      provider: 'grok', accountId: 'account1',
    }, 'credential_account_not_allowed'],
    ['unknown machine', {}, { machineId: 'moon-base' }, 'credential_machine_not_allowed'],
    ['invalid Attempt', {}, { attemptId: 'not-a-uuid' }, 'credential_attempt_invalid'],
    ['invalid Run', {}, { runId: 'not-a-uuid' }, 'credential_run_invalid'],
    ['invalid lease owner', {}, { leaseOwner: 'bad\nowner' }, 'credential_lease_owner_invalid'],
    ['invalid lease generation', {}, { leaseGeneration: -1 }, 'credential_lease_generation_invalid'],
  ])('rejects %s before reading credential bytes', async (_label, options, changes, code) => {
    const loadCredential = vi.fn(async () => codexAuth());
    const instance = broker({ loadCredential, ...options });
    await expect(instance.issue(input(changes))).rejects.toThrow(code);
    expect(loadCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['codex', 'team4', codexAuth(NOW + 62 * 60 * 1000)],
    ['claude', 'account1', claudeAuth(NOW + 62 * 60 * 1000)],
    ['grok', 'grok', grokAuth(NOW + 62 * 60 * 1000)],
  ])('fails closed when %s lifetime does not cover deadline plus margin', async (
    provider,
    accountId,
    payload,
  ) => {
    await expect(broker({
      loadCredential: vi.fn(async () => payload),
    }).issue(input({ provider, accountId }))).rejects.toThrow(
      'credential_lifetime_insufficient',
    );
  });

  it('fails closed when the controller clock cannot produce an ISO timestamp', async () => {
    const loadCredential = vi.fn(async () => codexAuth());
    await expect(broker({
      loadCredential,
      now: () => Number.MAX_VALUE,
    }).issue(input())).rejects.toThrow('credential_clock_invalid');
    expect(loadCredential).not.toHaveBeenCalled();
  });

  it('never includes credential bytes in a parse error', async () => {
    let error;
    try {
      await broker({
        loadCredential: vi.fn(async () => `{${SECRET}`),
      }).issue(input());
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).toBe('credential_payload_invalid');
    expect(error?.message).not.toContain(SECRET);
  });

  it('rejects an oversized credential before issuing an envelope', async () => {
    const oversized = JSON.stringify({
      tokens: { access_token: jwt(Math.floor((NOW + 2 * 60 * 60 * 1000) / 1000)) },
      padding: 'x'.repeat(196_608),
    });
    await expect(broker({
      loadCredential: vi.fn(async () => oversized),
    }).issue(input())).rejects.toThrow('credential_payload_too_large');
  });

  it.each([
    ['short signer', 'short'],
    ['newline signer', `${SIGNING_SECRET}\n`],
  ])('rejects a %s before broker construction', (_label, signingSecret) => {
    expect(() => broker({ signingSecret })).toThrow('credential_signing_secret_invalid');
  });
});

describe('protected controller credential source', () => {
  function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-loader-'));
    const homes = {
      'codex:team4': path.join(root, '.codex-team4'),
      'claude:account2': path.join(root, '.claude-account2'),
      'grok:grok': path.join(root, '.grok'),
    };
    for (const home of Object.values(homes)) fs.mkdirSync(home, { mode: 0o700 });
    fs.writeFileSync(path.join(homes['codex:team4'], 'auth.json'), codexAuth(), {
      mode: 0o600,
    });
    fs.writeFileSync(
      path.join(homes['claude:account2'], '.credentials.json'),
      claudeAuth(),
      { mode: 0o600 },
    );
    fs.writeFileSync(path.join(homes['grok:grok'], 'auth.json'), grokAuth(), {
      mode: 0o600,
    });
    return { root, homes };
  }

  it.each([
    ['codex', 'team4', 'auth.json', codexAuth()],
    ['claude', 'account2', '.credentials.json', claudeAuth()],
    ['grok', 'grok', 'auth.json', grokAuth()],
  ])('reads only the selected protected %s credential file', async (
    provider,
    account,
    _filename,
    expected,
  ) => {
    const { root, homes } = fixture();
    const accountHomeResolver = vi.fn((p, a) => homes[`${p}:${a}`]);
    const load = createFileCredentialLoader({ accountHomeResolver });
    try {
      await expect(load(provider, account)).resolves.toBe(expected);
      expect(accountHomeResolver).toHaveBeenCalledWith(provider, account);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['unknown provider', 'other', 'team4'],
    ['wrong account namespace', 'claude', 'team4'],
    ['unknown account', 'grok', 'account1'],
  ])('rejects %s before resolving a home', async (_label, provider, account) => {
    const accountHomeResolver = vi.fn();
    const load = createFileCredentialLoader({ accountHomeResolver });
    await expect(load(provider, account)).rejects.toThrow(
      /credential_(provider|account)_not_allowed/,
    );
    expect(accountHomeResolver).not.toHaveBeenCalled();
  });

  it.each([
    ['group-readable file', 0o640, false],
    ['owner-executable file', 0o700, false],
    ['owner-write-only file', 0o200, false],
    ['symlink file', 0o600, true],
  ])('rejects a %s without returning credential bytes', async (_case, mode, symlink) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-loader-'));
    const home = path.join(root, '.claude-account2');
    fs.mkdirSync(home, { mode: 0o700 });
    const target = path.join(home, 'credential-target.json');
    const credentialFile = path.join(home, '.credentials.json');
    fs.writeFileSync(target, claudeAuth(), { mode });
    if (symlink) fs.symlinkSync(target, credentialFile);
    else fs.renameSync(target, credentialFile);
    const load = createFileCredentialLoader({
      accountHomeResolver: () => home,
    });

    try {
      await expect(load('claude', 'account2')).rejects.toThrow(
        'credential_source_permissions',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
