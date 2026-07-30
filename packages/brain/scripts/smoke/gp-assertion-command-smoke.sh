#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
node --input-type=module <<'NODE'
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertionCommand } from './packages/brain/src/lib/gp-assertion-command.js';
const lock = JSON.parse(await readFile('./package-lock.json'));
const root = process.cwd();
const node = await realpath(process.execPath);
const vitest = await realpath(resolve(root, 'node_modules/.bin/vitest'));
const command = await assertionCommand(
  'packages/brain/src/lib/__tests__/gp-assertion-command.test.js',
  root,
  { toolchains: { node: { path: node }, vitest: { path: vitest } } },
);
if (command.executable !== node || command.argv[0] !== vitest || lock.packages['packages/brain'].version !== JSON.parse(await readFile('./packages/brain/package.json')).version) process.exit(1);
if (command.argv.at(-1) !== '--' || command.options.shell) process.exit(1);
if (command.options.env.inherit || command.options.env.allowlist.length)
  process.exit(1);
if (command.options.toolchain.some(item => !item.path.startsWith('/')))
  process.exit(1);
console.log('GP_ASSERTION_COMMAND_SMOKE_PASS');
NODE
