#!/usr/bin/env bash
# Server-owned guard for every direct production release script.
set -euo pipefail

effect_kind="${1:-production}"
release_run_id="${KERNEL_RELEASE_RUN_ID:-}"
merge_sha="${KERNEL_RELEASE_MERGE_SHA:-}"
release_authorization="${KERNEL_RELEASE_AUTHORIZATION:-}"
brain_url="${BRAIN_URL:-http://localhost:5221}"
deploy_token="${DEPLOY_TOKEN:-}"

deny() {
  echo "ReleaseRun authority required: $1" >&2
  exit 78
}

[[ "$effect_kind" == "production" || "$effect_kind" == "staging" ]] \
  || deny "invalid effect kind"
[[ "$release_run_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] \
  || deny "missing or malformed release_run_id"
[[ "$merge_sha" =~ ^[0-9a-fA-F]{40}$ ]] \
  || deny "missing or malformed merge_sha"
[[ "$release_authorization" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] \
  || deny "missing or malformed release_authorization"
[[ -n "$deploy_token" ]] || deny "DEPLOY_TOKEN unavailable"

response_file=$(mktemp "${TMPDIR:-/tmp}/release-authority.XXXXXX")
trap 'rm -f "$response_file"' EXIT
http_code=$(curl --silent --show-error --output "$response_file" --write-out "%{http_code}" \
  -X POST "${brain_url}/api/brain/release-runs/authorize" \
  -H "Authorization: Bearer ${deploy_token}" \
  -H "Content-Type: application/json" \
  -d "{\"release_run_id\":\"${release_run_id}\",\"merge_sha\":\"${merge_sha}\",\"release_authorization\":\"${release_authorization}\",\"effect_kind\":\"${effect_kind}\"}" \
  --connect-timeout 10 --max-time 20) \
  || deny "authorization service unavailable"

[[ "$http_code" == "200" ]] || deny "server denied release effect (HTTP ${http_code})"
grep -Eq '"authorized"[[:space:]]*:[[:space:]]*true' "$response_file" \
  || deny "server response lacked authorization receipt"
