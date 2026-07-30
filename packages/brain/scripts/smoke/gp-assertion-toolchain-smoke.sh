#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
TOOL_FILE="$TEMP_DIR/bash"
printf 'node-v1' > "$TOOL_FILE"
cd "$BRAIN_DIR"

TOOLCHAIN_SMOKE_FILE="$TOOL_FILE" node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { assertionCommand } from './src/lib/gp-assertion-command.js';
import {
  createToolchainAttestation,
  verifyToolchainAttestation,
} from './src/lib/gp-assertion-toolchain.js';

const digest = `sha256:${'a'.repeat(64)}`;
const bytes = await readFile(process.env.TOOLCHAIN_SMOKE_FILE);
const command = await assertionCommand('scripts/smoke/gp.sh', '/repo', {
  realpathFn: async path => path,
  fileStatFn: async () => ({ isFile: () => true }),
  isTrackedPathFn: async () => true,
  toolchains: { bash: { path: process.env.TOOLCHAIN_SMOKE_FILE,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` } },
});
const attestation = await createToolchainAttestation({
  command,
  actual_runner_digest: digest,
  expected_runner_digest: digest,
});
if (JSON.stringify(attestation).includes('node-v1')) process.exit(1);
await writeFile(process.env.TOOLCHAIN_SMOKE_FILE, 'node-v2');
try {
  await verifyToolchainAttestation(attestation);
  process.exit(1);
} catch (error) {
  if (error.code !== 'ASSERTION_TOOLCHAIN_DRIFT') throw error;
}
console.log('GP_ASSERTION_TOOLCHAIN_SMOKE_PASS');
NODE
