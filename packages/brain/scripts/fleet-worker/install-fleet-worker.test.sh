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
preflight_log="$test_root/preflight.log"
mkdir -p "$install_dir" "$log_dir"

run_installer() {
  env -u FLEET_WORKER_ID \
    FLEET_WORKER_INSTALL_DIR="$install_dir" \
    FLEET_WORKER_LOG_DIR="$log_dir" \
    FLEET_WORKER_LAUNCHCTL="$test_root/launchctl" \
    FLEET_WORKER_NODE_PROBE="$test_root/node-probe" \
    FLEET_WORKER_READLINK="$test_root/readlink" \
    FLEET_WORKER_ACL_LIST="$test_root/acl-list" \
    FLEET_WORKER_CHMOD="$test_root/chmod" \
    "$INSTALLER" "$@"
}

run_installer_with_id() {
  local id_path="$1"
  shift
  FLEET_WORKER_ID="$id_path" \
    FLEET_WORKER_INSTALL_DIR="$install_dir" \
    FLEET_WORKER_LOG_DIR="$log_dir" \
    FLEET_WORKER_LAUNCHCTL="$test_root/launchctl" \
    FLEET_WORKER_NODE_PROBE="$test_root/node-probe" \
    FLEET_WORKER_READLINK="$test_root/readlink" \
    FLEET_WORKER_ACL_LIST="$test_root/acl-list" \
    FLEET_WORKER_CHMOD="$test_root/chmod" \
    "$INSTALLER" "$@"
}

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >> "${FLEET_WORKER_LAUNCH_LOG:?}"' \
  'exit 0' > "$test_root/launchctl"
chmod +x "$test_root/launchctl"
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
  'if [[ -e "${FLEET_WORKER_ACL_STATE:?}" ]]; then' \
  '  printf "%s\\n" " 0: user:_cecelia allow search"' \
  'fi' \
  > "$test_root/acl-list"
chmod +x "$test_root/acl-list"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "acl $*" >> "${FLEET_WORKER_ACL_LOG:?}"' \
  'printf "%s\\n" "acl $1" >> "${FLEET_WORKER_PREFLIGHT_LOG:?}"' \
  'if [[ "$1" == "+a" ]]; then' \
  '  [[ "${FLEET_WORKER_ACL_FAIL_ADD:-0}" != "1" ]] || exit 91' \
  '  : > "${FLEET_WORKER_ACL_STATE:?}"' \
  'elif [[ "$1" == "-a" ]]; then' \
  '  rm -f "${FLEET_WORKER_ACL_STATE:?}"' \
  'fi' \
  > "$test_root/chmod"
chmod +x "$test_root/chmod"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "probe" >> "${FLEET_WORKER_PREFLIGHT_LOG:?}"' \
  'printf "%s\\n" "{\"ok\":true}"' \
  'exit 0' > "$test_root/node-probe"
chmod +x "$test_root/node-probe"

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
)
PY
)" || fail "rendered file is not a valid plist"
[[ "$plist_contract" == 'true|true|_cecelia|/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin|100.86.57.69|unix:///var/run/docker.sock' ]] \
  || fail "plist contract drifted: $plist_contract"
validated_plist="$test_root/validated-fleet-worker.plist"
cp "$plist" "$validated_plist"
plist_body="$(<"$plist")"

for required in \
  '<key>UserName</key>' \
  '<key>CECELIA_MACHINE_ID</key>' \
  '<string>xian-mac-m4</string>' \
  '<key>CECELIA_RUNNER_DIGEST</key>'; do
  grep -Fq "$required" <<<"$plist_body" || fail "plist missing $required"
done
grep -Eq '<string>sha256:[a-f0-9]{64}</string>' <<<"$plist_body" \
  || fail "plist does not pin the Runner digest"
grep -Fq "$log_dir/fleet-worker.stdout.log" <<<"$plist_body" \
  || fail "stdout log path is not bounded"
grep -Fq "$log_dir/fleet-worker.stderr.log" <<<"$plist_body" \
  || fail "stderr log path is not bounded"
grep -Eqi 'CODEX_ACCOUNT_ALLOWLIST|account|authorization|auth|token|prompt|credential' <<<"$plist_body" \
  && fail "plist contains local account or credential authority"

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
  '  case "$(<"${FLEET_WORKER_LAUNCH_STATE:?}")" in' \
  '    loaded|running) exit 0 ;;' \
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
[[ ! -e "$acl_state" ]] || fail "failed ACL grant left ACL state behind"

: > "$acl_log"
: > "$preflight_log"
rm -f "$acl_state" "$launch_fail_once"
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
[[ "$(grep -Ec '^acl \\+a ' "$acl_log")" -eq 1 ]] \
  || fail "failed first install did not add exactly one ACL"
[[ "$(grep -Ec '^acl -a ' "$acl_log")" -eq 1 ]] \
  || fail "failed first install did not remove its new ACL"
[[ ! -e "$acl_state" ]] || fail "failed first install leaked its new ACL"

: > "$acl_log"
: > "$preflight_log"
: > "$launch_log"
rm -f "$launch_fail_once"
printf 'absent\n' > "$launch_state"
run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply >/dev/null
installed_plist="$install_dir/com.perfect21.fleet-worker.plist"
runtime_dir="$test_root/usr/local/libexec/cecelia/fleet-worker"
installed_worker="$runtime_dir/fleet-worker.cjs"
installed_probe="$runtime_dir/node-probe.cjs"
[[ -f "$installed_plist" ]] || fail "--apply did not install the rendered plist"
[[ -f "$installed_worker" && -f "$installed_probe" ]] \
  || fail "--apply did not install a stable Worker runtime"
cmp -s "$validated_plist" "$installed_plist" \
  || fail "installed plist differs from the validated staged plist"
[[ "$(wc -l < "$launch_log" | tr -d ' ')" -eq 2 ]] \
  || fail "--apply must perform exactly two launchctl mutations"
[[ "$(sed -n '1p' "$launch_log")" == "bootstrap system $installed_plist" ]] \
  || fail "--apply did not bootstrap the installed system LaunchDaemon"
[[ "$(sed -n '2p' "$launch_log")" == 'kickstart -k system/com.perfect21.fleet-worker' ]] \
  || fail "--apply did not kickstart the installed system LaunchDaemon"
[[ "$(<"$launch_state")" == 'running' ]] \
  || fail "first apply did not leave the service running"
[[ "$(grep -Ec '^acl \\+a ' "$acl_log")" -eq 1 ]] \
  || fail "first apply did not add exactly one minimal ACL"
grep -Fxq 'acl +a _cecelia allow search /Users/orbstack-owner' "$acl_log" \
  || fail "first apply granted more than owner-home search ACL"
[[ "$(sed -n '1p' "$preflight_log")" == 'acl +a' ]] \
  || fail "ACL was not granted before the low-privilege node probe"
[[ "$(sed -n '2p' "$preflight_log")" == 'probe' ]] \
  || fail "node probe did not run after the ACL grant"

: > "$launch_log"
run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply >/dev/null \
  || fail "repeat --apply was not an idempotent upgrade"
[[ "$(wc -l < "$launch_log" | tr -d ' ')" -eq 3 ]] \
  || fail "repeat --apply did not replace one prior service generation"
[[ "$(sed -n '1p' "$launch_log")" == 'bootout system/com.perfect21.fleet-worker' ]] \
  || fail "repeat --apply did not boot out the prior service before bootstrap"
[[ "$(sed -n '2p' "$launch_log")" == "bootstrap system $installed_plist" ]] \
  || fail "repeat --apply did not bootstrap the replacement plist"
[[ "$(sed -n '3p' "$launch_log")" == 'kickstart -k system/com.perfect21.fleet-worker' ]] \
  || fail "repeat --apply did not kickstart the replacement service"
[[ "$(<"$launch_state")" == 'running' ]] \
  || fail "repeat --apply left split service state"
[[ "$(grep -Ec '^acl \\+a ' "$acl_log")" -eq 1 ]] \
  || fail "repeat --apply duplicated the existing ACL"

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
  printf '%s\n' "prior-plist-$tag" > "$installed_plist"
  chmod 0711 "$installed_worker"
  chmod 0600 "$installed_probe"
  chmod 0640 "$installed_plist"
  printf 'running\n' > "$launch_state"
}

assert_failed_upgrade_rolled_back() {
  local failure_match="$1"
  local expected_mutations="$2"
  local tag="$3"
  local snapshot_dir="$test_root/snapshot-$tag"
  local worker_mode probe_mode plist_mode failure_output

  seed_prior_generation "$tag"
  mkdir -p "$snapshot_dir"
  cp "$installed_worker" "$snapshot_dir/worker"
  cp "$installed_probe" "$snapshot_dir/probe"
  cp "$installed_plist" "$snapshot_dir/plist"
  worker_mode="$(mode_of "$installed_worker")"
  probe_mode="$(mode_of "$installed_probe")"
  plist_mode="$(mode_of "$installed_plist")"
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
  cmp -s "$snapshot_dir/plist" "$installed_plist" \
    || fail "$tag failure did not restore exact plist bytes"
  [[ "$(mode_of "$installed_worker")" == "$worker_mode" ]] \
    || fail "$tag failure did not restore the Worker mode"
  [[ "$(mode_of "$installed_probe")" == "$probe_mode" ]] \
    || fail "$tag failure did not restore the probe mode"
  [[ "$(mode_of "$installed_plist")" == "$plist_mode" ]] \
    || fail "$tag failure did not restore the plist mode"
  [[ "$(<"$launch_state")" == 'running' ]] \
    || fail "$tag failure did not best-effort restore the prior service"
  [[ "$(wc -l < "$launch_log" | tr -d ' ')" -eq "$expected_mutations" ]] \
    || fail "$tag rollback performed an unexpected mutation sequence"
  [[ "$(sed -n '1p' "$launch_log")" == 'bootout system/com.perfect21.fleet-worker' ]] \
    || fail "$tag failure did not first stop the prior generation"
  tail -n 2 "$launch_log" | grep -Fxq \
    "bootstrap system $installed_plist" \
    || fail "$tag rollback did not restore the prior plist service"
  [[ "$(tail -n 1 "$launch_log")" == 'kickstart -k system/com.perfect21.fleet-worker' ]] \
    || fail "$tag rollback did not restart the prior service"
}

assert_failed_upgrade_rolled_back 'bootstrap system' 5 bootstrap
assert_failed_upgrade_rolled_back 'kickstart -k' 6 kickstart

assert_stopped_upgrade_remains_stopped() {
  local failure_match="$1"
  local expected_mutations="$2"
  local tag="$3"
  local snapshot_dir="$test_root/snapshot-stopped-$tag"
  local worker_mode probe_mode plist_mode failure_output

  seed_prior_generation "stopped-$tag"
  printf 'stopped\n' > "$launch_state"
  mkdir -p "$snapshot_dir"
  cp "$installed_worker" "$snapshot_dir/worker"
  cp "$installed_probe" "$snapshot_dir/probe"
  cp "$installed_plist" "$snapshot_dir/plist"
  worker_mode="$(mode_of "$installed_worker")"
  probe_mode="$(mode_of "$installed_probe")"
  plist_mode="$(mode_of "$installed_plist")"
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
  cmp -s "$snapshot_dir/plist" "$installed_plist" \
    || fail "stopped $tag failure did not restore exact plist bytes"
  [[ "$(mode_of "$installed_worker")" == "$worker_mode" ]] \
    || fail "stopped $tag failure did not restore the Worker mode"
  [[ "$(mode_of "$installed_probe")" == "$probe_mode" ]] \
    || fail "stopped $tag failure did not restore the probe mode"
  [[ "$(mode_of "$installed_plist")" == "$plist_mode" ]] \
    || fail "stopped $tag failure did not restore the plist mode"
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

assert_stopped_upgrade_remains_stopped 'bootstrap system' 2 bootstrap
assert_stopped_upgrade_remains_stopped 'kickstart -k' 3 kickstart

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
