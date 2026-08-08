#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

curl -sf "$BRAIN_URL/api/brain/health" >/dev/null

cd "$ROOT"
node --input-type=module <<'NODE'
import { listNodeProfiles } from './packages/brain/src/orchestrator/fleet-node/node-profile.js';

const expectedDigest =
  'sha256:08c904ff0dc216229b84d2ce7216760fcb9968a43351916f8495265b3956bd4f';
const profiles = listNodeProfiles();

if (profiles.length !== 3) throw new Error(`expected 3 canonical nodes, got ${profiles.length}`);
for (const profile of profiles) {
  if (profile.runner_image_digest !== expectedDigest) {
    throw new Error(`Runner digest drift on ${profile.machine_id}`);
  }
  if (profile.version_policy.os !== '15.6.1') {
    throw new Error(`macOS floor drift on ${profile.machine_id}`);
  }
  if (profile.launchd.domain !== 'system' || profile.launchd.kind !== 'LaunchDaemon') {
    throw new Error(`system LaunchDaemon contract drift on ${profile.machine_id}`);
  }
}

console.log('PASS: Provider-neutral Phase 4A node production contract smoke');
NODE
