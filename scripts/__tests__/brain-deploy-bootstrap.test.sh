#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/brain-bootstrap.sh"

calls=()
BOOTSTRAP_TICK_DISABLED_BY_DEPLOY=false
DRAIN_STARTED_BY_DEPLOY=false
bootstrap_assert_identity() { calls+=(identity); BOOTSTRAP_BINDING_JSON='{}'; }
bootstrap_audit() { calls+=(audit); [[ "${AUDIT_SAFE:-1}" == 1 ]]; }
curl() {
  calls+=("$*")
  case "$*" in
    *'/tick/disable'*) printf '{"enabled":false}' ;;
    *'/tick/drain'*) printf '{"draining":true,"remaining":30}' ;;
    *'/tick/status'*) printf '{"enabled":false,"loop_running":false,"tick_running":false,"draining":true}' ;;
    *'/tick/enable'*) printf '{"enabled":true}' ;;
  esac
}

AUDIT_SAFE=0
if bootstrap_before_swap old new sha version >/dev/null 2>&1; then
  echo 'FAIL: unsafe pre-audit allowed bootstrap' >&2; exit 1
fi
[[ "${calls[*]}" != *'/tick/disable'* ]] || { echo 'FAIL: tick disabled before audit' >&2; exit 1; }

calls=()
AUDIT_SAFE=1
bootstrap_before_swap old new sha version >/dev/null
[[ "$BOOTSTRAP_TICK_DISABLED_BY_DEPLOY" == true ]]
[[ "$DRAIN_STARTED_BY_DEPLOY" == true ]]
[[ "${calls[*]}" == *'identity audit '*'/tick/disable'*'/tick/drain'*'audit'* ]]
echo 'PASS: bootstrap audits before and after pausing dispatch'
