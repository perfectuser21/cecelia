/**
 * run.js 凭据 loader 接线行为测试：buildRealDeps 走 `!launcher` 分支时，
 * createFileCredentialLoader 必须拿到凭据目录解析（CECELIA_CREDENTIAL_HOME_ROOT）与 trustedUids。
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loaderOptions: [] }));

vi.mock('../credential-broker.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createFileCredentialLoader: vi.fn((options) => {
      mocks.loaderOptions.push(options);
      return vi.fn();
    }),
  };
});

import { buildRealDeps } from '../run.js';

describe('buildRealDeps 凭据 loader 接线', () => {
  it('用 CECELIA_CREDENTIAL_HOME_ROOT 解析凭据目录，并把 CECELIA_CREDENTIAL_TRUSTED_UIDS 交给 loader', async () => {
    mocks.loaderOptions.length = 0;
    const resolveAccountHome = vi.fn(() => '/exec/only');

    await buildRealDeps({
      pool: { query: vi.fn() },
      env: {
        CECELIA_CREDENTIAL_HOME_ROOT: '/x',
        CECELIA_CREDENTIAL_TRUSTED_UIDS: '501',
        CECELIA_MACHINE_ID: 'us-mac-m4',
      },
      handlers: {},
      preflightGate: { evaluate: vi.fn(), validateSnapshotForDispatch: vi.fn() },
      resolveRepoHead: vi.fn(async () => 'c'.repeat(40)),
      loadSkill: vi.fn(),
      resolveAccountHome,
    });

    expect(mocks.loaderOptions).toHaveLength(1);
    const [options] = mocks.loaderOptions;
    expect(options.trustedUids).toEqual([501]);
    expect(options.accountHomeResolver('team1')).toBe('/x/.codex-team1');
    // overrides.resolveAccountHome 只影响执行目录，不进凭据 loader
    expect(resolveAccountHome).not.toHaveBeenCalled();
  });

  it('CECELIA_CREDENTIAL_TRUSTED_UIDS 非法时构造即 fail-loud', async () => {
    await expect(buildRealDeps({
      pool: { query: vi.fn() },
      env: { CECELIA_CREDENTIAL_TRUSTED_UIDS: 'abc', CECELIA_MACHINE_ID: 'us-mac-m4' },
      handlers: {},
      preflightGate: { evaluate: vi.fn(), validateSnapshotForDispatch: vi.fn() },
      resolveRepoHead: vi.fn(async () => 'c'.repeat(40)),
      loadSkill: vi.fn(),
    })).rejects.toMatchObject({ code: 'credential_trusted_uids_invalid' });
  });
});
