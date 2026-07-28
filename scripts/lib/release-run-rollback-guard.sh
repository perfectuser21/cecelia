#!/usr/bin/env bash
set -euo pipefail

guard_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rollback_deny() {
  echo "Dedicated ReleaseRun rollback authority required: $1" >&2
  exit 78
}

[[ "${KERNEL_RELEASE_ROLLBACK_WORKER:-0}" == "1" ]] \
  || rollback_deny "server-owned worker marker unavailable"
[[ "${KERNEL_RELEASE_PRIVATE_CONFIG_FILE:-}" == /* ]] \
  || rollback_deny "private worker authority unavailable"

node "$guard_dir/verify-release-rollback-worker.mjs" \
  "$KERNEL_RELEASE_PRIVATE_CONFIG_FILE" \
  "${KERNEL_RELEASE_ROLLBACK_AUTHORITY_ID:-}" \
  "${KERNEL_RELEASE_RUN_ID:-}" \
  "${KERNEL_RELEASE_MERGE_SHA:-}" \
  "${KERNEL_RELEASE_ROLLBACK_CLAIM_ID:-}" \
  "${KERNEL_RELEASE_ROLLBACK_GENERATION:-}" \
  || rollback_deny "exact live rollback claim could not be verified"
