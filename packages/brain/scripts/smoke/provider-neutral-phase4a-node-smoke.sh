#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

curl -sf "$BRAIN_URL/api/brain/health" >/dev/null

cd "$ROOT"
node --input-type=module <<'NODE'
import { listNodeProfiles } from './packages/brain/src/orchestrator/fleet-node/node-profile.js';

const expectedDigest =
  'sha256:6f2f62e94cc558b3895502b8f8822911b6d46b4b30ba9b76684f6692382cf6ea';
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
