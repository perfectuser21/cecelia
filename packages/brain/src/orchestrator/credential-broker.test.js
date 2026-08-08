import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createCredentialBroker,
  createFileCredentialLoader,
  claudeTokenExpiry,
  CLAUDE_ACCOUNT_PATTERN,
} from './credential-broker.js';

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-07-27T15:00:00.000Z');
const DEADLINE = new Date(NOW + 60 * 60 * 1000).toISOString();
const SECRET = 'broker-access-token-must-never-leak';

function jwt(expSeconds) {
  const encoded = Buffer.from(JSON.stringify({ exp: expSeconds }))
    .toString('base64url');
  return `header.${encoded}.signature`;
}

function authJson(expMs = NOW + 2 * 60 * 60 * 1000) {
  return JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: jwt(Math.floor(expMs / 1000)),
      refresh_token: SECRET,
      account_id: 'acct-team4',
    },
  });
}

function broker(overrides = {}) {
  return createCredentialBroker({
    controllerMachineId: 'us-mac-m4',
    loadCredential: vi.fn(async () => authJson()),
    now: () => NOW,
    randomUUID: () => '22222222-2222-4222-8222-222222222222',
    safetyMarginMs: 5 * 60 * 1000,
    ...overrides,
  });
}

describe('central Codex Credential Broker', () => {
  it('issues one immutable envelope bound to the selected Attempt, account, and machine', async () => {
    const loadCredential = vi.fn(async () => authJson());
    const result = await broker({ loadCredential }).issue({
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    });

    expect(loadCredential).toHaveBeenCalledTimes(1);
    expect(loadCredential).toHaveBeenCalledWith('team4');
    expect(result).toMatchObject({
      contract_version: 'credential-envelope/v1',
      credential_ref: '22222222-2222-4222-8222-222222222222',
      attempt_id: ATTEMPT_ID,
      account_id: 'team4',
      machine_id: 'xian-mac-m4',
      issued_at: '2026-07-27T15:00:00.000Z',
      expires_at: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
      payload_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      payload: Buffer.from(authJson()).toString('base64'),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify({
      credential_ref: result.credential_ref,
      attempt_id: result.attempt_id,
      account_id: result.account_id,
      machine_id: result.machine_id,
      issued_at: result.issued_at,
      expires_at: result.expires_at,
      payload_hash: result.payload_hash,
    })).not.toContain(SECRET);
  });

  it.each([
    ['non-US controller', { controllerMachineId: 'xian-mac-m4' }, {}, 'credential_broker_us_authority_required'],
    ['unknown account', {}, { accountId: 'team6' }, 'credential_account_not_allowed'],
    ['unknown machine', {}, { machineId: 'moon-base' }, 'credential_machine_not_allowed'],
    ['invalid Attempt', {}, { attemptId: 'not-a-uuid' }, 'credential_attempt_invalid'],
  ])('rejects %s before reading credential bytes', async (_label, options, input, code) => {
    const loadCredential = vi.fn(async () => authJson());
    const instance = broker({ loadCredential, ...options });
    await expect(instance.issue({
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
      ...input,
    })).rejects.toThrow(code);
    expect(loadCredential).not.toHaveBeenCalled();
  });

  it('fails closed when access-token lifetime does not cover deadline plus margin', async () => {
    const loadCredential = vi.fn(async () => authJson(NOW + 62 * 60 * 1000));
    await expect(broker({ loadCredential }).issue({
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('credential_lifetime_insufficient');
  });

  it('fails closed when the controller clock cannot produce an ISO timestamp', async () => {
    const loadCredential = vi.fn(async () => authJson());
    await expect(broker({
      loadCredential,
      now: () => Number.MAX_VALUE,
    }).issue({
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('credential_clock_invalid');
    expect(loadCredential).not.toHaveBeenCalled();
  });

  it('never includes credential bytes in a parse error', async () => {
    const loadCredential = vi.fn(async () => `{${SECRET}`);
    let error;
    try {
      await broker({ loadCredential }).issue({
        attemptId: ATTEMPT_ID,
        accountId: 'team4',
        machineId: 'xian-mac-m4',
        deadlineAt: DEADLINE,
      });
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
    }).issue({
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('credential_payload_too_large');
  });
});

function claudeCredentialsJson(expMs = NOW + 2 * 60 * 60 * 1000) {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-test-token',
      expiresAt: expMs,
    },
  });
}

function claudeBroker(overrides = {}) {
  return createCredentialBroker({
    controllerMachineId: 'us-mac-m4',
    loadCredential: vi.fn(async () => claudeCredentialsJson()),
    now: () => NOW,
    randomUUID: () => '22222222-2222-4222-8222-222222222222',
    safetyMarginMs: 5 * 60 * 1000,
    accountPattern: CLAUDE_ACCOUNT_PATTERN,
    parseExpiry: claudeTokenExpiry,
    ...overrides,
  });
}

describe('central Claude Credential Broker', () => {
  it('issues one immutable envelope bound to the selected Attempt, account, and machine', async () => {
    const loadCredential = vi.fn(async () => claudeCredentialsJson());
    const result = await claudeBroker({ loadCredential }).issue({
      attemptId: ATTEMPT_ID,
      accountId: 'account1',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    });

    expect(loadCredential).toHaveBeenCalledTimes(1);
    expect(loadCredential).toHaveBeenCalledWith('account1');
    expect(result).toMatchObject({
      contract_version: 'credential-envelope/v1',
      credential_ref: '22222222-2222-4222-8222-222222222222',
      attempt_id: ATTEMPT_ID,
      account_id: 'account1',
      machine_id: 'xian-mac-m4',
      issued_at: '2026-07-27T15:00:00.000Z',
      expires_at: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
      payload_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      payload: Buffer.from(claudeCredentialsJson()).toString('base64'),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify({ payload: result.payload })).not.toContain('sk-ant-test-token');
  });

  it('rejects codex-format account id for claude pattern', async () => {
    await expect(claudeBroker().issue({
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('credential_account_not_allowed');
  });

  it('fails when token lifetime does not cover deadline plus margin', async () => {
    const loadCredential = vi.fn(async () => claudeCredentialsJson(NOW + 62 * 60 * 1000));
    await expect(claudeBroker({ loadCredential }).issue({
      attemptId: ATTEMPT_ID,
      accountId: 'account2',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('credential_lifetime_insufficient');
  });

  it('fails when expiresAt field is missing', async () => {
    const loadCredential = vi.fn(async () => JSON.stringify({ claudeAiOauth: {} }));
    await expect(claudeBroker({ loadCredential }).issue({
      attemptId: ATTEMPT_ID,
      accountId: 'account1',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('credential_expiry_unavailable');
  });
});

describe('claudeTokenExpiry', () => {
  it('returns millisecond timestamp from claudeAiOauth.expiresAt', () => {
    const expMs = NOW + 2 * 60 * 60 * 1000;
    expect(claudeTokenExpiry({ claudeAiOauth: { expiresAt: expMs } })).toBe(expMs);
  });

  it('throws credential_expiry_unavailable when field is absent', () => {
    expect(() => claudeTokenExpiry({})).toThrow('credential_expiry_unavailable');
    expect(() => claudeTokenExpiry({ claudeAiOauth: {} })).toThrow('credential_expiry_unavailable');
    expect(() => claudeTokenExpiry({ claudeAiOauth: { expiresAt: 'bad' } })).toThrow('credential_expiry_unavailable');
  });
});

describe('CLAUDE_ACCOUNT_PATTERN', () => {
  it('accepts account1..accountN format', () => {
    expect(CLAUDE_ACCOUNT_PATTERN.test('account1')).toBe(true);
    expect(CLAUDE_ACCOUNT_PATTERN.test('account2')).toBe(true);
    expect(CLAUDE_ACCOUNT_PATTERN.test('account10')).toBe(true);
  });

  it('rejects codex and non-account formats', () => {
    expect(CLAUDE_ACCOUNT_PATTERN.test('team1')).toBe(false);
    expect(CLAUDE_ACCOUNT_PATTERN.test('account0')).toBe(false);
    expect(CLAUDE_ACCOUNT_PATTERN.test('')).toBe(false);
    expect(CLAUDE_ACCOUNT_PATTERN.test('1')).toBe(false);
  });
});

describe('protected US M4 credential source', () => {
  it('reads only the selected account auth.json from a protected regular file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-loader-'));
    const team4 = path.join(root, '.codex-team4');
    fs.mkdirSync(team4, { mode: 0o700 });
    fs.writeFileSync(path.join(team4, 'auth.json'), authJson(), { mode: 0o600 });
    const accountHomeResolver = vi.fn((accountId) => path.join(root, `.codex-${accountId}`));
    const load = createFileCredentialLoader({ accountHomeResolver });

    try {
      await expect(load('team4')).resolves.toBe(authJson());
      expect(accountHomeResolver).toHaveBeenCalledWith('team4');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['group-readable file', 0o640, false],
    ['owner-executable file', 0o700, false],
    ['owner-write-only file', 0o200, false],
    ['symlink file', 0o600, true],
  ])('rejects a %s without returning credential bytes', async (_case, mode, symlink) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-loader-'));
    const team4 = path.join(root, '.codex-team4');
    fs.mkdirSync(team4, { mode: 0o700 });
    const target = path.join(team4, 'auth-target.json');
    const authFile = path.join(team4, 'auth.json');
    fs.writeFileSync(target, authJson(), { mode });
    if (symlink) fs.symlinkSync(target, authFile);
    else fs.renameSync(target, authFile);
    const load = createFileCredentialLoader({
      accountHomeResolver: (accountId) => path.join(root, `.codex-${accountId}`),
    });

    try {
      await expect(load('team4')).rejects.toThrow('credential_source_permissions');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads .credentials.json when fileName option is specified', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-loader-'));
    const accountDir = path.join(root, '.claude-account1');
    fs.mkdirSync(accountDir, { mode: 0o700 });
    const credContent = claudeCredentialsJson();
    fs.writeFileSync(path.join(accountDir, '.credentials.json'), credContent, { mode: 0o600 });
    const accountHomeResolver = vi.fn((accountId) => path.join(root, `.claude-${accountId}`));
    const load = createFileCredentialLoader({
      accountHomeResolver,
      fileName: '.credentials.json',
      accountPattern: CLAUDE_ACCOUNT_PATTERN,
    });

    try {
      await expect(load('account1')).resolves.toBe(credContent);
      expect(accountHomeResolver).toHaveBeenCalledWith('account1');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
