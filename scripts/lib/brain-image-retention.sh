#!/usr/bin/env bash
# 仅部署进程可用的固定CLI；共享ledger先于任何构建/切换副作用。
_RETENTION_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
retention_compose_args() {
  RETENTION_COMPOSE_ARGS=()
  if [[ -n "${CECELIA_IMAGE_DEPLOYMENT_ID:-}" ]]; then
    RETENTION_COMPOSE_ARGS=(-f "$_RETENTION_REPO_ROOT/docker-compose.image-retention.yml")
  fi
}
retention_compose_args
retention_begin() {
  local version="$1" sha="$2" id result
  id=$(node -e "process.stdout.write(require('node:crypto').randomUUID())") || return 1
  result=$(node "$_RETENTION_REPO_ROOT/scripts/brain-image-retention/cli.mjs" begin "$id" "$version" "$sha") || return 1
  if [[ "$result" == disabled ]]; then
    unset CECELIA_IMAGE_DEPLOYMENT_ID
    retention_compose_args
    return 0
  fi
  [[ "$result" == "$id" ]] || return 1
  export CECELIA_IMAGE_DEPLOYMENT_ID="$id"
  export CECELIA_IMAGE_RETENTION_DIR="${CECELIA_IMAGE_RETENTION_DIR:-/mnt/openclaw_data/cecelia-janitor}"
  retention_compose_args
}
retention_finish() {
  [[ -n "${CECELIA_IMAGE_DEPLOYMENT_ID:-}" ]] || return 0
  node "$_RETENTION_REPO_ROOT/scripts/brain-image-retention/cli.mjs" finish "$CECELIA_IMAGE_DEPLOYMENT_ID" "$1" >/dev/null
}

retention_rollback() {
  local version="$1" sha="$2" image="$3" id result outcome actual extra
  id=$(node -e "process.stdout.write(require('node:crypto').randomUUID())") || return 1
  result=$(node "$_RETENTION_REPO_ROOT/scripts/brain-image-retention/cli.mjs" rollback "$id" "$version" "$sha" "$image") || return 1
  export CECELIA_ROLLBACK_IMAGE="$image"
  export CECELIA_ROLLBACK_OUTCOME=success
  if [[ "$result" == disabled ]]; then unset CECELIA_IMAGE_DEPLOYMENT_ID; retention_compose_args; return 0; fi
  read -r id outcome actual extra <<< "$result"
  [[ "$id" =~ ^[a-f0-9-]{36}$ && "$outcome" =~ ^(success|recovered)$ && "$actual" == "$image" && -z "$extra" ]] || return 1
  export CECELIA_IMAGE_DEPLOYMENT_ID="$id" CECELIA_ROLLBACK_OUTCOME="$outcome"
  export CECELIA_IMAGE_RETENTION_DIR="${CECELIA_IMAGE_RETENTION_DIR:-/mnt/openclaw_data/cecelia-janitor}"
  retention_compose_args
}
