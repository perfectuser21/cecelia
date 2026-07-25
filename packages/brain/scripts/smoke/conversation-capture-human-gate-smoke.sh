#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"

bash -n "$REPO_ROOT/scripts/claude-launch.sh"
bash -n "$ROOT/scripts/cecelia-run.sh"
bash -n "$ROOT/scripts/cleanup-conversation-captures.sh"

node - "$ROOT" "$REPO_ROOT" <<'NODE'
const fs = require('fs');
const [root, repo] = process.argv.slice(2);
const migration = fs.readFileSync(`${root}/migrations/360_session_provenance.sql`, 'utf8');
const capture = fs.readFileSync(`${root}/src/conversation-capture.js`, 'utf8');
const launcher = fs.readFileSync(`${repo}/scripts/claude-launch.sh`, 'utf8');
const runner = fs.readFileSync(`${root}/scripts/cecelia-run.sh`, 'utf8');
const relay = fs.readFileSync(`${root}/src/harness-skill-relay.js`, 'utf8');
const cleanup = fs.readFileSync(`${root}/scripts/cleanup-conversation-captures.sh`, 'utf8');

for (const token of ['session_provenance', "'human'", "'machine'", 'ON CONFLICT']) {
  if (!migration.includes(token)) throw new Error(`migration missing ${token}`);
}
for (const token of [
  'WHERE session_id = ANY($1::text[])',
  'skipped_machine',
  'skipped_unregistered',
  'provenance_lookup_failed',
]) {
  if (!capture.includes(token)) throw new Error(`capture gate missing ${token}`);
}
for (const token of ['PGCONNECT_TIMEOUT=2', 'session_provenance', 'CECELIA_DISPATCH']) {
  if (!launcher.includes(token)) throw new Error(`launcher missing ${token}`);
}
for (const src of [runner, relay]) {
  for (const token of ['CECELIA_DISPATCH=1', 'HARNESS_TASK_ID=', 'claude-launch.sh']) {
    if (!src.includes(token)) throw new Error(`dispatch path missing ${token}`);
  }
}
if (!cleanup.includes('--confirm') || !cleanup.includes("DELETE FROM captures WHERE source LIKE 'conversation%'")) {
  throw new Error('cleanup SOP guard/scope missing');
}
NODE

echo "OK: conversation capture human gate smoke passed"
