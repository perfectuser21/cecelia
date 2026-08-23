/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * r56 (run 4c6a461c) 实证：第 27 批把 commander_mode 缺省反转 hybrid，但
 * parseCommanderProfile 对 hybrid 强制要求 payload.commander（primary/fallbacks
 * 目标账号），常规任务注册从不带该字段 → commanderProfileSchema.parse(undefined)
 * → Zod invalid_type(path=[]) → kernel 进程秒死（kernel_process_fatal）。
 * 「缺省 hybrid」要真正可用，profile 也必须有缺省。
 *
 * 修复：payload.commander 缺失时回退内置缺省 profile（codex/team2/gpt-5.6-sol
 * @us-mac-m4，历史 hybrid run 生产验证过的配置）；env KERNEL_COMMANDER_PROFILE_JSON
 * 可覆盖内置值；显式 payload.commander 仍最高优先且照常严格校验（非法仍 throw）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { parseCommanderProfile } from '../../../packages/brain/src/orchestrator/commander-profile.js';

afterEach(() => {
  delete process.env.KERNEL_COMMANDER_PROFILE_JSON;
});

describe('hybrid 缺省 Commander profile 回退', () => {
  it('payload.commander 缺失 → 回退内置缺省，不 throw（r56 复刻）', () => {
    const profile = parseCommanderProfile({ commanderMode: 'hybrid', payload: {} });
    expect(profile.mode).toBe('hybrid');
    expect(profile.commander).not.toBeNull();
    expect(profile.commander.primary.provider).toBe('codex');
    expect(profile.commander.primary.account).toBe('team2');
    expect(profile.commander.primary.role).toBe('commander');
  });

  it('payload 整体缺失（undefined）同样回退，不 throw', () => {
    const profile = parseCommanderProfile({ commanderMode: 'hybrid', payload: undefined });
    expect(profile.commander).not.toBeNull();
  });

  it('env KERNEL_COMMANDER_PROFILE_JSON 覆盖内置缺省', () => {
    process.env.KERNEL_COMMANDER_PROFILE_JSON = JSON.stringify({
      primary: { provider: 'claude', account: 'account2', model: 'claude-fable-5' },
      fallbacks: [],
    });
    const profile = parseCommanderProfile({ commanderMode: 'hybrid', payload: {} });
    expect(profile.commander.primary.provider).toBe('claude');
    expect(profile.commander.primary.account).toBe('account2');
  });

  it('负向：显式 payload.commander 最高优先，且非法形状仍 throw', () => {
    const explicit = parseCommanderProfile({
      commanderMode: 'hybrid',
      payload: {
        commander: {
          primary: { provider: 'codex', account: 'team1', model: 'gpt-5.6-sol' },
          fallbacks: [],
        },
      },
    });
    expect(explicit.commander.primary.account).toBe('team1');
    expect(() => parseCommanderProfile({
      commanderMode: 'hybrid',
      payload: { commander: { bogus: true } },
    })).toThrow();
  });

  it('负向：kernel-only 语义不变（commander=null）', () => {
    const profile = parseCommanderProfile({ commanderMode: 'kernel-only', payload: {} });
    expect(profile.commander).toBeNull();
  });

  it('负向：env 覆盖值非法 JSON/非法形状 → throw（fail-closed 不静默吞）', () => {
    process.env.KERNEL_COMMANDER_PROFILE_JSON = '{not json';
    expect(() => parseCommanderProfile({ commanderMode: 'hybrid', payload: {} })).toThrow();
  });
});
