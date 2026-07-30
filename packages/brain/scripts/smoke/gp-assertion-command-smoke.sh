#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."
node --input-type=module <<'NODE'
import { isAbsolute, join } from 'node:path';
import { assertionCommand, canonicalRepoIdentity } from './packages/brain/src/lib/gp-assertion-command.js';
import { createAssertionExecutor } from './packages/brain/src/lib/gp-assertion-process.js';

const command = await assertionCommand(
  'packages/brain/src/lib/__tests__/gp-assertion-command.test.js',
  process.cwd(),
);
if (command.options.shell || command.options.evidenceKind !== 'vitest') process.exit(1);
if (!command.options.cwd.endsWith('/packages/brain')) process.exit(1);
if (command.argv.at(-1) !== '--') process.exit(1);
if (!command.options.toolchain_paths.every(isAbsolute)) process.exit(1);
if (command.executable !== command.options.toolchain_paths[0]) process.exit(1);
const originalPath = process.env.PATH;
let execution;
try {
  process.env.PATH = '/untrusted-path-must-not-run';
  execution = await createAssertionExecutor({ timeoutMs: 30_000 })(
    command.executable,
    command.argv,
    command.options,
  );
} finally {
  process.env.PATH = originalPath;
}
if (execution.exitCode !== 0 || execution.scenarioCount < 1) process.exit(1);

const malicious = await assertionCommand(
  'packages/brain/--config=src/evil.test.js',
  process.cwd(),
  {
    realpathFn: async path => path,
    pathExistsFn: async path => path === join(
      process.cwd(),
      'packages/brain/package.json',
    ),
    isTrackedPathFn: async () => true,
    nodeExecutable: process.execPath,
  },
);
if (malicious.argv.at(-2) !== './--config=src/evil.test.js'
  || malicious.argv.at(-1) !== '--') process.exit(1);
if (canonicalRepoIdentity('https://token@github.com/OpenAI/cecelia.git')
  !== 'github.com/OpenAI/cecelia') process.exit(1);
console.log('GP_ASSERTION_COMMAND_SMOKE_PASS');
NODE
