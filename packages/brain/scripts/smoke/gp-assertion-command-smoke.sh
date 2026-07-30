#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
node --input-type=module <<'NODE'
import { assertionCommand, canonicalRepoIdentity } from './packages/brain/src/lib/gp-assertion-command.js';

const command = await assertionCommand(
  'packages/brain/src/lib/__tests__/gp-assertion-command.test.js',
  process.cwd(),
);
if (command.options.shell || command.options.evidenceKind !== 'vitest') process.exit(1);
if (!command.options.cwd.endsWith('/packages/brain')) process.exit(1);
if (canonicalRepoIdentity('https://token@github.com/OpenAI/cecelia.git')
  !== 'github.com/OpenAI/cecelia') process.exit(1);
console.log('GP_ASSERTION_COMMAND_SMOKE_PASS');
NODE
