#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
INSTALLER="${FLEET_NODECTL_INSTALLER:-$SCRIPT_DIR/install-fleet-worker.sh}"
LAUNCHCTL="${FLEET_NODECTL_LAUNCHCTL:-/bin/launchctl}"
DRAIN_MARKER="${FLEET_NODECTL_DRAIN_MARKER:-/var/run/cecelia/fleet-worker.drain}"
HEALTH_FILE="${FLEET_NODECTL_HEALTH_FILE:-}"
LOCAL_MACHINE="${CECELIA_MACHINE_ID:-}"
PLIST="${FLEET_NODECTL_PLIST:-/Library/LaunchDaemons/com.perfect21.fleet-worker.plist}"
LABEL='com.perfect21.fleet-worker'
NODE_EXECUTABLE="${FLEET_NODECTL_NODE:-$(command -v node || true)}"

usage() {
  cat <<'USAGE'
usage:
  fleet-nodectl.sh status <machine>
  fleet-nodectl.sh bootstrap <machine> [--apply]
  fleet-nodectl.sh admit <machine>
  fleet-nodectl.sh drain <machine> [--apply]
  fleet-nodectl.sh undrain <machine> [--apply]
USAGE
}

die() {
  echo "$1" >&2
  exit "${2:-1}"
}

require_machine() {
  case "$1" in
    us-mac-m4|xian-mac-m4|xian-mac-m1) ;;
    *) die "unknown_fleet_node" 64 ;;
  esac
}

require_local_apply() {
  [[ -n "$LOCAL_MACHINE" && "$1" == "$LOCAL_MACHINE" ]] \
    || die "local_machine_mismatch" 65
}

read_health_and_admit() {
  [[ -n "$NODE_EXECUTABLE" ]] || die "node_unavailable"

  (
    cd "$REPO_ROOT"
    FLEET_NODECTL_ADMIT_MACHINE="$machine_id" \
    FLEET_NODECTL_ADMIT_HEALTH_FILE="$HEALTH_FILE" \
      "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { evaluateBaseAdmission } from './packages/brain/src/orchestrator/fleet-node/node-admission.js';
import { getNodeProfile } from './packages/brain/src/orchestrator/fleet-node/node-profile.js';

const MAX_HEALTH_BODY_BYTES = 64 * 1024;
const machineId = process.env.FLEET_NODECTL_ADMIT_MACHINE;
const healthFile = process.env.FLEET_NODECTL_ADMIT_HEALTH_FILE;
const profile = getNodeProfile(machineId);
let report;

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HEALTH_BODY_BYTES) {
    throw new Error('health_body_too_large');
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_HEALTH_BODY_BYTES) throw new Error('health_body_too_large');
    return JSON.parse(body.toString('utf8'));
  }

  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > MAX_HEALTH_BODY_BYTES) {
        await reader.cancel();
        throw new Error('health_body_too_large');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
}

try {
  if (healthFile) {
    report = JSON.parse(await readFile(healthFile, 'utf8'));
  } else {
    const response = await fetch(`http://${profile.worker_bind_host}:5231/health`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('health_unavailable');
    report = await readBoundedJson(response);
  }
  const result = evaluateBaseAdmission(report, {
    profile,
    nowMs: Date.now(),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.base_admitted !== true || result.dispatch_ready !== false) {
    process.exitCode = 1;
  }
} catch {
  process.stdout.write('{"base_admitted":false,"dispatch_ready":false,"state":"draining"}\n');
  process.exitCode = 1;
}
NODE
  )
}

[[ $# -ge 1 ]] || { usage >&2; exit 64; }
case "$1" in
  -h|--help)
    [[ $# -eq 1 ]] || { usage >&2; exit 64; }
    usage
    exit 0
    ;;
esac

command_name="$1"
shift
[[ $# -ge 1 ]] || { usage >&2; exit 64; }
machine_id="$1"
shift
require_machine "$machine_id"

apply=false
if [[ $# -gt 0 ]]; then
  [[ $# -eq 1 && "$1" == '--apply' ]] || { usage >&2; exit 64; }
  apply=true
fi

case "$command_name" in
  status)
    [[ "$apply" == false ]] || { usage >&2; exit 64; }
    if [[ -f "$DRAIN_MARKER" ]]; then
      echo "$machine_id draining"
    else
      echo "$machine_id undrained"
    fi
    ;;
  bootstrap)
    if [[ "$apply" == false ]]; then
      echo "dry-run: would bootstrap system/$LABEL for $machine_id"
    else
      require_local_apply "$machine_id"
      "$INSTALLER" "$machine_id" --apply
    fi
    ;;
  admit)
    [[ "$apply" == false ]] || { usage >&2; exit 64; }
    read_health_and_admit
    ;;
  drain)
    if [[ "$apply" == false ]]; then
      echo "dry-run: would drain $machine_id"
    else
      require_local_apply "$machine_id"
      if [[ ! -f "$DRAIN_MARKER" ]]; then
        mkdir -p "$(dirname "$DRAIN_MARKER")"
        printf '%s\n' "$machine_id" > "$DRAIN_MARKER"
        "$LAUNCHCTL" bootout "system/$LABEL"
      fi
      echo "drained: $machine_id"
    fi
    ;;
  undrain)
    if [[ "$apply" == false ]]; then
      echo "dry-run: would undrain $machine_id"
    else
      require_local_apply "$machine_id"
      if [[ -f "$DRAIN_MARKER" ]]; then
        rm -f "$DRAIN_MARKER"
        if ! "$LAUNCHCTL" bootstrap system "$PLIST"; then
          printf '%s\n' "$machine_id" > "$DRAIN_MARKER"
          exit 1
        fi
        if ! "$LAUNCHCTL" kickstart -k "system/$LABEL"; then
          printf '%s\n' "$machine_id" > "$DRAIN_MARKER"
          exit 1
        fi
      fi
      echo "undrained: $machine_id"
    fi
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac
