import { z } from 'zod';

import {
  assertNoSecretMaterial,
  parseCommanderMode,
} from './commander-contract.js';

const targetSchema = z.object({
  provider: z.string().min(1).max(128),
  account: z.string().min(1).max(128),
  model: z.string().min(1).max(256).optional(),
  machine: z.string().min(1).max(256).optional(),
}).strict();

const commanderProfileSchema = z.object({
  primary: targetSchema,
  fallbacks: z.array(targetSchema).max(3).default([]),
}).strict();

function targetKey(target) {
  return [
    target.provider,
    target.account,
    target.model ?? '',
    target.machine ?? '',
  ].join('\u0000');
}

function withCommanderRole(target) {
  return { role: 'commander', ...target };
}

const DEFAULT_COMMANDER_PROFILE = Object.freeze({
  primary: Object.freeze({
    provider: 'codex',
    account: 'team2',
    model: 'gpt-5.6-sol',
    machine: 'us-mac-m4',
  }),
  fallbacks: Object.freeze([]),
});

export function parseCommanderProfile({ commanderMode, payload }) {
  const mode = parseCommanderMode(commanderMode);
  if (mode !== 'hybrid') {
    return { mode, commander: null };
  }

  const source = payload && typeof payload === 'object' ? payload : {};
  assertNoSecretMaterial(source);
  // 缺省 profile 回退（r56 run 4c6a461c 实证）：第 27 批把 commander_mode 缺省反转
  // hybrid 后，常规任务注册不带 payload.commander，parse(undefined) 会让 kernel 进程
  // 秒死——「缺省 hybrid」要可用，profile 也必须有缺省。优先级：显式 payload.commander
  // > env KERNEL_COMMANDER_PROFILE_JSON > 内置缺省（历史 hybrid run 生产验证过的配置）。
  // env/内置缺省同样过 schema 严格校验，非法 fail-closed。
  let profileSource = source.commander;
  if (profileSource === undefined) {
    const envProfile = process.env.KERNEL_COMMANDER_PROFILE_JSON;
    profileSource = envProfile !== undefined
      ? JSON.parse(envProfile)
      : DEFAULT_COMMANDER_PROFILE;
  }
  const commander = commanderProfileSchema.parse(profileSource);
  const targets = [commander.primary, ...commander.fallbacks];
  const uniqueTargets = new Set(targets.map(targetKey));
  if (uniqueTargets.size !== targets.length) {
    throw new Error('commander_target_duplicate');
  }

  return {
    mode,
    commander: {
      primary: withCommanderRole(commander.primary),
      fallbacks: commander.fallbacks.map(withCommanderRole),
    },
  };
}

export const __test__ = {
  targetSchema,
  commanderProfileSchema,
};
