#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/refresh-fleet-worker-docker-access.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$HELPER" ]] || fail "missing root-owned Docker ACL refresher"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
home_acl_state="$test_root/home-acl"
socket_acl_state="$test_root/socket-acl"
acl_log="$test_root/acl.log"
socket_target='/Users/orbstack-owner/.orbstack/run/docker.sock'

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "$1" == "-u" && $# -eq 1 ]]; then printf "0\\n"; exit 0; fi' \
  'if [[ "$1" == "-u" && "${2:-}" == "_cecelia" ]]; then printf "501\\n"; exit 0; fi' \
  'exit 1' > "$test_root/id"
chmod +x "$test_root/id"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  '[[ "$*" == "/var/run/docker.sock" ]] || exit 90' \
  'printf "%s\\n" "${FLEET_WORKER_SOCKET_TARGET:?}"' > "$test_root/readlink"
chmod +x "$test_root/readlink"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "Socket\\n"' > "$test_root/stat"
chmod +x "$test_root/stat"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'target="${@: -1}"' \
  'if [[ "$target" == "/Users/orbstack-owner" && -e "${FLEET_WORKER_HOME_ACL_STATE:?}" ]]; then' \
  '  printf " 0: user:_cecelia allow search\\n"' \
  'elif [[ "$target" == */docker.sock && -e "${FLEET_WORKER_SOCKET_ACL_STATE:?}" ]]; then' \
  '  printf " 0: user:_cecelia allow read,write\\n"' \
  'fi' > "$test_root/acl-list"
chmod +x "$test_root/acl-list"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >> "${FLEET_WORKER_ACL_LOG:?}"' \
  'if [[ "$1" == "+a" && "$2" == "_cecelia allow read,write" ]]; then' \
  '  : > "${FLEET_WORKER_SOCKET_ACL_STATE:?}"' \
  'fi' > "$test_root/chmod"
chmod +x "$test_root/chmod"

run_helper() {
  FLEET_WORKER_ID="$test_root/id" \
  FLEET_WORKER_READLINK="$test_root/readlink" \
  FLEET_WORKER_STAT="$test_root/stat" \
  FLEET_WORKER_ACL_LIST="$test_root/acl-list" \
  FLEET_WORKER_CHMOD="$test_root/chmod" \
  FLEET_WORKER_SOCKET_TARGET="$socket_target" \
  FLEET_WORKER_HOME_ACL_STATE="$home_acl_state" \
  FLEET_WORKER_SOCKET_ACL_STATE="$socket_acl_state" \
  FLEET_WORKER_ACL_LOG="$acl_log" \
    "$HELPER" "$@"
}

: > "$home_acl_state"
: > "$acl_log"
run_helper || fail "refresher rejected the exact Docker socket"
[[ -e "$socket_acl_state" ]] || fail "refresher did not add exact-socket ACL"
grep -Fxq '+a _cecelia allow read,write /Users/orbstack-owner/.orbstack/run/docker.sock' \
  "$acl_log" || fail "refresher granted anything other than exact socket read,write"
[[ "$(wc -l < "$acl_log" | tr -d ' ')" -eq 1 ]] \
  || fail "first refresh performed extra ACL mutations"

run_helper || fail "idempotent refresh failed"
[[ "$(wc -l < "$acl_log" | tr -d ' ')" -eq 1 ]] \
  || fail "idempotent refresh duplicated the socket ACL"

rm -f "$socket_acl_state"
run_helper || fail "socket recreation refresh failed"
[[ "$(wc -l < "$acl_log" | tr -d ' ')" -eq 2 ]] \
  || fail "socket recreation did not restore exactly one ACL"

if run_helper unexpected-argument >/dev/null 2>&1; then
  fail "refresher accepted an arbitrary target argument"
fi

rm -f "$home_acl_state" "$socket_acl_state"
: > "$acl_log"
if run_helper >/dev/null 2>&1; then
  fail "refresher ran without owner-home search ACL"
fi
[[ ! -s "$acl_log" ]] || fail "missing home ACL caused a socket mutation"

: > "$home_acl_state"
if socket_target='/tmp/docker.sock' run_helper >/dev/null 2>&1; then
  fail "refresher accepted a non-OrbStack socket target"
fi
[[ ! -s "$acl_log" ]] || fail "invalid target caused a socket mutation"

for sensitive in vmcontrol.sock sconssh.sock; do
  grep -Fq "$sensitive" "$acl_log" \
    && fail "refresher touched sensitive sibling socket $sensitive"
done

echo "PASS: Fleet Worker exact Docker socket ACL refresher contract"
