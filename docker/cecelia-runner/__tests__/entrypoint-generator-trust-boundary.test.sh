#!/usr/bin/env bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
SOURCE="$ROOT/docker/cecelia-runner/entrypoint.sh"
grep -q 'remote.origin.pushurl' "$SOURCE"
grep -q 'setpriv' "$SOURCE"
for key in HARNESS_CALLBACK_TOKEN HARNESS_LEASE_OWNER HARNESS_LEASE_GENERATION; do grep -q -- "-u $key" "$SOURCE"; done
echo 'generator trust boundary PASS'
