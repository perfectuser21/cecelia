#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
node --input-type=module <<'NODE'
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertionCommand } from './packages/brain/src/lib/gp-assertion-command.js';

const root = process.cwd();
const node = await realpath(process.execPath);
const vitest = await realpath(resolve(root, 'node_modules/.bin/vitest'));
const command = await assertionCommand(
  'packages/brain/src/lib/__tests__/gp-assertion-command.test.js',
  root,
  { toolchains: { node: { path: node }, vitest: { path: vitest } } },
);
if (command.executable !== node || command.argv[0] !== vitest) process.exit(1);
if (command.argv.at(-1) !== '--' || command.options.shell) process.exit(1);
if (command.options.env.inherit || command.options.env.allowlist.length)
  process.exit(1);
if (command.options.toolchain.some(item => !item.path.startsWith('/')))
  process.exit(1);
console.log('GP_ASSERTION_COMMAND_SMOKE_PASS');
NODE
