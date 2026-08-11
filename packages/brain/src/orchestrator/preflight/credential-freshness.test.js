import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CREDENTIAL_FRESHNESS_REASONS,
  DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS,
  createCredentialFreshnessCheck,
  inspectCredentialFreshness,
  resolveCredentialFreshnessThresholdMs,
} from './credential-freshness.js';

const NOW = 1_754_000_000_000; // fixed epoch for deterministic remaining-time math
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const tmpDirs = [];

function writeCredential(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cred-fresh-'));
  tmpDirs.push(dir);
  const file = path.join(dir, '.credentials.json');
  writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return file;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  vi.restoreAllMocks();
});

describe('resolveCredentialFreshnessThresholdMs', () => {
  it('defaults to 10 minutes when env override is absent', () => {
    expect(resolveCredentialFreshnessThresholdMs({})).toBe(DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS);
    expect(DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS).toBe(10 * MINUTE);
  });

  it('honors a numeric env override', () => {
    expect(resolveCredentialFreshnessThresholdMs({
      HARNESS_CREDENTIAL_FRESHNESS_THRESHOLD_MS: String(3 * MINUTE),
    })).toBe(3 * MINUTE);
  });

  it('falls back to default for blank / non-numeric / negative overrides', () => {
    expect(resolveCredentialFreshnessThresholdMs({ HARNESS_CREDENTIAL_FRESHNESS_THRESHOLD_MS: '' }))
      .toBe(DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS);
    expect(resolveCredentialFreshnessThresholdMs({ HARNESS_CREDENTIAL_FRESHNESS_THRESHOLD_MS: 'soon' }))
      .toBe(DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS);
    expect(resolveCredentialFreshnessThresholdMs({ HARNESS_CREDENTIAL_FRESHNESS_THRESHOLD_MS: '-5' }))
      .toBe(DEFAULT_CREDENTIAL_FRESHNESS_THRESHOLD_MS);
  });
});

describe('inspectCredentialFreshness — token remaining vs threshold', () => {
  it('blocks when the token expires in 5 minutes (below the 10-minute threshold)', () => {
    const file = writeCredential({ claudeAiOauth: { expiresAt: NOW + 5 * MINUTE } });
    const result = inspectCredentialFreshness({ credentialPath: file, now: () => NOW });
    expect(result.fresh).toBe(false);
    expect(result.reason).toBe(CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON);
    expect(result.remainingMs).toBe(5 * MINUTE);
  });

  it('passes when the token has 8 hours of remaining validity', () => {
    const file = writeCredential({ claudeAiOauth: { expiresAt: NOW + 8 * HOUR } });
    const result = inspectCredentialFreshness({ credentialPath: file, now: () => NOW });
    expect(result.fresh).toBe(true);
    expect(result.reason).toBe(CREDENTIAL_FRESHNESS_REASONS.FRESH);
    expect(result.remainingMs).toBe(8 * HOUR);
  });

  it('blocks an already-expired token', () => {
    const file = writeCredential({ claudeAiOauth: { expiresAt: NOW - MINUTE } });
    const result = inspectCredentialFreshness({ credentialPath: file, now: () => NOW });
    expect(result.fresh).toBe(false);
    expect(result.reason).toBe(CREDENTIAL_FRESHNESS_REASONS.EXPIRED);
  });

  it('respects a custom threshold override', () => {
    const file = writeCredential({ claudeAiOauth: { expiresAt: NOW + 5 * MINUTE } });
    const result = inspectCredentialFreshness({
      credentialPath: file,
      now: () => NOW,
      thresholdMs: 2 * MINUTE,
    });
    expect(result.fresh).toBe(true);
  });
});

describe('inspectCredentialFreshness — unresolvable credentials block with a reason', () => {
  it('blocks when the credentials file is missing', () => {
    const result = inspectCredentialFreshness({
      credentialPath: path.join(tmpdir(), 'does-not-exist-abc123', '.credentials.json'),
      now: () => NOW,
    });
    expect(result.fresh).toBe(false);
    expect(result.reason).toBe(CREDENTIAL_FRESHNESS_REASONS.FILE_MISSING);
    expect(result.message).toMatch(/./);
  });

  it('blocks when the credentials file is not valid JSON', () => {
    const file = writeCredential('{ not json ]');
    const result = inspectCredentialFreshness({ credentialPath: file, now: () => NOW });
    expect(result.fresh).toBe(false);
    expect(result.reason).toBe(CREDENTIAL_FRESHNESS_REASONS.PARSE_ERROR);
  });

  it('blocks when claudeAiOauth (or its expiresAt) is missing', () => {
    const noOauth = inspectCredentialFreshness({
      credentialPath: writeCredential({ somethingElse: true }),
      now: () => NOW,
    });
    expect(noOauth.fresh).toBe(false);
    expect(noOauth.reason).toBe(CREDENTIAL_FRESHNESS_REASONS.OAUTH_MISSING);

    const noExpiry = inspectCredentialFreshness({
      credentialPath: writeCredential({ claudeAiOauth: { accessToken: 'x' } }),
      now: () => NOW,
    });
    expect(noExpiry.fresh).toBe(false);
    expect(noExpiry.reason).toBe(CREDENTIAL_FRESHNESS_REASONS.OAUTH_MISSING);
  });
});

describe('inspectCredentialFreshness — read-only red line', () => {
  it('does not error and does not mutate the file (mtime invariant) on a read-only credential', () => {
    const file = writeCredential({ claudeAiOauth: { expiresAt: NOW + 5 * MINUTE } });
    chmodSync(file, 0o444);
    const before = statSync(file).mtimeMs;

    expect(() => inspectCredentialFreshness({ credentialPath: file, now: () => NOW })).not.toThrow();

    const after = statSync(file).mtimeMs;
    expect(after).toBe(before);
  });

  it('performs no filesystem write calls — only reads', () => {
    const file = writeCredential({ claudeAiOauth: { expiresAt: NOW + 5 * MINUTE } });
    const reads = [];
    const readFile = vi.fn((p) => {
      reads.push(p);
      return readFileSync(p, 'utf8');
    });
    inspectCredentialFreshness({ credentialPath: file, now: () => NOW, readFile });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(reads).toEqual([file]);
  });
});

describe('createCredentialFreshnessCheck — account-scoped adapter', () => {
  it('maps a claude account to its credentials path and reports staleness', () => {
    const file = writeCredential({ claudeAiOauth: { expiresAt: NOW + 5 * MINUTE } });
    const check = createCredentialFreshnessCheck({
      now: () => NOW,
      resolveCredentialPath: (provider, account) => {
        expect(provider).toBe('claude');
        expect(account).toBe('account1');
        return file;
      },
    });
    const result = check({ provider: 'claude', account: 'account1', machine: 'us-mac-m4' });
    expect(result.fresh).toBe(false);
    expect(result.reason).toBe(CREDENTIAL_FRESHNESS_REASONS.EXPIRING_SOON);
    expect(result.account).toBe('account1');
  });

  it('skips (treats as fresh) providers without a resolvable local credential path', () => {
    const check = createCredentialFreshnessCheck({
      now: () => NOW,
      resolveCredentialPath: () => null,
    });
    const result = check({ provider: 'codex', account: 'team1', machine: 'us-mac-m4' });
    expect(result.fresh).toBe(true);
    expect(result.skipped).toBe(true);
  });
});
