#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODECTL="$SCRIPT_DIR/fleet-nodectl.sh"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$NODECTL" ]] || fail "missing fleet-nodectl.sh entrypoint"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
marker="$test_root/fleet-worker.drained"
health="$test_root/health.json"
mutation_log="$test_root/remote-mutation.log"
launch_log="$test_root/launchctl.log"
mkdir -p "$test_root/bin"

for remote_command in ssh scp curl; do
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf "%s %s\\n" "$(basename "$0")" "$*" >> "${FLEET_NODECTL_TEST_REMOTE_LOG:?}"' \
    'exit 99' > "$test_root/bin/$remote_command"
  chmod +x "$test_root/bin/$remote_command"
done

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "$1" == "bootout" ]]; then' \
  '  [[ -f "${FLEET_NODECTL_DRAIN_MARKER:?}" ]] || exit 42' \
  '  printf "marker_before_bootout\\n" >> "${FLEET_NODECTL_TEST_LAUNCH_LOG:?}"' \
  'fi' \
  'printf "%s\\n" "$*" >> "${FLEET_NODECTL_TEST_LAUNCH_LOG:?}"' \
  'exit 0' > "$test_root/launchctl"
chmod +x "$test_root/launchctl"

run_nodectl() {
  CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_NODECTL_DRAIN_MARKER="$marker" \
  FLEET_NODECTL_HEALTH_FILE="$health" \
  FLEET_NODECTL_TEST_REMOTE_LOG="$mutation_log" \
  FLEET_NODECTL_LAUNCHCTL="$test_root/launchctl" \
  FLEET_NODECTL_TEST_LAUNCH_LOG="$launch_log" \
  PATH="$test_root/bin:$PATH" \
  "$NODECTL" "$@"
}

count_launchctl() {
  local pattern="$1"
  grep -Ec "$pattern" "$launch_log" 2>/dev/null || true
}

for machine in us-mac-m4 xian-mac-m4 xian-mac-m1; do
  CECELIA_MACHINE_ID="$machine" \
    FLEET_NODECTL_DRAIN_MARKER="$marker" \
    FLEET_NODECTL_LAUNCHCTL="$test_root/launchctl" \
    FLEET_NODECTL_TEST_LAUNCH_LOG="$launch_log" \
    "$NODECTL" status "$machine" >/dev/null \
    || fail "canonical ID rejected: $machine"
done
if run_nodectl status moon-base >/dev/null 2>&1; then
  fail "unknown machine ID was accepted"
fi

: > "$launch_log"
for machine in us-mac-m4 xian-mac-m4 xian-mac-m1; do
  bootstrap_output="$(
    CECELIA_MACHINE_ID="$machine" \
      FLEET_NODECTL_DRAIN_MARKER="$marker" \
      FLEET_NODECTL_LAUNCHCTL="$test_root/launchctl" \
      FLEET_NODECTL_TEST_LAUNCH_LOG="$launch_log" \
      "$NODECTL" bootstrap "$machine"
  )" || fail "bootstrap dry-run rejected canonical ID $machine"
  grep -qi 'dry.run' <<<"$bootstrap_output" \
    || fail "bootstrap default is not dry-run for $machine"
done
if run_nodectl bootstrap moon-base >/dev/null 2>&1; then
  fail "bootstrap accepted an unknown machine ID"
fi
[[ ! -e "$marker" ]] || fail "bootstrap dry-run created a drain marker"
[[ ! -s "$launch_log" ]] || fail "bootstrap dry-run mutated launchd"

output="$(run_nodectl drain us-mac-m4)"
grep -qi 'dry.run' <<<"$output" || fail "drain default is not dry-run"
[[ ! -e "$marker" ]] || fail "dry-run created the drain marker"
[[ ! -s "$launch_log" ]] || fail "drain dry-run mutated launchd"

run_nodectl drain us-mac-m4 --apply >/dev/null
[[ -f "$marker" ]] || fail "drain --apply did not create the marker"
grep -Fq 'marker_before_bootout' "$launch_log" \
  || fail "drain did not create its marker before launchctl bootout"
first_bootout_count="$(count_launchctl '^bootout ')"
[[ "$first_bootout_count" -eq 1 ]] \
  || fail "first drain must perform exactly one launchctl bootout"
first_marker="$(<"$marker")"
run_nodectl drain us-mac-m4 --apply >/dev/null
[[ "$(<"$marker")" == "$first_marker" ]] || fail "drain was not idempotent"
second_bootout_count="$(count_launchctl '^bootout ')"
[[ "$second_bootout_count" -eq "$first_bootout_count" ]] \
  || fail "second drain performed an extra launchctl bootout"

launch_before_undrain="$(wc -l < "$launch_log" | tr -d ' ')"
undrain_output="$(run_nodectl undrain us-mac-m4)"
grep -qi 'dry.run' <<<"$undrain_output" || fail "undrain default is not dry-run"
[[ -f "$marker" ]] || fail "undrain dry-run removed the marker"
[[ "$(wc -l < "$launch_log" | tr -d ' ')" == "$launch_before_undrain" ]] \
  || fail "undrain dry-run mutated launchd"

service_start_before="$(count_launchctl '^(bootstrap|kickstart) ')"
run_nodectl undrain us-mac-m4 --apply >/dev/null
[[ ! -e "$marker" ]] || fail "undrain did not remove the marker"
first_service_start_count="$(count_launchctl '^(bootstrap|kickstart) ')"
[[ "$first_service_start_count" -gt "$service_start_before" ]] \
  || fail "first undrain did not bootstrap or kickstart the service"
run_nodectl undrain us-mac-m4 --apply >/dev/null \
  || fail "undrain of an absent marker was not idempotent"
second_service_start_count="$(count_launchctl '^(bootstrap|kickstart) ')"
[[ "$second_service_start_count" -eq "$first_service_start_count" ]] \
  || fail "second undrain performed an extra service mutation"

printf '%s\n' '{"machine_id":"us-mac-m4","base_admitted":true,"dispatch_ready":true}' > "$health"
if run_nodectl admit us-mac-m4 >/dev/null 2>&1; then
  fail "admit trusted Worker-supplied admission booleans"
fi

printf '%s\n' '{"machine_id":"us-mac-m4","state":"draining","base_admitted":false}' > "$health"
if run_nodectl admit us-mac-m4 >/dev/null 2>&1; then
  fail "admit returned zero without Brain-owned base_admitted evidence"
fi

cd "$ROOT"
node --input-type=module > "$health" <<'NODE'
import { getNodeProfile } from './packages/brain/src/orchestrator/fleet-node/node-profile.js';

const profile = getNodeProfile('us-mac-m4');
const policy = profile.version_policy;
const now = new Date().toISOString();
console.log(JSON.stringify({
  schema_version: 'fleet-node-health/v1',
  machine_id: profile.machine_id,
  observed_at: now,
  worker: {
    protocol_version: policy.worker_protocol,
    contract_version: policy.worker_contract,
    version: policy.worker,
  },
  runner: { version: policy.runner, image_digest: profile.runner_image_digest },
  os: { version: policy.os },
  orbstack: { version: policy.orbstack },
  docker: { available: true, observed_at: now },
  resources: {
    cpu_cores: profile.resources.cpu_cores,
    memory_bytes: profile.resources.memory_gib * 1024 ** 3,
    disk_free_bytes: profile.resources.disk_min_free_gib * 1024 ** 3,
    disk_used_percent: profile.resources.disk_max_used_percent,
    cpu_pressure_percent: profile.resources.cpu_pressure_max_percent - 1,
    memory_pressure_percent: profile.resources.memory_pressure_max_percent - 1,
  },
  git: { available: true, version: policy.git },
  node: { available: true, version: policy.node },
  codex: { available: true, version: policy.codex },
  tailscale: { connected: true },
  callback: { reachable: true },
  time_sync: { synchronized: true },
  power: { sleep_disabled: true, auto_power_on: true },
  launchd: { loaded: true, domain: 'system', kind: 'LaunchDaemon' },
  worktree: { root_ready: true },
  container: { probe_succeeded: true },
  drain: { active: false },
}));
NODE
run_nodectl admit us-mac-m4 >/dev/null \
  || fail "admit rejected a valid Brain-evaluated base-admission report"

HEALTH_FILE="$health" node --input-type=module > "$test_root/drift-health.json" <<'NODE'
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.env.HEALTH_FILE, 'utf8'));
report.runner.image_digest = `sha256:${'0'.repeat(64)}`;
console.log(JSON.stringify(report));
NODE
mv "$test_root/drift-health.json" "$health"
if run_nodectl admit us-mac-m4 >/dev/null 2>&1; then
  fail "admit accepted a Runner digest rejected by the pure evaluator"
fi

if run_nodectl drain xian-mac-m4 --apply >/dev/null 2>&1; then
  fail "nodectl attempted to mutate a remote node"
fi
[[ ! -e "$marker" ]] || fail "remote mutation attempt changed the local marker"
[[ ! -s "$mutation_log" ]] || fail "nodectl invoked a remote mutation transport"

help="$("$NODECTL" --help)"
grep -Eqi 'CODEX_ACCOUNT_ALLOWLIST|authorization|auth|token|prompt|credential|ssh|scp' <<<"$help" \
  && fail "nodectl exposes account, credential, prompt, or remote mutation authority"

echo "PASS: fleet-nodectl behavioral contract"
