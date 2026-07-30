#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
node --input-type=module <<'NODE'
import {
  byteSafeTail,
  redactAndBoundOutput,
  scenarioEvidenceFromOutput,
} from './src/lib/gp-assertion-output.js';

if (byteSafeTail(Buffer.alloc(16, 0xFF), 8).includes('�')) process.exit(1);
if (redactAndBoundOutput('token=secret').includes('secret')) process.exit(1);
const protectedOutput = redactAndBoundOutput(
  'AWS_SECRET_ACCESS_KEY=aws-smoke-secret\n'
    + 'endpoint=https://user:uri-smoke-secret@api.example.test/v1',
);
if (protectedOutput.includes('smoke-secret')) process.exit(1);
const evidence = scenarioEvidenceFromOutput('vitest', 'Tests  2 passed (2)');
if (evidence.scenarioCount !== 2) process.exit(1);
console.log('GP_ASSERTION_OUTPUT_SMOKE_PASS');
NODE
