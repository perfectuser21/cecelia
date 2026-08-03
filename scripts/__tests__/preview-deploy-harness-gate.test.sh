#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/preview-deploy.yml"
CAPACITY_GATE="$ROOT_DIR/packages/brain/src/capacity-gate.js"

preview_job="$({
  sed -n '/^  preview_deploy:/,/^    steps:/p' "$WORKFLOW"
} || true)"

if ! grep -Eq "if:.*!contains\(github\.event\.pull_request\.labels\.\*\.name, 'harness'\)" \
  <<<"$preview_job"; then
  echo "FAIL: Preview Deploy must skip harness-labelled infrastructure PRs" >&2
  exit 1
fi

# Decoupling Preview from Kernel must not weaken the host disk safety policy.
grep -Fq 'CAPACITY_RESERVE_BYTES = 3.5 * GIB' "$CAPACITY_GATE"
grep -Fq 'CAPACITY_FLOOR_BYTES = 35 * GIB' "$CAPACITY_GATE"

echo "PASS: harness PRs skip Preview while the 38.5 GiB safety envelope remains intact"
