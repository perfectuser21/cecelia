#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install-fleet-worker.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$INSTALLER" ]] || fail "missing install-fleet-worker.sh entrypoint"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
install_dir="$test_root/Library/LaunchDaemons"
log_dir="$test_root/var/log/cecelia"
launch_log="$test_root/launchctl.log"
launch_state="$test_root/launchctl.state"
launch_fail_once="$test_root/launchctl.fail-once"
acl_log="$test_root/acl.log"
acl_state="$test_root/acl.state"
orbstack_acl_state="$test_root/orbstack-acl.state"
run_acl_state="$test_root/run-acl.state"
socket_acl_state="$test_root/socket-acl.state"
preflight_log="$test_root/preflight.log"
startup_probe_log="$test_root/startup-probe.log"
chown_log="$test_root/chown.log"
worker_token_file="$test_root/worker-token"
worker_data_root="$test_root/var/lib/cecelia/fleet-worker"
shared_tmpdir="$test_root/Users/Shared/cecelia-fleet-tmp"
mkdir -p "$install_dir" "$log_dir"
printf '%s\n' 'fleet-worker-token-at-least-32-bytes' > "$worker_token_file"
chmod 0600 "$worker_token_file"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >> "${FLEET_WORKER_CHOWN_LOG:?}"' > "$test_root/chown"
chmod +x "$test_root/chown"

run_installer() {
  env -u FLEET_WORKER_ID \
    FLEET_WORKER_INSTALL_DIR="$install_dir" \
    FLEET_WORKER_LOG_DIR="$log_dir" \
    FLEET_WORKER_LAUNCHCTL="$test_root/launchctl" \
    FLEET_WORKER_PLUTIL="$test_root/plutil" \
    FLEET_WORKER_NODE_PROBE="$test_root/node-probe" \
    FLEET_WORKER_READLINK="$test_root/readlink" \
    FLEET_WORKER_ACL_LIST="$test_root/acl-list" \
    FLEET_WORKER_CHMOD="$test_root/chmod" \
    FLEET_WORKER_CHOWN="$test_root/chown" \
    FLEET_WORKER_CHOWN_LOG="$chown_log" \
    FLEET_WORKER_STAT="$test_root/stat" \
    FLEET_WORKER_ORBSTACK_ACL_STATE="$orbstack_acl_state" \
    FLEET_WORKER_RUN_ACL_STATE="$run_acl_state" \
    FLEET_WORKER_SOCKET_ACL_STATE="$socket_acl_state" \
    FLEET_WORKER_STARTUP_PROBE="$test_root/startup-probe" \
    FLEET_WORKER_STARTUP_ATTEMPTS=1 \
    FLEET_WORKER_SLEEP="$test_root/sleep" \
    FLEET_WORKER_ORBSTACK_HOME="/Users/orbstack-owner" \
    FLEET_WORKER_TOKEN_FILE="$worker_token_file" \
    FLEET_WORKER_DATA_ROOT="${FLEET_WORKER_TEST_DATA_ROOT:-$worker_data_root}" \
    FLEET_WORKER_SHARED_TMPDIR="$shared_tmpdir" \
    "$INSTALLER" "$@"
}

run_installer_with_id() {
  local id_path="$1"
  shift
  FLEET_WORKER_ID="$id_path" \
    FLEET_WORKER_INSTALL_DIR="$install_dir" \
    FLEET_WORKER_LOG_DIR="${FLEET_WORKER_TEST_LOG_DIR:-$log_dir}" \
    FLEET_WORKER_LAUNCHCTL="$test_root/launchctl" \
    FLEET_WORKER_PLUTIL="$test_root/plutil" \
    FLEET_WORKER_NODE_PROBE="$test_root/node-probe" \
    FLEET_WORKER_READLINK="$test_root/readlink" \
    FLEET_WORKER_ACL_LIST="$test_root/acl-list" \
    FLEET_WORKER_CHMOD="$test_root/chmod" \
    FLEET_WORKER_CHOWN="$test_root/chown" \
    FLEET_WORKER_CHOWN_LOG="$chown_log" \
    FLEET_WORKER_STAT="$test_root/stat" \
    FLEET_WORKER_ORBSTACK_ACL_STATE="$orbstack_acl_state" \
    FLEET_WORKER_RUN_ACL_STATE="$run_acl_state" \
    FLEET_WORKER_SOCKET_ACL_STATE="$socket_acl_state" \
    FLEET_WORKER_STARTUP_PROBE="$test_root/startup-probe" \
    FLEET_WORKER_STARTUP_ATTEMPTS=1 \
    FLEET_WORKER_SLEEP="$test_root/sleep" \
    FLEET_WORKER_ORBSTACK_HOME="/Users/orbstack-owner" \
    FLEET_WORKER_TOKEN_FILE="$worker_token_file" \
    FLEET_WORKER_DATA_ROOT="${FLEET_WORKER_TEST_DATA_ROOT:-$worker_data_root}" \
    FLEET_WORKER_SHARED_TMPDIR="$shared_tmpdir" \
    "$INSTALLER" "$@"
}

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >> "${FLEET_WORKER_LAUNCH_LOG:?}"' \
  'exit 0' > "$test_root/launchctl"
chmod +x "$test_root/launchctl"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  '[[ "$1" == "-lint" && $# -eq 2 && -f "$2" ]] || exit 64' \
  'exec python3 - "$2" <<PY' \
  'import plistlib' \
  'import sys' \
  'with open(sys.argv[1], "rb") as handle:' \
  '    plistlib.load(handle)' \
  'PY' > "$test_root/plutil"
chmod +x "$test_root/plutil"

export FLEET_WORKER_LAUNCH_LOG="$launch_log"
export FLEET_WORKER_LAUNCH_STATE="$launch_state"
export FLEET_WORKER_ACL_LOG="$acl_log"
export FLEET_WORKER_ACL_STATE="$acl_state"
export FLEET_WORKER_PREFLIGHT_LOG="$preflight_log"
export FLEET_WORKER_SOCKET_TARGET='/Users/orbstack-owner/.orbstack/run/docker.sock'

printf '%s\n' \
  '#!/usr/bin/env bash' \
  '[[ "$*" == "/var/run/docker.sock" ]] || exit 90' \
  'printf "%s\\n" "${FLEET_WORKER_SOCKET_TARGET:?}"' \
  > "$test_root/readlink"
chmod +x "$test_root/readlink"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'target="${@: -1}"' \
  'if [[ "$target" == "/Users/orbstack-owner" && -e "${FLEET_WORKER_ACL_STATE:?}" ]]; then' \
  '  printf "%s\\n" " 0: user:_cecelia allow search"' \
  'elif [[ "$target" == "/Users/orbstack-owner/.orbstack" && -e "${FLEET_WORKER_ORBSTACK_ACL_STATE:?}" ]]; then' \
  '  printf "%s\\n" " 0: user:_cecelia allow search"' \
  'elif [[ "$target" == "/Users/orbstack-owner/.orbstack/run" && -e "${FLEET_WORKER_RUN_ACL_STATE:?}" ]]; then' \
  '  printf "%s\\n" " 0: user:_cecelia allow search"' \
  'elif [[ "$target" == */docker.sock && -e "${FLEET_WORKER_SOCKET_ACL_STATE:?}" ]]; then' \
  '  printf "%s\\n" " 0: user:_cecelia allow read,write"' \
  'fi' \
  > "$test_root/acl-list"
chmod +x "$test_root/acl-list"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "acl $*" >> "${FLEET_WORKER_ACL_LOG:?}"' \
  'printf "%s\\n" "acl $1" >> "${FLEET_WORKER_PREFLIGHT_LOG:?}"' \
  'if [[ "$1" == "+a" && "$2" == "_cecelia allow search" ]]; then' \
  '  case "${@: -1}" in' \
  '    /Users/orbstack-owner) state="${FLEET_WORKER_ACL_STATE:?}" ;;' \
  '    /Users/orbstack-owner/.orbstack) state="${FLEET_WORKER_ORBSTACK_ACL_STATE:?}" ;;' \
  '    /Users/orbstack-owner/.orbstack/run) state="${FLEET_WORKER_RUN_ACL_STATE:?}" ;;' \
  '    *) exit 95 ;;' \
  '  esac' \
  '  : > "$state"' \
  '  [[ "${FLEET_WORKER_ACL_FAIL_ADD:-0}" != "1" ]] || exit 91' \
  'elif [[ "$1" == "-a" && "$2" == "_cecelia allow search" ]]; then' \
  '  case "${@: -1}" in' \
  '    /Users/orbstack-owner) state="${FLEET_WORKER_ACL_STATE:?}" ;;' \
  '    /Users/orbstack-owner/.orbstack) state="${FLEET_WORKER_ORBSTACK_ACL_STATE:?}" ;;' \
  '    /Users/orbstack-owner/.orbstack/run) state="${FLEET_WORKER_RUN_ACL_STATE:?}" ;;' \
  '    *) exit 95 ;;' \
  '  esac' \
  '  [[ "${FLEET_WORKER_ACL_FAIL_REMOVE:-0}" != "1" ]] || exit 92' \
  '  rm -f "$state"' \
  'elif [[ "$1" == "+a" && "$2" == "_cecelia allow read,write" ]]; then' \
  '  : > "${FLEET_WORKER_SOCKET_ACL_STATE:?}"' \
  '  [[ "${FLEET_WORKER_SOCKET_ACL_FAIL_ADD:-0}" != "1" ]] || exit 93' \
  'elif [[ "$1" == "-a" && "$2" == "_cecelia allow read,write" ]]; then' \
  '  [[ "${FLEET_WORKER_SOCKET_ACL_FAIL_REMOVE:-0}" != "1" ]] || exit 94' \
  '  rm -f "${FLEET_WORKER_SOCKET_ACL_STATE:?}"' \
  'fi' \
  > "$test_root/chmod"
chmod +x "$test_root/chmod"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  '[[ "${FLEET_WORKER_STAT_FAIL:-0}" != "1" ]] || exit 96' \
  'printf "%s\\n" "Socket"' > "$test_root/stat"
chmod +x "$test_root/stat"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'target="${@: -1}"' \
  'if [[ -n "${FLEET_WORKER_MV_FAIL_TARGET:-}"' \
  '  && "$target" == "${FLEET_WORKER_MV_FAIL_TARGET}"' \
  '  && ! -e "${FLEET_WORKER_MV_FAIL_ONCE:?}" ]]; then' \
  '  : > "${FLEET_WORKER_MV_FAIL_ONCE:?}"' \
  '  exit 95' \
  'fi' \
  'exec /bin/mv "$@"' > "$test_root/mv"
chmod +x "$test_root/mv"
export FLEET_WORKER_MV_FAIL_ONCE="$test_root/mv.fail-once"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "probe" >> "${FLEET_WORKER_PREFLIGHT_LOG:?}"' \
  'printf "%s\\n" "{\"ok\":true}"' \
  'exit 0' > "$test_root/node-probe"
chmod +x "$test_root/node-probe"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s|%s\\n" "$1" "$2" >> "${FLEET_WORKER_STARTUP_PROBE_LOG:?}"' \
  '[[ "${FLEET_WORKER_STARTUP_PROBE_FAIL:-0}" != "1" ]]' \
  > "$test_root/startup-probe"
chmod +x "$test_root/startup-probe"
export FLEET_WORKER_STARTUP_PROBE_LOG="$startup_probe_log"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'exit 0' > "$test_root/sleep"
chmod +x "$test_root/sleep"

for machine in us-mac-m4 xian-mac-m4 xian-mac-m1; do
  output="$(run_installer "$machine")" || fail "dry-run rejected canonical ID $machine"
  grep -qi 'dry.run' <<<"$output" || fail "default was not dry-run for $machine"
done
[[ -z "$(find "$install_dir" -type f -print -quit)" ]] \
  || fail "dry-run mutated the LaunchDaemons directory"

if run_installer moon-base >/dev/null 2>&1; then
  fail "unknown machine ID was accepted"
fi

[[ "$(id -u)" -ne 0 ]] \
  || fail "root-gate test requires the actual current user to be nonroot"
root_output=''
if root_output="$(run_installer us-mac-m4 --apply 2>&1)"; then
  fail "--apply did not require root"
fi
grep -Fq 'root_required' <<<"$root_output" \
  || fail "non-root refusal lacked bounded root_required signature"
[[ -z "$(find "$install_dir" -type f -print -quit)" ]] \
  || fail "non-root --apply wrote a plist"

toolchain_bin="$test_root/usr/local/libexec/cecelia/toolchain/bin"
default_probe_path_log="$test_root/default-probe.path"
mkdir -p "$toolchain_bin"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$toolchain_bin/orbctl"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$toolchain_bin/docker"
chmod +x "$toolchain_bin/orbctl" "$toolchain_bin/docker"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "${1:-}" == "-" ]]; then' \
  '  cat >/dev/null' \
  '  printf "%s\n" "$PATH" > "${FLEET_WORKER_TEST_DEFAULT_PROBE_PATH:?}"' \
  '  [[ "${CECELIA_ORBSTACK_HOME:-}" == "/Users/orbstack-owner" ]] || { echo prerequisite_orbstack_home >&2; exit 1; }' \
  '  [[ "$(command -v orbctl || true)" == "${FLEET_WORKER_TEST_TOOLCHAIN_BIN:?}/orbctl" ]] || { echo prerequisite_orbstack >&2; exit 1; }' \
  '  [[ "$(command -v docker || true)" == "${FLEET_WORKER_TEST_TOOLCHAIN_BIN:?}/docker" ]] || { echo prerequisite_docker >&2; exit 1; }' \
  '  exit 0' \
  'fi' \
  'source="$(cat)"' \
  'case "$source" in' \
  '  *runner_image_digest*) printf "%s" "sha256:1ec3542ab56a58c620196a4f32fd04b12e8049ec29dbc121e33b51a0cabc4288" ;;' \
  '  *worker_bind_host*) printf "%s" "100.86.57.69" ;;' \
  '  *brain_health_url*) printf "%s" "http://100.71.151.105:5221/api/brain/health" ;;' \
  '  *) exit 1 ;;' \
  'esac' > "$test_root/default-probe-node"
chmod +x "$test_root/default-probe-node"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "$1" == "-u" && $# -eq 1 ]]; then echo 501; exit 0; fi' \
  'if [[ "$1" == "-u" && "${2:-}" == "_cecelia" ]]; then echo 450; exit 0; fi' \
  'if [[ "$1" == "-g" && "${2:-}" == "_cecelia" ]]; then echo 450; exit 0; fi' \
  'exit 1' > "$test_root/id-default-probe"
chmod +x "$test_root/id-default-probe"
default_probe_plist="$test_root/default-probe.plist"
FLEET_WORKER_TEST_DEFAULT_PROBE_PATH="$default_probe_path_log" \
FLEET_WORKER_TEST_TOOLCHAIN_BIN="$toolchain_bin" \
FLEET_WORKER_INSTALL_DIR="$install_dir" \
FLEET_WORKER_LOG_DIR="$log_dir" \
FLEET_WORKER_NODE_EXECUTABLE="$test_root/default-probe-node" \
FLEET_WORKER_ID="$test_root/id-default-probe" \
FLEET_WORKER_PLUTIL="$test_root/plutil" \
FLEET_WORKER_TOKEN_FILE="$worker_token_file" \
FLEET_WORKER_DATA_ROOT="$worker_data_root" \
FLEET_WORKER_ORBSTACK_HOME="/Users/orbstack-owner" \
  env -u FLEET_WORKER_NODE_PROBE \
  "$INSTALLER" xian-mac-m4 --render-to "$default_probe_plist" >/dev/null \
  || fail "default preflight could not resolve reconciled OrbStack commands"
[[ "$(<"$default_probe_path_log")" == "$toolchain_bin:"* ]] \
  || fail "default preflight PATH did not begin with the reconciled toolchain"

transient_preflight_count="$test_root/transient-preflight.count"
printf '0\n' > "$transient_preflight_count"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'count="$(<"${FLEET_WORKER_TRANSIENT_PREFLIGHT_COUNT:?}")"' \
  'count=$((count + 1))' \
  'printf "%s\n" "$count" > "${FLEET_WORKER_TRANSIENT_PREFLIGHT_COUNT:?}"' \
  'if [[ "$count" -eq 1 ]]; then' \
  '  printf "%s\n" "prerequisite_orbstack" >&2' \
  '  exit 1' \
  'fi' \
  'printf "%s\n" "{\"ok\":true}"' \
  > "$test_root/node-probe"
chmod +x "$test_root/node-probe"
transient_plist="$test_root/transient-preflight.plist"
FLEET_WORKER_TRANSIENT_PREFLIGHT_COUNT="$transient_preflight_count" \
FLEET_WORKER_PREFLIGHT_ATTEMPTS=2 \
FLEET_WORKER_PREFLIGHT_RETRY_SECONDS=0 \
  run_installer xian-mac-m4 --render-to "$transient_plist" >/dev/null \
  || fail "installer did not retry a transient OrbStack startup preflight"
[[ "$(<"$transient_preflight_count")" == '2' ]] \
  || fail "transient OrbStack preflight was not retried exactly once"
[[ -f "$transient_plist" ]] \
  || fail "transient OrbStack preflight did not complete rendering"

non_retryable_preflight_count="$test_root/non-retryable-preflight.count"
printf '0\n' > "$non_retryable_preflight_count"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'count="$(<"${FLEET_WORKER_NON_RETRYABLE_PREFLIGHT_COUNT:?}")"' \
  'count=$((count + 1))' \
  'printf "%s\n" "$count" > "${FLEET_WORKER_NON_RETRYABLE_PREFLIGHT_COUNT:?}"' \
  'printf "%s\n" "prerequisite_docker_socket" >&2' \
  'exit 1' \
  > "$test_root/node-probe"
chmod +x "$test_root/node-probe"
non_retryable_output=''
if non_retryable_output="$(
  FLEET_WORKER_NON_RETRYABLE_PREFLIGHT_COUNT="$non_retryable_preflight_count" \
  FLEET_WORKER_PREFLIGHT_ATTEMPTS=2 \
    run_installer xian-mac-m4 \
      --render-to "$test_root/non-retryable-preflight.plist" 2>&1
)"; then
  fail "installer retried a deterministic Docker socket prerequisite"
fi
[[ "$(<"$non_retryable_preflight_count")" == '1' ]] \
  || fail "deterministic Docker socket prerequisite was not rejected immediately"
grep -Fq 'prerequisite_docker_socket' <<<"$non_retryable_output" \
  || fail "deterministic preflight lost its bounded refusal signature"

unbounded_interval_output=''
if unbounded_interval_output="$(
  FLEET_WORKER_PREFLIGHT_RETRY_SECONDS=999999999 \
    run_installer xian-mac-m4 \
      --render-to "$test_root/unbounded-retry-interval.plist" 2>&1
)"; then
  fail "installer accepted an unbounded preflight retry interval"
fi
grep -Fq 'preflight_retry_config_invalid' <<<"$unbounded_interval_output" \
  || fail "unbounded retry interval lacked a bounded refusal signature"

docker_preflight_count="$test_root/docker-preflight.count"
printf '0\n' > "$docker_preflight_count"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'count="$(<"${FLEET_WORKER_DOCKER_PREFLIGHT_COUNT:?}")"' \
  'count=$((count + 1))' \
  'printf "%s\n" "$count" > "${FLEET_WORKER_DOCKER_PREFLIGHT_COUNT:?}"' \
  'if [[ "$count" -eq 1 ]]; then' \
  '  printf "%s\n" "prerequisite_docker" >&2' \
  '  exit 1' \
  'fi' \
  'printf "%s\n" "{\"ok\":true}"' \
  > "$test_root/node-probe"
chmod +x "$test_root/node-probe"
docker_preflight_output=''
if docker_preflight_output="$(
  FLEET_WORKER_DOCKER_PREFLIGHT_COUNT="$docker_preflight_count" \
  FLEET_WORKER_PREFLIGHT_ATTEMPTS=2 \
  FLEET_WORKER_PREFLIGHT_RETRY_SECONDS=0 \
    run_installer xian-mac-m4 \
      --render-to "$test_root/docker-preflight.plist" 2>&1
)"; then
  fail "installer retried an aggregated Docker prerequisite"
fi
[[ "$(<"$docker_preflight_count")" == '1' ]] \
  || fail "aggregated Docker prerequisite was not rejected immediately"
grep -Fq 'prerequisite_docker' <<<"$docker_preflight_output" \
  || fail "aggregated Docker prerequisite lost its refusal signature"

invalid_retry_output=''
if invalid_retry_output="$(
  FLEET_WORKER_PREFLIGHT_ATTEMPTS=0 \
    run_installer xian-mac-m4 \
      --render-to "$test_root/invalid-retry-config.plist" 2>&1
)"; then
  fail "installer accepted an unbounded preflight retry configuration"
fi
grep -Fq 'preflight_retry_config_invalid' <<<"$invalid_retry_output" \
  || fail "invalid preflight retry config lacked a bounded refusal signature"

leading_zero_retry_output=''
if leading_zero_retry_output="$(
  FLEET_WORKER_PREFLIGHT_ATTEMPTS=08 \
    run_installer xian-mac-m4 \
      --render-to "$test_root/leading-zero-retry-config.plist" 2>&1
)"; then
  fail "installer accepted a leading-zero preflight retry count"
fi
grep -Fq 'preflight_retry_config_invalid' <<<"$leading_zero_retry_output" \
  || fail "leading-zero retry count lacked a bounded refusal signature"

overflow_retry_output=''
if overflow_retry_output="$(
  FLEET_WORKER_PREFLIGHT_ATTEMPTS=18446744073709551617 \
    run_installer xian-mac-m4 \
      --render-to "$test_root/overflow-retry-config.plist" 2>&1
)"; then
  fail "installer accepted an overflowing preflight retry count"
fi
grep -Fq 'preflight_retry_config_invalid' <<<"$overflow_retry_output" \
  || fail "overflowing retry count lacked a bounded refusal signature"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >> "${FLEET_WORKER_LAUNCH_LOG:?}"' \
  'exit 99' > "$test_root/launchctl"
chmod +x "$test_root/launchctl"

for prerequisite in orbstack docker runner_digest disk memory service_user; do
  candidate="$test_root/${prerequisite}.plist"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    "printf '%s\\n' 'prerequisite_${prerequisite}' >&2" \
    'exit 1' > "$test_root/node-probe"
  chmod +x "$test_root/node-probe"
  prerequisite_output=''
  if prerequisite_output="$(run_installer xian-mac-m4 --render-to "$candidate" 2>&1)"; then
    fail "installer ignored failed prerequisite: $prerequisite"
  fi
  grep -Fq "prerequisite_${prerequisite}" <<<"$prerequisite_output" \
    || fail "failed prerequisite $prerequisite lacked a bounded refusal signature"
  [[ ! -e "$candidate" ]] || fail "failed prerequisite $prerequisite rendered a plist"
done

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "probe" >> "${FLEET_WORKER_PREFLIGHT_LOG:?}"' \
  'printf "%s\\n" "{\"ok\":true}"' \
  'exit 0' > "$test_root/node-probe"
chmod +x "$test_root/node-probe"

plist="$test_root/rendered-fleet-worker.plist"
: > "$launch_log"
run_installer xian-mac-m4 --render-to "$plist" >/dev/null
[[ -f "$plist" ]] || fail "--render-to did not stage a LaunchDaemon plist"
[[ ! -s "$launch_log" ]] || fail "--render-to called launchctl or applied service state"
plist_contract="$(python3 - "$plist" <<'PY'
import plistlib
import sys

with open(sys.argv[1], 'rb') as handle:
    plist = plistlib.load(handle)

run_at_load = plist.get('RunAtLoad')
keep_alive = plist.get('KeepAlive')
user_name = plist.get('UserName')
tool_path = plist.get('EnvironmentVariables', {}).get('PATH')
worker_host = plist.get('EnvironmentVariables', {}).get('CECELIA_FLEET_WORKER_HOST')
docker_host = plist.get('EnvironmentVariables', {}).get('DOCKER_HOST')
callback_url = plist.get('EnvironmentVariables', {}).get('CECELIA_CALLBACK_URL')
orbstack_home = plist.get('EnvironmentVariables', {}).get('CECELIA_ORBSTACK_HOME')
service_home = plist.get('EnvironmentVariables', {}).get('HOME')
print(
    ('true' if run_at_load is True else repr(run_at_load))
    + '|'
    + ('true' if keep_alive is True else repr(keep_alive))
    + '|'
    + str(user_name)
    + '|'
    + str(tool_path)
    + '|'
    + str(worker_host)
    + '|'
    + str(docker_host)
    + '|'
    + str(callback_url)
    + '|'
    + str(orbstack_home)
    + '|'
    + str(service_home)
)
PY
)" || fail "rendered file is not a valid plist"
[[ "$plist_contract" == 'true|true|_cecelia|/usr/local/libexec/cecelia/toolchain/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin|100.86.57.69|unix:///var/run/docker.sock|http://100.71.151.105:5221/api/brain/health|/Users/orbstack-owner|None' ]] \
  || fail "plist contract drifted: $plist_contract"
validated_plist="$test_root/validated-fleet-worker.plist"
cp "$plist" "$validated_plist"
plist_body="$(<"$plist")"

for required in \
  '<key>UserName</key>' \
  '<key>CECELIA_MACHINE_ID</key>' \
  '<string>xian-mac-m4</string>' \
  '<key>CECELIA_RUNNER_DIGEST</key>' \
  '<key>CECELIA_FLEET_WORKER_TOKEN_FILE</key>' \
  "<string>$worker_token_file</string>" \
  '<key>CECELIA_FLEET_DATA_ROOT</key>' \
  "<string>$worker_data_root</string>"; do
  grep -Fq "$required" <<<"$plist_body" || fail "plist missing $required"
done
grep -Eq '<string>sha256:[a-f0-9]{64}</string>' <<<"$plist_body" \
  || fail "plist does not pin the Runner digest"
grep -Fq "$log_dir/fleet-worker.stdout.log" <<<"$plist_body" \
  || fail "stdout log path is not bounded"
grep -Fq "$log_dir/fleet-worker.stderr.log" <<<"$plist_body" \
  || fail "stderr log path is not bounded"
grep -Eqi 'CODEX_ACCOUNT_ALLOWLIST|account|authorization|auth|prompt|credential' <<<"$plist_body" \
  && fail "plist contains local account or credential authority"
grep -Fq 'fleet-worker-token-at-least-32-bytes' <<<"$plist_body" \
  && fail "plist contains the Worker bearer secret instead of its protected file path"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "$1" == "-u" ]]; then printf "%s\\n" 0; else exec /usr/bin/id "$@"; fi' \
  > "$test_root/id-root"
chmod +x "$test_root/id-root"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "$1" == "-u" && $# -eq 1 ]]; then printf "%s\\n" 0; exit 0; fi' \
  'if [[ "$1" == "-u" && "${2:-}" == "_cecelia" ]]; then exit 1; fi' \
  'exec /usr/bin/id "$@"' \
  > "$test_root/id-no-service"
chmod +x "$test_root/id-no-service"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'command_line="$*"' \
  'if [[ "$1" == "print" ]]; then' \
  '  state="$(<"${FLEET_WORKER_LAUNCH_STATE:?}")"' \
  '  case "$state" in' \
  '    loaded|running) printf "state = %s\\n" "$state"; exit 0 ;;' \
  '    *) exit 113 ;;' \
  '  esac' \
  'fi' \
  'printf "%s\\n" "$command_line" >> "${FLEET_WORKER_LAUNCH_LOG:?}"' \
  'if [[ -n "${FLEET_WORKER_LAUNCH_FAIL_MATCH:-}"' \
  '  && "$command_line" == *"${FLEET_WORKER_LAUNCH_FAIL_MATCH}"*' \
  '  && ! -e "${FLEET_WORKER_LAUNCH_FAIL_ONCE:?}" ]]; then' \
  '  : > "${FLEET_WORKER_LAUNCH_FAIL_ONCE:?}"' \
  '  exit 99' \
  'fi' \
  'case "$1" in' \
  '  bootout) printf "stopped\\n" > "${FLEET_WORKER_LAUNCH_STATE:?}" ;;' \
  '  bootstrap) printf "loaded\\n" > "${FLEET_WORKER_LAUNCH_STATE:?}" ;;' \
  '  kickstart) printf "running\\n" > "${FLEET_WORKER_LAUNCH_STATE:?}" ;;' \
  'esac' \
  'exit 0' > "$test_root/launchctl"
chmod +x "$test_root/launchctl"
: > "$launch_log"
printf 'absent\n' > "$launch_state"
export FLEET_WORKER_LAUNCH_FAIL_ONCE="$launch_fail_once"

: > "$acl_log"
: > "$preflight_log"
service_user_output=''
if service_user_output="$(
  run_installer_with_id "$test_root/id-no-service" xian-mac-m4 --apply 2>&1
)"; then
  fail "missing _cecelia service user was accepted"
fi
grep -Fq 'prerequisite_service_user' <<<"$service_user_output" \
  || fail "missing service user lacked a bounded refusal"
[[ ! -s "$acl_log" ]] || fail "missing service user caused an ACL mutation"

: > "$acl_log"
: > "$chown_log"
dangerous_data_root_output=''
if dangerous_data_root_output="$(
  FLEET_WORKER_TEST_DATA_ROOT='/' \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "filesystem root was accepted as the Worker data root"
fi
grep -Fq 'worker_data_root_invalid' <<<"$dangerous_data_root_output" \
  || fail "filesystem root refusal lacked a bounded signature"
[[ ! -s "$acl_log" ]] \
  || fail "invalid data root caused a Docker ACL mutation"
[[ ! -s "$chown_log" ]] \
  || fail "invalid data root caused an ownership mutation"

: > "$acl_log"
: > "$chown_log"
traversal_data_root_output=''
if traversal_data_root_output="$(
  FLEET_WORKER_TEST_DATA_ROOT="$test_root/var/lib/cecelia/../../.." \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "traversal data root was accepted as the Worker data root"
fi
grep -Fq 'worker_data_root_invalid' <<<"$traversal_data_root_output" \
  || fail "traversal data root refusal lacked a bounded signature"
[[ ! -s "$acl_log" ]] \
  || fail "traversal data root caused a Docker ACL mutation"
[[ ! -s "$chown_log" ]] \
  || fail "traversal data root caused an ownership mutation"

: > "$acl_log"
: > "$chown_log"
escaped_worker_root="$test_root/escaped-worker-root"
mkdir -p "$escaped_worker_root" "$test_root/var/lib/cecelia"
ln -s "$escaped_worker_root" "$test_root/var/lib/cecelia/escape"
symlink_data_root_output=''
if symlink_data_root_output="$(
  FLEET_WORKER_TEST_DATA_ROOT="$test_root/var/lib/cecelia/escape/nested/data" \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "symlink-escaped data root was accepted"
fi
grep -Fq 'worker_data_root_invalid' <<<"$symlink_data_root_output" \
  || fail "symlink-escaped data root refusal lacked a bounded signature"
[[ ! -e "$escaped_worker_root/nested" ]] \
  || fail "symlink-escaped data root created an external directory"
[[ ! -s "$acl_log" ]] \
  || fail "symlink-escaped data root caused a Docker ACL mutation"
[[ ! -s "$chown_log" ]] \
  || fail "symlink-escaped data root caused an ownership mutation"

invalid_socket_output=''
if invalid_socket_output="$(
  FLEET_WORKER_SOCKET_TARGET='/tmp/docker.sock' \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "non-OrbStack Docker socket target was accepted"
fi
grep -Fq 'prerequisite_docker_socket_target' <<<"$invalid_socket_output" \
  || fail "invalid Docker socket target lacked a bounded refusal"
[[ ! -s "$acl_log" ]] || fail "invalid Docker socket target caused an ACL mutation"

acl_failure_output=''
if acl_failure_output="$(
  FLEET_WORKER_ACL_FAIL_ADD=1 \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "failed ACL grant was accepted"
fi
grep -Fq 'prerequisite_docker_acl' <<<"$acl_failure_output" \
  || fail "failed ACL grant lacked a bounded refusal"
[[ ! -e "$acl_state" && ! -e "$orbstack_acl_state" \
  && ! -e "$run_acl_state" ]] \
  || fail "failed ACL grant left ACL state behind"
grep -Fq 'acl -a _cecelia allow search /Users/orbstack-owner' "$acl_log" \
  || fail "partial ACL grant was not rolled back"

: > "$acl_log"
: > "$preflight_log"
: > "$acl_state"
rm -f "$orbstack_acl_state" "$run_acl_state" "$socket_acl_state"
socket_acl_failure_output=''
if socket_acl_failure_output="$(
  FLEET_WORKER_SOCKET_ACL_FAIL_ADD=1 \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "failed exact-socket ACL grant was accepted"
fi
grep -Fq 'prerequisite_docker_socket_acl' <<<"$socket_acl_failure_output" \
  || fail "failed exact-socket ACL grant lacked a bounded refusal"
[[ -e "$acl_state" ]] || fail "socket ACL failure removed a pre-existing home ACL"
[[ ! -e "$orbstack_acl_state" && ! -e "$run_acl_state" \
  && ! -e "$socket_acl_state" ]] \
  || fail "failed socket ACL grant left partial state"
grep -Fq \
  'acl -a _cecelia allow read,write /Users/orbstack-owner/.orbstack/run/docker.sock' \
  "$acl_log" || fail "partial socket ACL grant was not rolled back"
rm -f "$acl_state" "$orbstack_acl_state" "$run_acl_state"

: > "$acl_log"
: > "$preflight_log"
rm -f "$acl_state" "$orbstack_acl_state" "$run_acl_state" "$socket_acl_state"
socket_validation_output=''
if socket_validation_output="$(
  FLEET_WORKER_STAT_FAIL=1 \
  FLEET_WORKER_SOCKET_ACL_FAIL_REMOVE=1 \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "non-socket Docker target unexpectedly passed preflight"
fi
grep -Fq 'prerequisite_docker_socket_acl' <<<"$socket_validation_output" \
  || fail "non-socket target lacked a bounded refusal"
grep -Fq 'docker_socket_acl_rollback_incomplete' <<<"$socket_validation_output" \
  && fail "pre-ACL socket validation failure produced a false rollback warning"

: > "$acl_log"
: > "$preflight_log"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "probe" >> "${FLEET_WORKER_PREFLIGHT_LOG:?}"' \
  'printf "%s\\n" "prerequisite_docker" >&2' \
  'exit 1' > "$test_root/node-probe"
chmod +x "$test_root/node-probe"
preflight_failure_output=''
if preflight_failure_output="$(
  run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "failed low-privilege preflight unexpectedly succeeded"
fi
grep -Fq 'prerequisite_docker' <<<"$preflight_failure_output" \
  || fail "failed low-privilege preflight lacked a bounded refusal"
[[ ! -e "$acl_state" && ! -e "$orbstack_acl_state" \
  && ! -e "$run_acl_state" && ! -e "$socket_acl_state" ]] \
  || fail "failed low-privilege preflight leaked a new ACL"
[[ ! -s "$launch_log" ]] || fail "failed low-privilege preflight mutated launchd"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "probe" >> "${FLEET_WORKER_PREFLIGHT_LOG:?}"' \
  'printf "%s\\n" "{\"ok\":true}"' \
  'exit 0' > "$test_root/node-probe"
chmod +x "$test_root/node-probe"

: > "$acl_log"
: > "$preflight_log"
: > "$launch_log"
rm -f "$acl_state" "$orbstack_acl_state" "$run_acl_state" "$socket_acl_state"
malformed_log_dir="$test_root/"$'invalid\001log'
mkdir -p "$malformed_log_dir"
malformed_plist_output=''
if malformed_plist_output="$(
  FLEET_WORKER_TEST_LOG_DIR="$malformed_log_dir" \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "malformed rendered plist unexpectedly passed validation"
fi
grep -Fq 'plist_validation_failed' <<<"$malformed_plist_output" \
  || fail "malformed rendered plist lacked a bounded validation signature"
[[ ! -s "$launch_log" ]] \
  || fail "malformed rendered plist mutated launchd before validation"
[[ ! -e "$acl_state" && ! -e "$orbstack_acl_state" \
  && ! -e "$run_acl_state" && ! -e "$socket_acl_state" ]] \
  || fail "malformed rendered plist leaked a newly-added ACL"

: > "$launch_log"
root_log_target="$test_root/root-log-target"
: > "$root_log_target"
ln -s "$root_log_target" "$log_dir/fleet-worker-docker-access.stdout.log"
root_log_output=''
if root_log_output="$(
  run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "root watcher accepted a symlink stdout path"
fi
grep -Fq 'log_path_invalid' <<<"$root_log_output" \
  || fail "root watcher symlink refusal lacked a bounded signature"
[[ ! -s "$launch_log" ]] || fail "invalid root log path mutated launchd"
rm -f "$log_dir/fleet-worker-docker-access.stdout.log"

: > "$acl_log"
: > "$preflight_log"
rm -f \
  "$acl_state" "$orbstack_acl_state" "$run_acl_state" \
  "$socket_acl_state" "$launch_fail_once"
export FLEET_WORKER_LAUNCH_FAIL_MATCH='bootstrap system'
first_failure_output=''
if first_failure_output="$(
  run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  unset FLEET_WORKER_LAUNCH_FAIL_MATCH
  fail "failed first install unexpectedly succeeded"
fi
unset FLEET_WORKER_LAUNCH_FAIL_MATCH
grep -Fq 'install_failed_rolled_back' <<<"$first_failure_output" \
  || fail "failed first install lacked a bounded rollback signature"
[[ "$(grep -Fc 'acl +a ' "$acl_log")" -eq 4 ]] \
  || fail "failed first install did not add all minimal ACLs"
[[ "$(grep -Ec '^acl -a ' "$acl_log")" -eq 4 ]] \
  || fail "failed first install did not remove all new ACLs"
[[ ! -e "$acl_state" && ! -e "$orbstack_acl_state" \
  && ! -e "$run_acl_state" && ! -e "$socket_acl_state" ]] \
  || fail "failed first install leaked a new ACL"

: > "$acl_log"
: > "$preflight_log"
: > "$launch_log"
rm -f \
  "$acl_state" "$orbstack_acl_state" "$run_acl_state" \
  "$socket_acl_state" "$launch_fail_once"
export FLEET_WORKER_LAUNCH_FAIL_MATCH='bootstrap system'
acl_rollback_failure_output=''
if acl_rollback_failure_output="$(
  FLEET_WORKER_ACL_FAIL_REMOVE=1 \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  unset FLEET_WORKER_LAUNCH_FAIL_MATCH
  fail "ACL rollback failure unexpectedly succeeded"
fi
unset FLEET_WORKER_LAUNCH_FAIL_MATCH
grep -Fq 'docker_acl_rollback_incomplete' <<<"$acl_rollback_failure_output" \
  || fail "ACL rollback failure was silently swallowed"
[[ -e "$acl_state" && -e "$orbstack_acl_state" \
  && -e "$run_acl_state" ]] \
  || fail "ACL rollback failure fixture did not preserve evidence"
rm -f "$acl_state" "$orbstack_acl_state" "$run_acl_state"
rm -f "$socket_acl_state"

: > "$acl_log"
: > "$preflight_log"
: > "$launch_log"
rm -f \
  "$acl_state" "$orbstack_acl_state" "$run_acl_state" \
  "$socket_acl_state" "$launch_fail_once"
export FLEET_WORKER_LAUNCH_FAIL_MATCH='bootstrap system'
socket_acl_rollback_failure_output=''
if socket_acl_rollback_failure_output="$(
  FLEET_WORKER_SOCKET_ACL_FAIL_REMOVE=1 \
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  unset FLEET_WORKER_LAUNCH_FAIL_MATCH
  fail "socket ACL rollback failure unexpectedly succeeded"
fi
unset FLEET_WORKER_LAUNCH_FAIL_MATCH
grep -Fq 'docker_socket_acl_rollback_incomplete' \
  <<<"$socket_acl_rollback_failure_output" \
  || fail "socket ACL rollback failure was silently swallowed"
[[ -e "$socket_acl_state" ]] \
  || fail "socket ACL rollback failure fixture did not preserve evidence"
[[ ! -e "$acl_state" && ! -e "$orbstack_acl_state" \
  && ! -e "$run_acl_state" ]] \
  || fail "socket ACL rollback failure prevented path ACL rollback"
rm -f "$socket_acl_state"

: > "$acl_log"
: > "$preflight_log"
: > "$launch_log"
: > "$chown_log"
rm -rf "$worker_data_root"
rm -f "$launch_fail_once"
printf 'absent\n' > "$launch_state"
run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply >/dev/null
installed_plist="$install_dir/com.perfect21.fleet-worker.plist"
runtime_dir="$test_root/usr/local/libexec/cecelia/fleet-worker"
installed_worker="$runtime_dir/fleet-worker.cjs"
installed_probe="$runtime_dir/node-probe.cjs"
installed_workspace_manager="$runtime_dir/workspace-manager.cjs"
installed_attempt_runner="$runtime_dir/attempt-runner.cjs"
installed_credential_envelope="$runtime_dir/credential-envelope.cjs"
installed_github_credential_envelope="$runtime_dir/github-credential-envelope.cjs"
installed_access_helper="$runtime_dir/refresh-fleet-worker-docker-access.sh"
installed_access_plist="$install_dir/com.perfect21.fleet-worker-docker-access.plist"
[[ -f "$installed_plist" ]] || fail "--apply did not install the rendered plist"
[[ -f "$installed_worker" && -f "$installed_probe" ]] \
  || fail "--apply did not install a stable Worker runtime"
[[ -f "$installed_workspace_manager" && -f "$installed_attempt_runner" ]] \
  || fail "--apply omitted the Workspace/Attempt runtime modules"
[[ -f "$installed_credential_envelope" ]] \
  || fail "--apply omitted the credential envelope runtime module"
[[ -f "$installed_github_credential_envelope" ]] \
  || fail "--apply omitted the GitHub credential envelope runtime module"
[[ -d "$worker_data_root" ]] \
  || fail "--apply did not create the Worker-owned data root"
[[ -d "$shared_tmpdir" ]] \
  || fail "--apply did not create the OrbStack-shareable Worker TMPDIR"
grep -Fxq "_cecelia:_cecelia $worker_data_root" "$chown_log" \
  || fail "--apply did not assign the data root to the Worker identity"
grep -Fxq "_cecelia:_cecelia $shared_tmpdir" "$chown_log" \
  || fail "--apply did not assign the shared TMPDIR to the Worker identity"
grep -Fxq "_cecelia:_cecelia $worker_token_file" "$chown_log" \
  || fail "--apply did not assign the token file to the Worker identity"
[[ -f "$installed_access_helper" && -f "$installed_access_plist" ]] \
  || fail "--apply did not install the socket ACL refresher generation"
access_plist_contract="$(python3 - "$installed_access_plist" <<'PY'
import plistlib
import sys

with open(sys.argv[1], 'rb') as handle:
    plist = plistlib.load(handle)

print('|'.join([
    str(plist.get('UserName')),
    str(plist.get('RunAtLoad')),
    str(plist.get('WatchPaths', [None])[0]),
    str(plist.get('ProgramArguments', [None])[0]),
]))
PY
)" || fail "socket ACL watcher is not a valid plist"
[[ "$access_plist_contract" == "root|True|/Users/orbstack-owner/.orbstack/run/docker.sock|$installed_access_helper" ]] \
  || fail "socket ACL watcher contract drifted: $access_plist_contract"
cmp -s "$validated_plist" "$installed_plist" \
  || fail "installed plist differs from the validated staged plist"
[[ "$(wc -l < "$launch_log" | tr -d ' ')" -eq 4 ]] \
  || fail "--apply must start exactly the watcher and Worker"
[[ "$(sed -n '1p' "$launch_log")" == "bootstrap system $installed_access_plist" ]] \
  || fail "--apply did not bootstrap the socket ACL watcher first"
[[ "$(sed -n '2p' "$launch_log")" == 'kickstart -k system/com.perfect21.fleet-worker-docker-access' ]] \
  || fail "--apply did not run the socket ACL refresher"
[[ "$(sed -n '3p' "$launch_log")" == "bootstrap system $installed_plist" ]] \
  || fail "--apply did not bootstrap the installed Worker LaunchDaemon"
[[ "$(sed -n '4p' "$launch_log")" == 'kickstart -k system/com.perfect21.fleet-worker' ]] \
  || fail "--apply did not kickstart the installed system LaunchDaemon"
[[ "$(<"$launch_state")" == 'running' ]] \
  || fail "first apply did not leave the service running"
[[ "$(grep -Fc 'acl +a ' "$acl_log")" -eq 4 ]] \
  || fail "first apply did not add exactly four minimal ACLs"
grep -Fxq 'acl +a _cecelia allow search /Users/orbstack-owner' "$acl_log" \
  || fail "first apply omitted owner-home search ACL"
grep -Fxq 'acl +a _cecelia allow search /Users/orbstack-owner/.orbstack' "$acl_log" \
  || fail "first apply omitted OrbStack directory search ACL"
grep -Fxq 'acl +a _cecelia allow search /Users/orbstack-owner/.orbstack/run' "$acl_log" \
  || fail "first apply omitted OrbStack run directory search ACL"
grep -Fxq 'acl +a _cecelia allow read,write /Users/orbstack-owner/.orbstack/run/docker.sock' \
  "$acl_log" || fail "first apply did not grant exact socket read,write"
[[ "$(sed -n '1p' "$preflight_log")" == 'acl +a' ]] \
  || fail "home ACL was not granted before the low-privilege node probe"
[[ "$(sed -n '2p' "$preflight_log")" == 'acl +a' ]] \
  || fail "OrbStack directory ACL was not granted before the low-privilege node probe"
[[ "$(sed -n '3p' "$preflight_log")" == 'acl +a' ]] \
  || fail "OrbStack run ACL was not granted before the low-privilege node probe"
[[ "$(sed -n '4p' "$preflight_log")" == 'acl +a' ]] \
  || fail "socket ACL was not granted before the low-privilege node probe"
[[ "$(sed -n '5p' "$preflight_log")" == 'probe' ]] \
  || fail "node probe did not run after all ACL grants"

: > "$launch_log"
run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply >/dev/null \
  || fail "repeat --apply was not an idempotent upgrade"
[[ "$(wc -l < "$launch_log" | tr -d ' ')" -eq 6 ]] \
  || fail "repeat --apply did not replace both prior service generations"
[[ "$(sed -n '1p' "$launch_log")" == 'bootout system/com.perfect21.fleet-worker-docker-access' ]] \
  || fail "repeat --apply did not boot out the prior watcher"
[[ "$(sed -n '2p' "$launch_log")" == 'bootout system/com.perfect21.fleet-worker' ]] \
  || fail "repeat --apply did not boot out the prior Worker"
[[ "$(sed -n '3p' "$launch_log")" == "bootstrap system $installed_access_plist" ]] \
  || fail "repeat --apply did not bootstrap the replacement watcher"
[[ "$(sed -n '4p' "$launch_log")" == 'kickstart -k system/com.perfect21.fleet-worker-docker-access' ]] \
  || fail "repeat --apply did not refresh socket access"
[[ "$(sed -n '5p' "$launch_log")" == "bootstrap system $installed_plist" ]] \
  || fail "repeat --apply did not bootstrap the replacement Worker"
[[ "$(sed -n '6p' "$launch_log")" == 'kickstart -k system/com.perfect21.fleet-worker' ]] \
  || fail "repeat --apply did not kickstart the replacement service"
[[ "$(<"$launch_state")" == 'running' ]] \
  || fail "repeat --apply left split service state"
[[ "$(grep -Fc 'acl +a ' "$acl_log")" -eq 4 ]] \
  || fail "repeat --apply duplicated an existing ACL"

mode_of() {
  case "$(uname -s)" in
    Darwin) stat -f '%Lp' "$1" ;;
    Linux) stat -c '%a' "$1" ;;
    *) fail "unsupported operating system for mode assertion" ;;
  esac
}

seed_prior_generation() {
  local tag="$1"
  printf '%s\n' "prior-worker-$tag" > "$installed_worker"
  printf '%s\n' "prior-probe-$tag" > "$installed_probe"
  printf '%s\n' "prior-credential-envelope-$tag" > "$installed_credential_envelope"
  printf '%s\n' "prior-plist-$tag" > "$installed_plist"
  printf '%s\n' "prior-access-helper-$tag" > "$installed_access_helper"
  printf '%s\n' "prior-access-plist-$tag" > "$installed_access_plist"
  chmod 0711 "$installed_worker"
  chmod 0600 "$installed_probe"
  chmod 0644 "$installed_credential_envelope"
  chmod 0640 "$installed_plist"
  chmod 0700 "$installed_access_helper"
  chmod 0600 "$installed_access_plist"
  printf 'running\n' > "$launch_state"
}

assert_support_placement_failure_rolled_back() {
  local snapshot_dir="$test_root/snapshot-placement"
  local worker_mode probe_mode credential_mode plist_mode helper_mode access_plist_mode
  local failure_output

  seed_prior_generation placement
  mkdir -p "$snapshot_dir"
  cp "$installed_worker" "$snapshot_dir/worker"
  cp "$installed_probe" "$snapshot_dir/probe"
  cp "$installed_credential_envelope" "$snapshot_dir/credential-envelope"
  cp "$installed_plist" "$snapshot_dir/plist"
  cp "$installed_access_helper" "$snapshot_dir/access-helper"
  cp "$installed_access_plist" "$snapshot_dir/access-plist"
  worker_mode="$(mode_of "$installed_worker")"
  probe_mode="$(mode_of "$installed_probe")"
  credential_mode="$(mode_of "$installed_credential_envelope")"
  plist_mode="$(mode_of "$installed_plist")"
  helper_mode="$(mode_of "$installed_access_helper")"
  access_plist_mode="$(mode_of "$installed_access_plist")"
  : > "$launch_log"
  rm -f \
    "$acl_state" \
    "$orbstack_acl_state" \
    "$run_acl_state" \
    "$socket_acl_state" \
    "$FLEET_WORKER_MV_FAIL_ONCE"

  failure_output=''
  if failure_output="$(
    FLEET_WORKER_MV="$test_root/mv" \
    FLEET_WORKER_MV_FAIL_TARGET="$installed_access_plist" \
      run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
  )"; then
    fail "support plist placement failure unexpectedly succeeded"
  fi
  grep -Fq 'install_failed_rolled_back' <<<"$failure_output" \
    || fail "support plist placement failure lacked rollback signature"
  cmp -s "$snapshot_dir/worker" "$installed_worker" \
    || fail "placement failure did not restore Worker bytes"
  cmp -s "$snapshot_dir/probe" "$installed_probe" \
    || fail "placement failure did not restore probe bytes"
  cmp -s "$snapshot_dir/credential-envelope" "$installed_credential_envelope" \
    || fail "placement failure did not restore credential envelope bytes"
  cmp -s "$snapshot_dir/plist" "$installed_plist" \
    || fail "placement failure did not restore Worker plist bytes"
  cmp -s "$snapshot_dir/access-helper" "$installed_access_helper" \
    || fail "placement failure did not restore access helper bytes"
  cmp -s "$snapshot_dir/access-plist" "$installed_access_plist" \
    || fail "placement failure did not restore access plist bytes"
  [[ "$(mode_of "$installed_worker")" == "$worker_mode" \
    && "$(mode_of "$installed_probe")" == "$probe_mode" \
    && "$(mode_of "$installed_credential_envelope")" == "$credential_mode" \
    && "$(mode_of "$installed_plist")" == "$plist_mode" \
    && "$(mode_of "$installed_access_helper")" == "$helper_mode" \
    && "$(mode_of "$installed_access_plist")" == "$access_plist_mode" ]] \
    || fail "placement failure did not restore exact file modes"
  [[ "$(<"$launch_state")" == 'running' ]] \
    || fail "placement failure did not restore prior services"
  [[ "$(wc -l < "$launch_log" | tr -d ' ')" -eq 8 ]] \
    || fail "placement rollback mutation sequence drifted"
  [[ ! -e "$acl_state" && ! -e "$orbstack_acl_state" \
    && ! -e "$run_acl_state" && ! -e "$socket_acl_state" ]] \
    || fail "placement failure leaked a newly-added ACL"
}

assert_support_placement_failure_rolled_back

assert_failed_upgrade_rolled_back() {
  local failure_match="$1"
  local expected_mutations="$2"
  local tag="$3"
  local snapshot_dir="$test_root/snapshot-$tag"
  local worker_mode probe_mode credential_mode plist_mode access_helper_mode access_plist_mode
  local failure_output

  seed_prior_generation "$tag"
  mkdir -p "$snapshot_dir"
  cp "$installed_worker" "$snapshot_dir/worker"
  cp "$installed_probe" "$snapshot_dir/probe"
  cp "$installed_credential_envelope" "$snapshot_dir/credential-envelope"
  cp "$installed_plist" "$snapshot_dir/plist"
  cp "$installed_access_helper" "$snapshot_dir/access-helper"
  cp "$installed_access_plist" "$snapshot_dir/access-plist"
  worker_mode="$(mode_of "$installed_worker")"
  probe_mode="$(mode_of "$installed_probe")"
  credential_mode="$(mode_of "$installed_credential_envelope")"
  plist_mode="$(mode_of "$installed_plist")"
  access_helper_mode="$(mode_of "$installed_access_helper")"
  access_plist_mode="$(mode_of "$installed_access_plist")"
  : > "$launch_log"
  rm -f "$launch_fail_once"
  export FLEET_WORKER_LAUNCH_FAIL_MATCH="$failure_match"

  failure_output=''
  if failure_output="$(
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
  )"; then
    unset FLEET_WORKER_LAUNCH_FAIL_MATCH
    fail "$tag failure unexpectedly succeeded"
  fi
  unset FLEET_WORKER_LAUNCH_FAIL_MATCH

  grep -Fq 'install_failed_rolled_back' <<<"$failure_output" \
    || fail "$tag failure lacked a bounded rollback signature"
  cmp -s "$snapshot_dir/worker" "$installed_worker" \
    || fail "$tag failure did not restore exact Worker bytes"
  cmp -s "$snapshot_dir/probe" "$installed_probe" \
    || fail "$tag failure did not restore exact probe bytes"
  cmp -s "$snapshot_dir/credential-envelope" "$installed_credential_envelope" \
    || fail "$tag failure did not restore exact credential envelope bytes"
  cmp -s "$snapshot_dir/plist" "$installed_plist" \
    || fail "$tag failure did not restore exact plist bytes"
  cmp -s "$snapshot_dir/access-helper" "$installed_access_helper" \
    || fail "$tag failure did not restore exact access helper bytes"
  cmp -s "$snapshot_dir/access-plist" "$installed_access_plist" \
    || fail "$tag failure did not restore exact access plist bytes"
  [[ "$(mode_of "$installed_worker")" == "$worker_mode" ]] \
    || fail "$tag failure did not restore the Worker mode"
  [[ "$(mode_of "$installed_probe")" == "$probe_mode" ]] \
    || fail "$tag failure did not restore the probe mode"
  [[ "$(mode_of "$installed_credential_envelope")" == "$credential_mode" ]] \
    || fail "$tag failure did not restore the credential envelope mode"
  [[ "$(mode_of "$installed_plist")" == "$plist_mode" ]] \
    || fail "$tag failure did not restore the plist mode"
  [[ "$(mode_of "$installed_access_helper")" == "$access_helper_mode" ]] \
    || fail "$tag failure did not restore the access helper mode"
  [[ "$(mode_of "$installed_access_plist")" == "$access_plist_mode" ]] \
    || fail "$tag failure did not restore the access plist mode"
  [[ "$(<"$launch_state")" == 'running' ]] \
    || fail "$tag failure did not best-effort restore the prior service"
  [[ "$(wc -l < "$launch_log" | tr -d ' ')" -eq "$expected_mutations" ]] \
    || fail "$tag rollback performed an unexpected mutation sequence"
  [[ "$(sed -n '1p' "$launch_log")" == \
    'bootout system/com.perfect21.fleet-worker-docker-access' ]] \
    || fail "$tag failure did not first stop the prior watcher"
  [[ "$(sed -n '2p' "$launch_log")" == 'bootout system/com.perfect21.fleet-worker' ]] \
    || fail "$tag failure did not stop the prior Worker"
  tail -n 2 "$launch_log" | grep -Fxq \
    "bootstrap system $installed_plist" \
    || fail "$tag rollback did not restore the prior plist service"
  [[ "$(tail -n 1 "$launch_log")" == 'kickstart -k system/com.perfect21.fleet-worker' ]] \
    || fail "$tag rollback did not restart the prior service"
}

assert_failed_upgrade_rolled_back 'bootstrap system' 9 bootstrap
assert_failed_upgrade_rolled_back 'kickstart -k' 10 kickstart

assert_started_but_unhealthy_generation_rolled_back() {
  local snapshot_dir="$test_root/snapshot-startup-health"
  local failure_output

  seed_prior_generation startup-health
  mkdir -p "$snapshot_dir"
  cp "$installed_worker" "$snapshot_dir/worker"
  cp "$installed_probe" "$snapshot_dir/probe"
  cp "$installed_credential_envelope" "$snapshot_dir/credential-envelope"
  cp "$installed_plist" "$snapshot_dir/plist"
  cp "$installed_access_helper" "$snapshot_dir/access-helper"
  cp "$installed_access_plist" "$snapshot_dir/access-plist"
  : > "$launch_log"
  : > "$startup_probe_log"

  failure_output=''
  if failure_output="$(
    FLEET_WORKER_STARTUP_PROBE_FAIL=1 \
      run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
  )"; then
    fail "kickstart-success/startup-health-failure unexpectedly committed"
  fi

  grep -Fq 'install_failed_rolled_back' <<<"$failure_output" \
    || fail "startup health failure lacked rollback signature"
  cmp -s "$snapshot_dir/worker" "$installed_worker" \
    || fail "startup health failure did not restore Worker bytes"
  cmp -s "$snapshot_dir/probe" "$installed_probe" \
    || fail "startup health failure did not restore probe bytes"
  cmp -s "$snapshot_dir/credential-envelope" "$installed_credential_envelope" \
    || fail "startup health failure did not restore credential envelope bytes"
  cmp -s "$snapshot_dir/plist" "$installed_plist" \
    || fail "startup health failure did not restore Worker plist bytes"
  cmp -s "$snapshot_dir/access-helper" "$installed_access_helper" \
    || fail "startup health failure did not restore access helper bytes"
  cmp -s "$snapshot_dir/access-plist" "$installed_access_plist" \
    || fail "startup health failure did not restore access plist bytes"
  [[ "$(<"$launch_state")" == 'running' ]] \
    || fail "startup health failure did not restore the prior running service"
  grep -Fxq \
    'http://100.86.57.69:5231/health|xian-mac-m4' \
    "$startup_probe_log" \
    || fail "installer did not verify the profile-owned Worker health URL"
}

assert_started_but_unhealthy_generation_rolled_back

assert_stopped_upgrade_remains_stopped() {
  local failure_match="$1"
  local expected_mutations="$2"
  local tag="$3"
  local snapshot_dir="$test_root/snapshot-stopped-$tag"
  local worker_mode probe_mode credential_mode plist_mode access_helper_mode access_plist_mode
  local failure_output

  seed_prior_generation "stopped-$tag"
  printf 'stopped\n' > "$launch_state"
  mkdir -p "$snapshot_dir"
  cp "$installed_worker" "$snapshot_dir/worker"
  cp "$installed_probe" "$snapshot_dir/probe"
  cp "$installed_credential_envelope" "$snapshot_dir/credential-envelope"
  cp "$installed_plist" "$snapshot_dir/plist"
  cp "$installed_access_helper" "$snapshot_dir/access-helper"
  cp "$installed_access_plist" "$snapshot_dir/access-plist"
  worker_mode="$(mode_of "$installed_worker")"
  probe_mode="$(mode_of "$installed_probe")"
  credential_mode="$(mode_of "$installed_credential_envelope")"
  plist_mode="$(mode_of "$installed_plist")"
  access_helper_mode="$(mode_of "$installed_access_helper")"
  access_plist_mode="$(mode_of "$installed_access_plist")"
  : > "$launch_log"
  rm -f "$launch_fail_once"
  export FLEET_WORKER_LAUNCH_FAIL_MATCH="$failure_match"

  failure_output=''
  if failure_output="$(
    run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
  )"; then
    unset FLEET_WORKER_LAUNCH_FAIL_MATCH
    fail "stopped $tag failure unexpectedly succeeded"
  fi
  unset FLEET_WORKER_LAUNCH_FAIL_MATCH

  grep -Fq 'install_failed_rolled_back' <<<"$failure_output" \
    || fail "stopped $tag failure lacked a bounded rollback signature"
  cmp -s "$snapshot_dir/worker" "$installed_worker" \
    || fail "stopped $tag failure did not restore exact Worker bytes"
  cmp -s "$snapshot_dir/probe" "$installed_probe" \
    || fail "stopped $tag failure did not restore exact probe bytes"
  cmp -s "$snapshot_dir/credential-envelope" "$installed_credential_envelope" \
    || fail "stopped $tag failure did not restore exact credential envelope bytes"
  cmp -s "$snapshot_dir/plist" "$installed_plist" \
    || fail "stopped $tag failure did not restore exact plist bytes"
  cmp -s "$snapshot_dir/access-helper" "$installed_access_helper" \
    || fail "stopped $tag failure did not restore exact access helper bytes"
  cmp -s "$snapshot_dir/access-plist" "$installed_access_plist" \
    || fail "stopped $tag failure did not restore exact access plist bytes"
  [[ "$(mode_of "$installed_worker")" == "$worker_mode" ]] \
    || fail "stopped $tag failure did not restore the Worker mode"
  [[ "$(mode_of "$installed_probe")" == "$probe_mode" ]] \
    || fail "stopped $tag failure did not restore the probe mode"
  [[ "$(mode_of "$installed_credential_envelope")" == "$credential_mode" ]] \
    || fail "stopped $tag failure did not restore the credential envelope mode"
  [[ "$(mode_of "$installed_plist")" == "$plist_mode" ]] \
    || fail "stopped $tag failure did not restore the plist mode"
  [[ "$(mode_of "$installed_access_helper")" == "$access_helper_mode" ]] \
    || fail "stopped $tag failure did not restore the access helper mode"
  [[ "$(mode_of "$installed_access_plist")" == "$access_plist_mode" ]] \
    || fail "stopped $tag failure did not restore the access plist mode"
  [[ "$(<"$launch_state")" == 'stopped' ]] \
    || fail "stopped $tag rollback incorrectly started the prior service"
  [[ "$(wc -l < "$launch_log" | tr -d ' ')" -eq "$expected_mutations" ]] \
    || fail "stopped $tag rollback performed an unexpected mutation sequence"
  [[ "$(grep -Ec '^bootstrap ' "$launch_log")" -eq 1 ]] \
    || fail "stopped $tag rollback bootstrapped the old stopped service"
  if [[ "$failure_match" == 'bootstrap system' ]]; then
    [[ "$(grep -Ec '^kickstart ' "$launch_log" 2>/dev/null || true)" -eq 0 ]] \
      || fail "stopped bootstrap rollback kickstarted the old stopped service"
  else
    [[ "$(grep -Ec '^kickstart ' "$launch_log")" -eq 1 ]] \
      || fail "stopped kickstart rollback retried the old stopped service"
  fi
}

assert_stopped_upgrade_remains_stopped 'bootstrap system' 3 bootstrap
assert_stopped_upgrade_remains_stopped 'kickstart -k' 4 kickstart

seed_prior_generation loaded-without-plist
rm -f "$installed_plist"
orphan_worker="$test_root/orphan-worker"
orphan_probe="$test_root/orphan-probe"
cp "$installed_worker" "$orphan_worker"
cp "$installed_probe" "$orphan_probe"
orphan_worker_mode="$(mode_of "$installed_worker")"
orphan_probe_mode="$(mode_of "$installed_probe")"
printf 'running\n' > "$launch_state"
: > "$launch_log"
invalid_state_output=''
if invalid_state_output="$(
  run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply 2>&1
)"; then
  fail "loaded service without an installed generation was accepted"
fi
grep -Fq 'prior_service_state_invalid' <<<"$invalid_state_output" \
  || fail "loaded service without an installed generation lacked a bounded refusal"
[[ ! -s "$launch_log" ]] \
  || fail "invalid prior service state caused a launchd mutation"
[[ ! -e "$installed_plist" ]] \
  || fail "invalid prior service state installed a new plist"
cmp -s "$orphan_worker" "$installed_worker" \
  || fail "invalid prior service state changed Worker bytes"
cmp -s "$orphan_probe" "$installed_probe" \
  || fail "invalid prior service state changed probe bytes"
[[ "$(mode_of "$installed_worker")" == "$orphan_worker_mode" ]] \
  || fail "invalid prior service state changed the Worker mode"
[[ "$(mode_of "$installed_probe")" == "$orphan_probe_mode" ]] \
  || fail "invalid prior service state changed the probe mode"
[[ "$(<"$launch_state")" == 'running' ]] \
  || fail "invalid prior service state changed the loaded service"

echo "PASS: Fleet Worker installer behavioral contract"
