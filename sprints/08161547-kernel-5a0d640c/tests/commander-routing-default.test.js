import { describe, it, expect } from 'vitest';

// TDD Red：commander-routing.js 尚未创建 —— 入口透传 + F1 线默认 hybrid 的纯决策函数。
// Work Router（work-routing-store.createRoutedTask）必须调用它，禁止 mock（禁 mock 边清单）。
import {
  resolveCommanderRunConfig,
  DEFAULT_F1_COMMANDER_PROFILE,
  F1_JOURNEY_ID,
} from '../../../packages/brain/src/orchestrator/commander-routing.js';

const VALID_PROFILE = {
  primary: { provider: 'codex', account: 'team2', machine: 'us-mac-m4' },
  fallbacks: [{ provider: 'claude', account: 'account2', machine: 'us-mac-m4' }],
};

describe('resolveCommanderRunConfig [BEHAVIOR]', () => {
  it('explicit hybrid with valid profile passes profile through', () => {
    const out = resolveCommanderRunConfig({
      commanderMode: 'hybrid',
      commanderProfile: VALID_PROFILE,
      commanderRetryBudget: 5,
      mapScope: ['F2'],
      journeyId: null,
    });
    expect(out.commanderMode).toBe('hybrid');
    expect(out.commanderProfile.primary.provider).toBe('codex');
    expect(out.commanderProfile.primary.account).toBe('team2');
    expect(out.commanderRetryBudget).toBe(5);
  });

  it('explicit hybrid with unknown profile key throws invalid_commander_profile', () => {
    expect(() => resolveCommanderRunConfig({
      commanderMode: 'hybrid',
      commanderProfile: { ...VALID_PROFILE, strict_affinity: true },
      mapScope: ['F1'],
      journeyId: null,
    })).toThrow(/invalid_commander_profile/);
  });

  it('no mode with map_scope F1 defaults to hybrid with default profile', () => {
    const out = resolveCommanderRunConfig({
      commanderMode: undefined,
      commanderProfile: undefined,
      mapScope: ['F1', 'brain'],
      journeyId: null,
    });
    expect(out.commanderMode).toBe('hybrid');
    expect(out.commanderProfile).toEqual(DEFAULT_F1_COMMANDER_PROFILE);
    expect(out.commanderProfile.primary.provider).toBe('codex');
  });

  it('no mode with F1 journey id defaults to hybrid with default profile', () => {
    const out = resolveCommanderRunConfig({
      commanderMode: null,
      mapScope: [],
      journeyId: F1_JOURNEY_ID,
    });
    expect(out.commanderMode).toBe('hybrid');
    expect(out.commanderProfile).toEqual(DEFAULT_F1_COMMANDER_PROFILE);
  });

  it('no mode on a non-F1 line stays kernel-only with no profile', () => {
    const out = resolveCommanderRunConfig({
      commanderMode: undefined,
      mapScope: ['F2', 'dashboard'],
      journeyId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    expect(out.commanderMode).toBe('kernel-only');
    expect(out.commanderProfile).toBeNull();
  });

  it('explicit kernel-only overrides F1 default (F1 line can opt out)', () => {
    const out = resolveCommanderRunConfig({
      commanderMode: 'kernel-only',
      mapScope: ['F1'],
      journeyId: F1_JOURNEY_ID,
    });
    expect(out.commanderMode).toBe('kernel-only');
    expect(out.commanderProfile).toBeNull();
  });
});
