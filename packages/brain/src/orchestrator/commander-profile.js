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

export function parseCommanderProfile({ commanderMode, payload }) {
  const mode = parseCommanderMode(commanderMode);
  if (mode !== 'hybrid') {
    return { mode, commander: null };
  }

  const source = payload && typeof payload === 'object' ? payload : {};
  assertNoSecretMaterial(source);
  const commander = commanderProfileSchema.parse(source.commander);
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
