import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseTrustedUids,
  providerAccountDirName,
  resolveCredentialAccountHome,
  resolveProviderAccountHome,
} from './provider-account-home.js';

describe('providerAccountDirName', () => {
  it.each([
    ['codex', 'team3', '.codex-team3'], ['codex', 'codex-team1', '.codex-team1'], ['codex', '2', '.codex-team2'],
    ['claude', 'account2', '.claude-account2'], ['claude', '1', '.claude-account1'],
    ['grok', 'grok', '.grok'], ['grok', 'default', '.grok'],
  ])('%s/%s → %s', (provider, account, expected) => {
    expect(providerAccountDirName(provider, account)).toBe(expected);
  });
  it('rejects unknown accounts', () => {
    expect(() => providerAccountDirName('codex', 'admin')).toThrow('invalid codex account: admin');
    expect(() => providerAccountDirName('gemini', '1')).toThrow('invalid gemini account: 1');
  });
});

describe('resolveProviderAccountHome（执行目录，始终 homedir）', () => {
  it('ignores CECELIA_CREDENTIAL_HOME_ROOT', () => {
    expect(resolveProviderAccountHome('codex', 'team1', { env: { CECELIA_CREDENTIAL_HOME_ROOT: '/srv/x' } }))
      .toBe(path.join(os.homedir(), '.codex-team1'));
    expect(resolveProviderAccountHome('codex', null)).toBeNull();
  });
});

describe('resolveCredentialAccountHome（凭据目录）', () => {
  it.each([[undefined], [''], ['relative/dir']])('falls back to homedir when root is %j', (root) => {
    expect(resolveCredentialAccountHome('codex', 'team2', { env: { CECELIA_CREDENTIAL_HOME_ROOT: root } }))
      .toBe(path.join(os.homedir(), '.codex-team2'));
  });
  it('uses an absolute CECELIA_CREDENTIAL_HOME_ROOT for every provider', () => {
    const env = { CECELIA_CREDENTIAL_HOME_ROOT: '/Users/administrator' };
    expect(resolveCredentialAccountHome('codex', 'team5', { env })).toBe('/Users/administrator/.codex-team5');
    expect(resolveCredentialAccountHome('claude', 'account1', { env })).toBe('/Users/administrator/.claude-account1');
    expect(resolveCredentialAccountHome('grok', 'default', { env })).toBe('/Users/administrator/.grok');
  });
});

describe('parseTrustedUids', () => {
  it('returns [] when unset or blank', () => {
    expect(parseTrustedUids({})).toEqual([]);
    expect(parseTrustedUids({ CECELIA_CREDENTIAL_TRUSTED_UIDS: ' ' })).toEqual([]);
  });
  it('parses a comma list of non-negative integers', () => {
    expect(parseTrustedUids({ CECELIA_CREDENTIAL_TRUSTED_UIDS: '501, 502' })).toEqual([501, 502]);
  });
  it.each([['abc'], ['-1'], ['1.5'], ['501,,502']])('fails loud on %j', (value) => {
    expect(() => parseTrustedUids({ CECELIA_CREDENTIAL_TRUSTED_UIDS: value })).toThrow('credential_trusted_uids_invalid');
  });
});

describe('kernel/watchdog loader 接线（源码哨兵）', () => {
  it.each([['run.js'], ['../harness-relay-watchdog.js']])('%s 用凭据目录解析与 trustedUids', async (file) => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    expect(source).toMatch(/createFileCredentialLoader\(\{[\s\S]*?resolveCredentialAccountHome\(/);
    expect(source).toMatch(/trustedUids:\s*parseTrustedUids\(/);
  });
});
