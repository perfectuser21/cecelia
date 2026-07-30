#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
TOOL_FILE="$TEMP_DIR/node"
ZERO_FILE="$TEMP_DIR/zero"
LARGE_FILE="$TEMP_DIR/large"
FIFO_FILE="$TEMP_DIR/fifo"
printf 'node-v1' > "$TOOL_FILE"
: > "$ZERO_FILE"
printf '12345' > "$LARGE_FILE"
mkfifo "$FIFO_FILE"
cd "$BRAIN_DIR"

TOOLCHAIN_SMOKE_FILE="$TOOL_FILE" \
TOOLCHAIN_ZERO_FILE="$ZERO_FILE" \
TOOLCHAIN_LARGE_FILE="$LARGE_FILE" \
TOOLCHAIN_FIFO_FILE="$FIFO_FILE" \
node --input-type=module <<'NODE'
import { writeFile } from 'node:fs/promises';
import {
  createToolchainAttestation,
  verifyToolchainAttestation,
} from './src/lib/gp-assertion-toolchain.js';

const digest = `sha256:${'a'.repeat(64)}`;
const input = path => ({
  actual_runner_digest: digest,
  expected_runner_digest: digest,
  toolchain_paths: [path],
});
async function expectCode(path, code, options) {
  try {
    await createToolchainAttestation(input(path), options);
    process.exit(1);
  } catch (error) {
    if (error.code !== code) throw error;
  }
}
const attestation = await createToolchainAttestation({
  actual_runner_digest: digest,
  expected_runner_digest: digest,
  toolchain_paths: [process.env.TOOLCHAIN_SMOKE_FILE],
});
if (JSON.stringify(attestation).includes('node-v1')) process.exit(1);
await expectCode('/dev/null', 'ASSERTION_TOOLCHAIN_FILE_NOT_REGULAR');
await expectCode(process.env.TOOLCHAIN_ZERO_FILE, 'ASSERTION_TOOLCHAIN_FILE_EMPTY');
await expectCode(
  process.env.TOOLCHAIN_LARGE_FILE,
  'ASSERTION_TOOLCHAIN_FILE_TOO_LARGE',
  { maxFileBytes: 4 },
);
await expectCode(
  process.env.TOOLCHAIN_FIFO_FILE,
  'ASSERTION_TOOLCHAIN_FILE_NOT_REGULAR',
);
await writeFile(process.env.TOOLCHAIN_SMOKE_FILE, 'node-v2');
try {
  await verifyToolchainAttestation(attestation);
  process.exit(1);
} catch (error) {
  if (error.code !== 'ASSERTION_TOOLCHAIN_DRIFT') throw error;
}
console.log('GP_ASSERTION_TOOLCHAIN_SMOKE_PASS');
NODE
