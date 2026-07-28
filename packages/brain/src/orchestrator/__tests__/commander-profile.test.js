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
