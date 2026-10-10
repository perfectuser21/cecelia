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
# 台账卡在上一次部署的 pending（sidecar 收账失败遗留）时，交给 CLI reconcile 用 finish 的完整核验补收账：
# 仅当运行容器已是 pending 目标且健康才清 pending；核验不过/新鲜期/恢复中都不改状态，begin 照旧失败并告警（fail-safe）。
_retention_reconcile_pending() {
  local err="$1" out rerr
  [[ "$err" == *DEPLOYMENT_PENDING* ]] || return 1
  rerr=$(mktemp) || return 1
  if out=$(node "$_RETENTION_REPO_ROOT/scripts/brain-image-retention/cli.mjs" reconcile 2>"$rerr") \
      && [[ "$out" =~ ^[a-f0-9-]{36}\ success$ ]]; then
    rm -f "$rerr"
    echo "[retention] 陈旧 pending 已核验补收账：$out" >&2
    return 0
  fi
  echo "[retention] DEPLOYMENT_PENDING 自动补收账未通过核验：$(tr '\n' ' ' < "$rerr" | head -c 300)" >&2
  rm -f "$rerr"
  if declare -F send_bark >/dev/null; then
    send_bark "台账 DEPLOYMENT_PENDING 且自动补收账核验未通过，部署已中止，请检查 ledger pending" || true
  fi
  return 1
}
retention_begin() {
  local version="$1" sha="$2" id result err errfile attempt
  id=$(node -e "process.stdout.write(require('node:crypto').randomUUID())") || return 1
  errfile=$(mktemp) || return 1
  for attempt in 1 2; do
    if result=$(node "$_RETENTION_REPO_ROOT/scripts/brain-image-retention/cli.mjs" begin "$id" "$version" "$sha" 2>"$errfile"); then
      break
    fi
    err=$(cat "$errfile" 2>/dev/null); printf '%s\n' "$err" >&2
    if [[ "$attempt" == 1 ]] && _retention_reconcile_pending "$err"; then continue; fi
    rm -f "$errfile"; return 1
  done
  rm -f "$errfile"
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
