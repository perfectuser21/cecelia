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
mkdir -p "$install_dir" "$log_dir"

run_installer() {
  env -u FLEET_WORKER_ID \
    FLEET_WORKER_INSTALL_DIR="$install_dir" \
    FLEET_WORKER_LOG_DIR="$log_dir" \
    FLEET_WORKER_LAUNCHCTL="$test_root/launchctl" \
    FLEET_WORKER_NODE_PROBE="$test_root/node-probe" \
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
    "$INSTALLER" "$@"
}

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >> "${FLEET_WORKER_LAUNCH_LOG:?}"' \
  'exit 0' > "$test_root/launchctl"
chmod +x "$test_root/launchctl"
export FLEET_WORKER_LAUNCH_LOG="$launch_log"

printf '%s\n' \
  '#!/usr/bin/env bash' \
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
print(
    ('true' if run_at_load is True else repr(run_at_load))
    + '|'
    + ('true' if keep_alive is True else repr(keep_alive))
    + '|'
    + str(user_name)
)
PY
)" || fail "rendered file is not a valid plist"
[[ "$plist_contract" == 'true|true|_cecelia' ]] \
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
  'printf "%s\\n" "$*" >> "${FLEET_WORKER_LAUNCH_LOG:?}"' \
  'exit 0' > "$test_root/launchctl"
chmod +x "$test_root/launchctl"
: > "$launch_log"
run_installer_with_id "$test_root/id-root" xian-mac-m4 --apply >/dev/null
installed_plist="$install_dir/com.perfect21.fleet-worker.plist"
[[ -f "$installed_plist" ]] || fail "--apply did not install the rendered plist"
cmp -s "$validated_plist" "$installed_plist" \
  || fail "installed plist differs from the validated staged plist"
[[ "$(wc -l < "$launch_log" | tr -d ' ')" -eq 2 ]] \
  || fail "--apply must perform exactly two launchctl mutations"
[[ "$(sed -n '1p' "$launch_log")" == "bootstrap system $installed_plist" ]] \
  || fail "--apply did not bootstrap the installed system LaunchDaemon"
[[ "$(sed -n '2p' "$launch_log")" == 'kickstart -k system/com.perfect21.fleet-worker' ]] \
  || fail "--apply did not kickstart the installed system LaunchDaemon"

echo "PASS: Fleet Worker installer behavioral contract"
