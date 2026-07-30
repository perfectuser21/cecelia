#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
node --input-type=module <<'NODE'
import { createAssertionExecutor } from './src/lib/gp-assertion-process.js';

const execute = createAssertionExecutor({ timeoutMs: 5000 });
const result = await execute(
  process.execPath,
  ['-e', "console.log('Tests  1 passed (1)')"],
  { cwd: process.cwd(), evidenceKind: 'vitest' },
);
if (result.exitCode !== 0 || result.scenarioCount !== 1) process.exit(1);
console.log('GP_ASSERTION_PROCESS_SMOKE_PASS');
NODE
