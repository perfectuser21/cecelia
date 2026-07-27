#!/usr/bin/env bash
set -euo pipefail

ID_COMMAND="${FLEET_WORKER_ID:-/usr/bin/id}"
READLINK="${FLEET_WORKER_READLINK:-/usr/bin/readlink}"
STAT="${FLEET_WORKER_STAT:-/usr/bin/stat}"
ACL_LIST="${FLEET_WORKER_ACL_LIST:-/bin/ls}"
CHMOD="${FLEET_WORKER_CHMOD:-/bin/chmod}"
DOCKER_SOCKET_LINK='/var/run/docker.sock'

die() {
  echo "$1" >&2
  exit "${2:-1}"
}

has_acl() {
  local target="$1"
  local expression="$2"
  "$ACL_LIST" -lde "$target" 2>/dev/null | /usr/bin/grep -Eq "$expression"
}

[[ $# -eq 0 ]] || die "unexpected_argument" 64
[[ "$("$ID_COMMAND" -u)" == '0' ]] || die "root_required" 77
"$ID_COMMAND" -u _cecelia >/dev/null 2>&1 || die "prerequisite_service_user"

socket_target="$("$READLINK" "$DOCKER_SOCKET_LINK" 2>/dev/null)" \
  || die "prerequisite_docker_socket"
case "$socket_target" in
  /Users/*/.orbstack/run/docker.sock) ;;
  *) die "prerequisite_docker_socket_target" ;;
esac

owner_home="${socket_target%/.orbstack/run/docker.sock}"
owner_name="${owner_home#/Users/}"
if [[ -z "$owner_name" || "$owner_name" == */* || "$owner_name" == '.' \
  || "$owner_name" == '..' || ! "$owner_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  die "prerequisite_docker_socket_target"
fi

has_acl "$owner_home" '^[[:space:]]*[0-9]+: user:_cecelia allow search$' \
  || die "prerequisite_docker_home_acl"
[[ "$("$STAT" -f '%HT' "$socket_target" 2>/dev/null)" == 'Socket' ]] \
  || die "prerequisite_docker_socket_type"

if has_acl \
  "$socket_target" \
  '^[[:space:]]*[0-9]+: user:_cecelia allow read,write$'; then
  exit 0
fi

"$CHMOD" +a '_cecelia allow read,write' "$socket_target" \
  || die "prerequisite_docker_socket_acl"
has_acl \
  "$socket_target" \
  '^[[:space:]]*[0-9]+: user:_cecelia allow read,write$' \
  || die "prerequisite_docker_socket_acl"
