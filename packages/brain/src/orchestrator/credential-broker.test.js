import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createCredentialBroker,
  createFileCredentialLoader,
} from './credential-broker.js';
import { resolvePrimaryWorkerId } from '../machine-registry.js';

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

  it.each([
    ['credential_source_unavailable'],
    ['credential_source_permissions'],
  ])('passes the loader failure %s through instead of masking it as payload_invalid', async (code) => {
    const loadCredential = vi.fn(async () => { throw new Error(code); });
    await expect(broker({ loadCredential }).issue({
      attemptId: ATTEMPT_ID, accountId: 'team4', machineId: 'xian-mac-m4', deadlineAt: DEADLINE,
    })).rejects.toThrow(code);
  });

  it('still masks non-credential loader failures as credential_payload_invalid', async () => {
    const loadCredential = vi.fn(async () => { throw new Error(`ENOENT ${SECRET}`); });
    let error;
    try {
      await broker({ loadCredential }).issue({
        attemptId: ATTEMPT_ID, accountId: 'team4', machineId: 'xian-mac-m4', deadlineAt: DEADLINE,
      });
    } catch (caught) { error = caught; }
    expect(error?.message).toBe('credential_payload_invalid');
    expect(error?.message).not.toContain(SECRET);
  });
});

describe('权威判据锁定（角色置换前基线）', () => {
  it('primary worker（resolvePrimaryWorkerId()）放行：issue 走到凭据加载', async () => {
    const loadCredential = vi.fn(async () => authJson());
    const result = await broker({
      controllerMachineId: resolvePrimaryWorkerId(),
      loadCredential,
    }).issue({
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    });

    expect(loadCredential).toHaveBeenCalledTimes(1);
    expect(result.credential_ref).toBe('22222222-2222-4222-8222-222222222222');
  });

  it.each([
    ['非 primary 机器（us-vps）', 'us-vps'],
    ['未知控制器（undefined）', undefined],
  ])('%s fail-closed，错误码不变', async (_label, controllerMachineId) => {
    const loadCredential = vi.fn(async () => authJson());
    await expect(broker({ controllerMachineId, loadCredential }).issue({
      attemptId: ATTEMPT_ID,
      accountId: 'team4',
      machineId: 'xian-mac-m4',
      deadlineAt: DEADLINE,
    })).rejects.toThrow('credential_broker_us_authority_required');
    expect(loadCredential).not.toHaveBeenCalled();
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
    ['group-writable file', 0o660, false],
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
    fs.chmodSync(target, mode); // umask 会削掉组写位，显式固定待测模式
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

  it('accepts a world-readable (0644) file owned by the process user', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-loader-'));
    const team4 = path.join(root, '.codex-team4');
    fs.mkdirSync(team4, { mode: 0o755 });
    fs.writeFileSync(path.join(team4, 'auth.json'), authJson(), { mode: 0o644 });
    const load = createFileCredentialLoader({
      accountHomeResolver: (accountId) => path.join(root, `.codex-${accountId}`),
    });
    try {
      await expect(load('team4')).resolves.toBe(authJson());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function foreignOwnerDeps(uid, { trustedUids, dirMode = 0o40755, fileMode = 0o100644 } = {}) {
    const body = authJson();
    return {
      accountHomeResolver: () => '/srv/foreign/.codex-team4',
      trustedUids,
      openFile: vi.fn(() => 7),
      fstat: vi.fn(() => ({ isFile: () => true, mode: fileMode, uid, size: Buffer.byteLength(body) })),
      readFile: vi.fn(() => body),
      closeFile: vi.fn(),
      statDirectory: vi.fn(() => ({ isDirectory: () => true, isSymbolicLink: () => false, mode: dirMode, uid })),
    };
  }

  it('rejects a file owned by another uid that is not trusted', async () => {
    const load = createFileCredentialLoader(foreignOwnerDeps(9999, { trustedUids: [] }));
    await expect(load('team4')).rejects.toThrow('credential_source_permissions');
  });

  it('accepts a file owned by a trusted uid even when the process uid differs', async () => {
    const load = createFileCredentialLoader(foreignOwnerDeps(9999, { trustedUids: [9999] }));
    await expect(load('team4')).resolves.toBe(authJson());
  });

  it('rejects a trusted-owner file whose parent directory is group- or world-writable', async () => {
    const load = createFileCredentialLoader(foreignOwnerDeps(9999, { trustedUids: [9999], dirMode: 0o40777 }));
    await expect(load('team4')).rejects.toThrow('credential_source_permissions');
  });

  it('rejects a trusted-owner file whose parent directory is a symlink', async () => {
    const deps = foreignOwnerDeps(9999, { trustedUids: [9999] });
    deps.statDirectory = vi.fn(() => ({ isDirectory: () => true, isSymbolicLink: () => true, mode: 0o40755, uid: 9999 }));
    await expect(createFileCredentialLoader(deps)('team4')).rejects.toThrow('credential_source_permissions');
  });

  it.each([[['x']], [[-1]], [[1.5]], ['501']])('rejects invalid trustedUids %j at construction', (trustedUids) => {
    expect(() => createFileCredentialLoader({ accountHomeResolver: () => '/tmp/x', trustedUids }))
      .toThrow('credential_trusted_uids_invalid');
  });
});
