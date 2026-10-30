#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SCRIPT_DIR/lib/brain-bootstrap.sh"

old_image="sha256:$(printf 'a%.0s' {1..64})"
new_image="sha256:$(printf 'b%.0s' {1..64})"
old_sha=$(printf 'c%.0s' {1..40})
new_sha=$(printf 'd%.0s' {1..40})
receipt=$(mktemp)
trap 'rm -f "$receipt"' EXIT
chmod 600 "$receipt"
unset BRAIN_BOOTSTRAP_RECEIPT || true
bootstrap_select_receipt "$receipt"
[[ "$BRAIN_BOOTSTRAP_RECEIPT" == "$receipt" ]]
node -e '
  const fs=require("fs");
  fs.writeFileSync(process.argv[1],JSON.stringify({schema_version:"brain-drain-bootstrap/v1",
    old_version:"1.445.84",old_image_id:process.argv[2],old_git_sha:process.argv[3],
    new_version:"1.445.85",new_image_id:process.argv[4],new_git_sha:process.argv[5],
    approval_decision_id:"11111111-1111-4111-8111-111111111111",
    expires_at:new Date(Date.now()+600000).toISOString()}));
' "$receipt" "$old_image" "$old_sha" "$new_image" "$new_sha"
BRAIN_BOOTSTRAP_RECEIPT="$receipt"
curl() {
  case "$*" in
    *'/api/brain/health'*) printf '{"version":"1.445.84","git_sha":"%s"}' "$old_sha" ;;
    *'/tick/status'*) printf '{"enabled":true,"loop_running":true}' ;;
  esac
}
docker() {
  case "$*" in
    *'{{.State.Running}} {{.Image}}'*) printf 'true %s\n' "$old_image" ;;
    *'exec cecelia-node-brain curl'*) printf '{"version":"1.445.84","git_sha":"%s"}' "$old_sha" ;;
    *"image inspect $old_image"*) printf 'GIT_SHA=%s\n' "$old_sha" ;;
    *"image inspect $new_image"*) printf 'GIT_SHA=%s\n' "$new_sha" ;;
    *) return 1 ;;
  esac
}

bootstrap_assert_identity "$old_image" "$new_image" "$new_sha" 1.445.85 >/dev/null
[[ "$BOOTSTRAP_BINDING_JSON" == *'"approval_decision_id":"11111111-1111-4111-8111-111111111111"'* ]]
if bootstrap_assert_identity "$old_image" "$new_image" "$old_sha" 1.445.85 >/dev/null 2>&1; then
  echo 'FAIL: candidate SHA mismatch accepted' >&2; exit 1
fi
echo 'PASS: bootstrap binds container, health and both immutable images'
