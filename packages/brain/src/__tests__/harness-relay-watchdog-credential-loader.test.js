/**
 * watchdog codex resume 分支的凭据 loader 接线行为测试：
 * 不注入 credentialBroker/loadCredential 时，loader 必须用凭据目录解析与 trustedUids。
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adapter: { name: 'codex', resume: vi.fn(() => ({ provider: 'codex', args: [], env: {} })) },
  loaderOptions: [],
}));

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../orchestrator/provider-registry.js', () => ({
  createProviderRegistry: () => ({ resolve: () => mocks.adapter }),
}));
vi.mock('../orchestrator/providers/claude.js', () => ({ claudeAdapter: {} }));
vi.mock('../orchestrator/providers/codex.js', () => ({ codexAdapter: {} }));
vi.mock('../orchestrator/providers/grok.js', () => ({ grokAdapter: {} }));
vi.mock('../orchestrator/dispatcher.js', () => ({
  resolveProviderAccountHome: vi.fn(() => '/exec/only'),
}));
vi.mock('../orchestrator/credential-broker.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createFileCredentialLoader: vi.fn((options) => {
      mocks.loaderOptions.push(options);
      return vi.fn();
    }),
  };
});

import { resumeKernelAttempt } from '../harness-relay-watchdog.js';

function resumeContext(env) {
  const originalParentAttempt = {
    id: 'attempt-parent',
    run_id: 'run-1',
    provider: 'codex',
    provider_session_id: 'thread-1',
    account_id: null,
    machine_id: 'us-mac-m4',
    requested_machine_id: 'us-mac-m4',
    task_bundle: { inputs: {} },
    lease_owner: 'dispatcher-parent',
    lease_generation: 6,
    local_container_naming: 'generation-v1',
  };
  const child = {
    ...originalParentAttempt,
    id: 'attempt-child',
    lease_owner: 'watchdog:test',
    lease_generation: 0,
  };
  return [child, {
    originalParentAttempt,
    reclaimedParentAttempt: { ...originalParentAttempt, lease_owner: 'watchdog:test', lease_generation: 7 },
    task: { payload: {} },
    dbPool: { query: vi.fn() },
    callbackSecret: 'rotated-raw-secret',
    leaseOwner: 'watchdog:test',
    attemptStore: { recordLaunchReceipt: vi.fn(), fail: vi.fn() },
    // inspect 失败 → 在父 attempt 清理阶段提前返回，只观察 loader 构造
    launcher: { inspect: vi.fn(async () => { throw new Error('stop_here'); }) },
    env,
  }];
}

describe('resumeKernelAttempt 凭据 loader 接线', () => {
  it('codex resume 用 CECELIA_CREDENTIAL_HOME_ROOT 解析凭据目录并传 trustedUids', async () => {
    mocks.loaderOptions.length = 0;
    const result = await resumeKernelAttempt(...resumeContext({
      CECELIA_CREDENTIAL_HOME_ROOT: '/x',
      CECELIA_CREDENTIAL_TRUSTED_UIDS: '501',
      CECELIA_MACHINE_ID: 'us-mac-m4',
    }));

    expect(result).toMatchObject({ ok: false, failure_code: 'resume_parent_cleanup_unconfirmed' });
    expect(mocks.loaderOptions).toHaveLength(1);
    const [options] = mocks.loaderOptions;
    expect(options.trustedUids).toEqual([501]);
    expect(options.accountHomeResolver('team1')).toBe('/x/.codex-team1');
  });

  it('CECELIA_CREDENTIAL_TRUSTED_UIDS 非法时 fail-loud', async () => {
    await expect(resumeKernelAttempt(...resumeContext({
      CECELIA_CREDENTIAL_TRUSTED_UIDS: '501,',
      CECELIA_MACHINE_ID: 'us-mac-m4',
    }))).rejects.toMatchObject({ code: 'credential_trusted_uids_invalid' });
  });
});
