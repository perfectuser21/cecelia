#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
OUT="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$OUT" "$ERR"' EXIT
cd "$ROOT"

set +e
node packages/brain/scripts/run-gp-assertion.mjs \
  --link-id 22222222-2222-4222-8222-222222222222 \
  --run-id 11111111-1111-4111-8111-111111111111 >"$OUT" 2>"$ERR"
STATUS=$?
set -e

[ "$STATUS" -eq 1 ]
[ ! -s "$OUT" ]
node --input-type=module - "$ERR" <<'NODE'
import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').trim().split('\n');
if (lines.length !== 1) process.exit(1);
const result = JSON.parse(lines[0]);
if (result.error !== 'ASSERTION_TRUSTED_RUNNER_UNAVAILABLE') process.exit(1);
NODE
echo 'GP_ASSERTION_CLI_FAIL_CLOSED_SMOKE_PASS'
