#!/usr/bin/env bash
# The old deploy process dies with blue. Only the detached sidecar can restore
# the persistent manual tick disable after the new container is pinned.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SCRIPT_DIR/lib/brain-bootstrap-sidecar.sh"

old_image="sha256:$(printf 'a%.0s' {1..64})"
new_image="sha256:$(printf 'b%.0s' {1..64})"
old_sha=$(printf 'c%.0s' {1..40})
new_sha=$(printf 'd%.0s' {1..40})
BRAIN_BOOTSTRAP_RESTORE_TICK=true
BRAIN_BOOTSTRAP_BINDING_JSON=$(node -e 'console.log(JSON.stringify({
  schema_version:"brain-drain-bootstrap/v1",old_version:"1.445.84",
  old_image_id:process.argv[1],old_git_sha:process.argv[2],
  new_version:"1.445.85",new_image_id:process.argv[3],new_git_sha:process.argv[4],
  approval_decision_id:"11111111-1111-4111-8111-111111111111",
  expires_at:new Date(Date.now()+600000).toISOString()}))' "$old_image" "$old_sha" "$new_image" "$new_sha")
PRIMARY_IMAGE="$new_image"
FALLBACK_IMAGE="$old_image"
FALLBACK_SHA="$old_sha"
EXPECTED_SHA="$new_sha"
TARGET_IMAGE="$new_image"
TARGET_SHA="$new_sha"
BRAIN_VERSION=1.445.85
TARGET_CONTAINER=immutable-target-id
enabled=false
calls=$(mktemp)
trap 'rm -f "$calls"' EXIT
_sidecar_same_target() { return 0; }
bootstrap_sidecar_audit() { printf 'audit,' >> "$calls"; return 0; }
_sidecar_docker() {
  case "$*" in
    *'/api/brain/tick/enable'*) printf 'enable,' >> "$calls"; if [[ "${MOCK_ENABLE_FAIL:-false}" == true ]]; then printf '{"success":false,"enabled":false}'; else printf '{"success":true,"enabled":true,"loop_running":true}'; fi ;;
    *'/api/brain/tick/status'*) printf 'status,' >> "$calls"; if [[ "${MOCK_ENABLE_FAIL:-false}" == true ]]; then printf '{"enabled":false,"loop_running":false,"draining":false}'; else printf '{"enabled":true,"loop_running":true,"draining":false}'; fi ;;
    *) return 1 ;;
  esac
}

bootstrap_sidecar_restore_tick success
[[ "$(cat "$calls")" == 'audit,enable,status,' ]] || { echo "FAIL: sidecar restore calls=$(cat "$calls")" >&2; exit 1; }
enabled=false
TARGET_SHA="$old_sha"
TARGET_IMAGE="$old_image"
bootstrap_sidecar_restore_tick recovered
sleep() { :; }
MOCK_ENABLE_FAIL=true
TARGET_SHA="$new_sha"
TARGET_IMAGE="$new_image"
if bootstrap_sidecar_restore_tick success >/dev/null 2>&1; then
  echo 'FAIL: sidecar accepted a persistent manual tick disable' >&2; exit 1
fi
grep -q 'cancel_drain_after_up success && bootstrap_sidecar_restore_tick success' "$SCRIPT_DIR/lib/bluegreen-sidecar.sh"
grep -q 'bootstrap_sidecar_restore_tick recovered' "$SCRIPT_DIR/lib/bluegreen-sidecar.sh"
echo 'PASS: detached sidecar restores manual tick disable on new and fallback images'
