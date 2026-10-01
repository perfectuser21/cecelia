import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseCommanderProfile } from '../commander-profile.js';

const runId = randomUUID();

function validProfile(overrides = {}) {
  return {
    run_id: runId,
    objective: 'Finish the approved Harness change.',
    workflow: 'gan-development',
    priority: 'P0',
    commander: {
      primary: {
        provider: 'codex',
        account: 'team4',
        model: 'GPT-5.5',
        machine: 'us-mac-m4',
      },
      fallbacks: [
        {
          provider: 'claude',
          account: 'account1',
          model: 'claude-opus',
          machine: 'xian-mac-m1',
        },
        {
          provider: 'grok',
          account: 'grok',
          model: 'grok-code',
          machine: 'xian-mac-m4',
        },
      ],
    },
    roles: {},
    routing: { strict_affinity: false },
    budget: { max_usd: 10, safety_max_hops: 4096 },
    ...overrides,
  };
}

describe('Commander RunProfile parser', () => {
  it.each([true, false])('accepts the registered task authorization narrative with explicit profile=%s without changing payload', (explicit) => {
    // The public payload shape which failed in the real 0994 controller run.
    const task = { payload: {
      lane: 'AI', repo: 'cecelia', actor: 'codex',
      branch: 'cp-1001-contract-context',
      base_sha: '675f80f874396d8972a894420ecec0cf0ad357c1',
      map_scope: ['F1', 'MJ5'], work_kind: 'coding_mutation',
      sprint_dir: 'sprints', change_kind: 'bugfix',
      routing_receipt_id: '464d91b8-a7f1-4385-8a15-9e5d4a7b28ba',
      user_authorization: '用户授权继续未完成与原始bug；本棒是实际native gate所需缺上下文修复',
      ...(explicit ? { commander: validProfile().commander } : {}),
    } };
    const before = structuredClone(task.payload);

    const profile = parseCommanderProfile({ commanderMode: 'hybrid', payload: task.payload });

    expect(profile.mode).toBe('hybrid');
    expect(profile.commander.primary.role).toBe('commander');
    expect(task.payload).toEqual(before);
  });

  it.each([
    { access_token: 'credential' },
    ['说明'],
    '说明'.repeat(2001),
    'Bearer fixture-credential',
    'token=fixture-credential',
    'password: fixture-credential',
  ])('rejects invalid or secret-bearing authorization narratives %j', (user_authorization) => {
    expect(() => parseCommanderProfile({
      commanderMode: 'hybrid',
      payload: validProfile({ user_authorization }),
    })).toThrow();
  });

  it.each([
    { access_token: 'credential' },
    { nested: { password: 'credential' } },
    { authorization: 'Bearer fixture-credential' },
    { user_authorization_extra: 'credential' },
  ])('keeps rejecting other task credential fields with a public authorization narrative %j', (extra) => {
    expect(() => parseCommanderProfile({
      commanderMode: 'hybrid',
      payload: validProfile({ user_authorization: '用户确认执行已有任务', ...extra }),
    })).toThrow('secret_material_forbidden');
  });

  it('keeps role, provider, account, model, and machine as independent axes', () => {
    const parsed = parseCommanderProfile({
      commanderMode: 'hybrid',
      payload: validProfile(),
    });

    expect(parsed.mode).toBe('hybrid');
    expect(parsed.commander.primary).toEqual({
      role: 'commander',
      provider: 'codex',
      account: 'team4',
      model: 'GPT-5.5',
      machine: 'us-mac-m4',
    });
    expect(parsed.commander.fallbacks.map((target) => ({
      provider: target.provider,
      account: target.account,
      machine: target.machine,
    }))).toEqual([
      { provider: 'claude', account: 'account1', machine: 'xian-mac-m1' },
      { provider: 'grok', account: 'grok', machine: 'xian-mac-m4' },
    ]);
  });

  it.each(['kernel-only', 'legacy-session'])(
    'does not require Commander configuration in %s mode',
    (commanderMode) => {
      expect(parseCommanderProfile({ commanderMode, payload: {} })).toEqual({
        mode: commanderMode,
        commander: null,
      });
    },
  );

  it('loud-fails hybrid mode without an explicit primary target', () => {
    expect(() => parseCommanderProfile({
      commanderMode: 'hybrid',
      payload: { commander: { fallbacks: [] } },
    })).toThrow(/primary/);
  });

  it.each([
    [
      'unknown target key',
      () => validProfile({
        commander: {
          ...validProfile().commander,
          primary: { ...validProfile().commander.primary, location: 'us' },
        },
      }),
    ],
    [
      'duplicate target',
      () => validProfile({
        commander: {
          ...validProfile().commander,
          fallbacks: [{ ...validProfile().commander.primary }],
        },
      }),
    ],
    [
      'missing provider',
      () => {
        const profile = validProfile();
        delete profile.commander.primary.provider;
        return profile;
      },
    ],
    [
      'missing account',
      () => {
        const profile = validProfile();
        delete profile.commander.primary.account;
        return profile;
      },
    ],
    [
      'secret-shaped key',
      () => validProfile({
        commander: {
          ...validProfile().commander,
          primary: { ...validProfile().commander.primary, api_key: 'secret' },
        },
      }),
    ],
    [
      'more than three fallbacks',
      () => validProfile({
        commander: {
          ...validProfile().commander,
          fallbacks: [
            { provider: 'codex', account: 'team1', machine: 'us-mac-m4' },
            { provider: 'claude', account: 'account1', machine: 'us-mac-m4' },
            { provider: 'grok', account: 'grok', machine: 'us-mac-m4' },
            { provider: 'codex', account: 'team2', machine: 'us-mac-m4' },
          ],
        },
      }),
    ],
  ])('rejects %s', (_name, buildProfile) => {
    expect(() => parseCommanderProfile({
      commanderMode: 'hybrid',
      payload: buildProfile(),
    })).toThrow();
  });
});
