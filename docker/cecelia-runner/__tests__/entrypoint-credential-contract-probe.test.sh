#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

grep -Fq '# credential-contract-probe:start' "$ENTRYPOINT" || {
  echo "missing Runner credential functional probe" >&2
  exit 1
}

probe_output="$(
  HARNESS_CANARY=true \
  CLAUDE_CONFIG_DIR="$TEST_ROOT/claude" \
    bash "$ENTRYPOINT" __cecelia_runner_credential_contract_probe__
)"

test "$probe_output" = 'runner-credential-contract-ok'

echo "entrypoint credential contract probe tests passed"
